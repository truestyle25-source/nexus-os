/**
 * O contexto da empresa NÃO pode sobreviver na conexão depois da operação.
 *
 * Força o pool do Prisma a UMA conexão (PRISMA_CONNECTION_LIMIT=1), para que
 * todas as operações reutilizem fisicamente a mesma conexão do Postgres, e
 * confere que:
 *  - depois de uma operação da empresa A, a conexão não guarda app.empresa_id;
 *  - operações de A e B intercaladas na mesma conexão não se misturam;
 *  - após erro/rollback, o contexto também é limpo;
 *  - o contexto da requisição HTTP anterior não vaza para a próxima.
 * Funciona como postgres e como nexus_app (current_setting não depende de RLS).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRISMA_CONNECTION_LIMIT = '1';
const url = new URL(process.env.DATABASE_URL || 'postgresql://x@invalido/x');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432' || url.pathname.replace(/^\/+/, '') !== 'nexus_os_test') {
  throw new Error('Teste bloqueado: este teste só pode usar localhost:5432/nexus_os_test.');
}
url.searchParams.delete('connection_limit');
process.env.DATABASE_URL = url.toString();

const { prisma, prismaBase } = await import('../src/lib/prisma.js');
const { comTenant, executarComContexto, abrirContextoRequisicao, definirTenantDaRequisicao, contextoAtual } = await import('../src/lib/tenant-context.js');

type Estado = { empresa: string | null; escopo: string | null; pid: number };
async function estadoDaConexao(): Promise<Estado> {
  // prismaBase: sem extensão, então NÃO envia set_config — lê o que ficou na conexão.
  const [r] = await prismaBase.$queryRaw<Array<{ empresa: string | null; escopo: string | null; pid: number }>>`
    select nullif(current_setting('app.empresa_id', true), '') as empresa,
           nullif(current_setting('app.escopo', true), '') as escopo,
           pg_backend_pid() as pid`;
  return r;
}

test('pool: contexto é local à transação e não vaza entre empresas', async (t) => {
  try {
    const inicial = await estadoDaConexao();

    await t.test('a mesma conexão física é reutilizada (pré-condição do teste)', async () => {
      await comTenant('empresa-A', () => prisma.empresa.count());
      const depois = await estadoDaConexao();
      assert.equal(depois.pid, inicial.pid, 'o pool deveria ter só 1 conexão');
    });

    await t.test('após operação da empresa A a conexão não guarda contexto', async () => {
      await comTenant('empresa-A', () => prisma.empresa.findMany({ take: 1 }));
      const e = await estadoDaConexao();
      assert.equal(e.empresa, null);
      assert.equal(e.escopo, null);
    });

    await t.test('dentro da operação o contexto certo está ativo', async () => {
      const dentro = await comTenant('empresa-B', () =>
        prisma.$queryRaw<Array<{ empresa: string }>>`select current_setting('app.empresa_id', true) as empresa`,
      );
      assert.equal(dentro[0].empresa, 'empresa-B');
    });

    await t.test('transação interativa: contexto ativo dentro e limpo depois', async () => {
      const dentro = await comTenant('empresa-A', () =>
        prisma.$transaction(async (tx) => {
          const [r] = await tx.$queryRaw<Array<{ empresa: string }>>`select current_setting('app.empresa_id', true) as empresa`;
          return r.empresa;
        }),
      );
      assert.equal(dentro, 'empresa-A');
      assert.equal((await estadoDaConexao()).empresa, null);
    });

    await t.test('após erro e rollback, o contexto também é limpo', async () => {
      await assert.rejects(comTenant('empresa-A', () => prisma.$transaction(async () => { throw new Error('falha'); })));
      assert.equal((await estadoDaConexao()).empresa, null);
    });

    await t.test('A e B intercaladas na mesma conexão nunca enxergam o contexto da outra', async () => {
      const resultados = await Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          const emp = i % 2 === 0 ? 'empresa-A' : 'empresa-B';
          return comTenant(emp, async () => {
            const [r] = await prisma.$queryRaw<Array<{ empresa: string }>>`select current_setting('app.empresa_id', true) as empresa`;
            return { emp, visto: r.empresa };
          });
        }),
      );
      for (const r of resultados) assert.equal(r.visto, r.emp);
      assert.equal((await estadoDaConexao()).empresa, null);
    });

    await t.test('requisições HTTP sucessivas: a seguinte começa sem o tenant da anterior', async () => {
      // Simula o hook onRequest: cada requisição abre o próprio contexto.
      const req1 = await new Promise<string | undefined>((ok) =>
        abrirContextoRequisicao(() => { definirTenantDaRequisicao('empresa-A', 'u1'); ok(contextoAtual()?.empresaId); }),
      );
      const req2 = await new Promise<{ escopo?: string; empresa?: string }>((ok) =>
        abrirContextoRequisicao(() => ok({ escopo: contextoAtual()?.escopo, empresa: contextoAtual()?.empresaId })),
      );
      assert.equal(req1, 'empresa-A');
      assert.equal(req2.escopo, 'nenhum');
      assert.equal(req2.empresa, undefined);
    });

    await t.test('escopo "nenhum" não envia contexto algum', async () => {
      const r = await executarComContexto({ escopo: 'nenhum' }, () =>
        prisma.$queryRaw<Array<{ empresa: string | null }>>`select nullif(current_setting('app.empresa_id', true), '') as empresa`,
      );
      assert.equal(r[0].empresa, null);
    });
  } finally {
    await prisma.$disconnect();
  }
});

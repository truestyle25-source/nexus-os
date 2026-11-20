/**
 * RLS multi-empresa — prova no BANCO (não só na aplicação).
 *
 * Só roda quando o backend conecta como um papel SEM BYPASSRLS (nexus_app) em
 * um banco com prisma/seguranca/01_rls_policies.sql aplicado. Com `postgres`
 * (BYPASSRLS) os testes são pulados, pois não provariam nada.
 *
 *   DATABASE_URL=postgresql://nexus_app:...@localhost:5432/nexus_os_test \
 *   NODE_ENV=test NEXUS_TESTE_ESCOPO_PADRAO=sistema npx tsx --test tests/rls-isolamento.test.ts
 *
 * Todas as consultas abaixo OMITEM de propósito o filtro `empresaId`: o que
 * isola as empresas aqui é exclusivamente o RLS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, prismaBase } from '../src/lib/prisma.js';
import { comTenant, comoSistema, executarComContexto } from '../src/lib/tenant-context.js';

const SUF = `rls${Date.now().toString(36)}`;
const A = `emp-a-${SUF}`;
const B = `emp-b-${SUF}`;

async function papelSemBypass(): Promise<boolean> {
  const [linha] = await prismaBase.$queryRaw<Array<{ bypass: boolean; rls: boolean }>>`
    select r.rolbypassrls as bypass,
           (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname = 'Categoria') as rls
    from pg_roles r where r.rolname = current_user`;
  return !!linha && !linha.bypass && !!linha.rls;
}

test('RLS: isolamento por empresa garantido pelo banco', async (t) => {
  if (!(await papelSemBypass())) {
    t.skip('papel atual tem BYPASSRLS ou RLS não aplicado — rode como nexus_app');
    return;
  }

  await comoSistema('teste:setup', async () => {
    await prisma.empresa.createMany({ data: [{ id: A, nome: `RLS A ${SUF}` }, { id: B, nome: `RLS B ${SUF}` }] });
    await prisma.categoria.createMany({
      data: [
        { id: `cat-a1-${SUF}`, empresaId: A, nome: 'A1' },
        { id: `cat-a2-${SUF}`, empresaId: A, nome: 'A2' },
        { id: `cat-b1-${SUF}`, empresaId: B, nome: 'B1' },
      ],
    });
  });

  try {
    await t.test('sem contexto (requisição não autenticada) não vê nada', async () => {
      const n = await executarComContexto({ escopo: 'nenhum' }, () =>
        prisma.categoria.count({ where: { id: { endsWith: SUF } } }),
      );
      assert.equal(n, 0);
    });

    await t.test('empresa A vê só as próprias linhas mesmo sem filtro empresaId', async () => {
      const linhas = await comTenant(A, () => prisma.categoria.findMany({ where: { id: { endsWith: SUF } } }));
      assert.deepEqual(linhas.map((c) => c.empresaId).sort(), [A, A]);
      const empresas = await comTenant(A, () => prisma.empresa.findMany({ where: { id: { in: [A, B] } } }));
      assert.deepEqual(empresas.map((e) => e.id), [A]);
    });

    await t.test('empresa A não lê, altera nem apaga linha de B pelo id', async () => {
      const lida = await comTenant(A, () => prisma.categoria.findUnique({ where: { id: `cat-b1-${SUF}` } }));
      assert.equal(lida, null);
      const alteradas = await comTenant(A, () =>
        prisma.categoria.updateMany({ where: { id: `cat-b1-${SUF}` }, data: { nome: 'invadido' } }),
      );
      assert.equal(alteradas.count, 0);
      const apagadas = await comTenant(A, () => prisma.categoria.deleteMany({ where: { id: `cat-b1-${SUF}` } }));
      assert.equal(apagadas.count, 0);
      const intacta = await comoSistema('teste:conferir', () =>
        prisma.categoria.findUnique({ where: { id: `cat-b1-${SUF}` } }),
      );
      assert.equal(intacta?.nome, 'B1');
    });

    await t.test('empresa A não grava com empresaId de B (WITH CHECK)', async () => {
      await assert.rejects(
        comTenant(A, () => prisma.categoria.create({ data: { id: `cat-x-${SUF}`, empresaId: B, nome: 'X' } })),
      );
    });

    await t.test('transação interativa: tx e prisma global dentro dela herdam o contexto', async () => {
      const r = await comTenant(A, () =>
        prisma.$transaction(async (tx) => {
          await tx.categoria.create({ data: { id: `cat-a3-${SUF}`, empresaId: A, nome: 'A3' } });
          // Service que usa o prisma GLOBAL (padrão comum no código): precisa
          // enxergar a linha ainda não commitada => está na mesma transação.
          const viaGlobal = await prisma.categoria.findUnique({ where: { id: `cat-a3-${SUF}` } });
          const viaTx = await tx.categoria.count({ where: { id: { endsWith: SUF } } });
          return { viaGlobal: viaGlobal?.id, viaTx };
        }),
      );
      assert.equal(r.viaGlobal, `cat-a3-${SUF}`);
      assert.equal(r.viaTx, 3);
    });

    await t.test('transação em lote ($transaction([...])) respeita o contexto', async () => {
      const [qtd, lista] = await comTenant(B, () =>
        prisma.$transaction([
          prisma.categoria.count({ where: { id: { endsWith: SUF } } }),
          prisma.categoria.findMany({ where: { id: { endsWith: SUF } }, select: { empresaId: true } }),
        ]),
      );
      assert.equal(qtd, 1);
      assert.deepEqual(lista.map((c) => c.empresaId), [B]);
    });

    await t.test('rollback da transação interativa desfaz o que foi gravado', async () => {
      await assert.rejects(
        comTenant(A, () =>
          prisma.$transaction(async (tx) => {
            await tx.categoria.create({ data: { id: `cat-rb-${SUF}`, empresaId: A, nome: 'RB' } });
            throw new Error('falha proposital');
          }),
        ),
      );
      const existe = await comoSistema('teste:conferir', () =>
        prisma.categoria.findUnique({ where: { id: `cat-rb-${SUF}` } }),
      );
      assert.equal(existe, null);
    });

    await t.test('requisições concorrentes de empresas diferentes não misturam contexto', async () => {
      const rodadas = await Promise.all(
        Array.from({ length: 40 }, (_, i) => {
          const emp = i % 2 === 0 ? A : B;
          return comTenant(emp, async () => {
            await new Promise((r) => setTimeout(r, Math.random() * 15));
            const linhas = await prisma.categoria.findMany({ where: { id: { endsWith: SUF } }, select: { empresaId: true } });
            return { emp, vistos: [...new Set(linhas.map((l) => l.empresaId))] };
          });
        }),
      );
      for (const { emp, vistos } of rodadas) assert.deepEqual(vistos, [emp]);
    });

    await t.test('SQL cru também passa pelo RLS', async () => {
      const linhas = await comTenant(A, () =>
        prisma.$queryRaw<Array<{ empresaId: string }>>`select "empresaId" from "Categoria" where id like ${'%' + SUF}`,
      );
      assert.ok(linhas.length > 0);
      assert.ok(linhas.every((l) => l.empresaId === A));
    });
  } finally {
    await comoSistema('teste:limpeza', async () => {
      await prisma.categoria.deleteMany({ where: { id: { endsWith: SUF } } });
      await prisma.empresa.deleteMany({ where: { id: { in: [A, B] } } });
    });
    await prisma.$disconnect();
  }
});

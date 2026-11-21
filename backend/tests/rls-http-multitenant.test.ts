/**
 * Isolamento multiempresa de ponta a ponta, pelas rotas HTTP reais.
 *
 * Duas empresas (A e B) criam produto, cliente, fornecedor, funcionário,
 * lançamento financeiro e meta. Depois, cada uma tenta LER, LISTAR, EDITAR e
 * EXCLUIR os registros da outra, nos dois sentidos (A→B e B→A). Também testa
 * usuário autenticado SEM permissão.
 *
 * Roda nos dois modos:
 *  - postgres (BYPASSRLS): prova a barreira da aplicação;
 *  - nexus_app + RLS: prova a barreira da aplicação + a do banco.
 * Banco: localhost:5432/nexus_os_test (mesma trava dos demais testes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { comoSistema } from '../src/lib/tenant-context.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { empresaRoutes } from '../src/modules/empresa/empresa.routes.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { comprasRoutes } from '../src/modules/compras/compras.routes.js';
import { rhRoutes } from '../src/modules/rh/rh.routes.js';
import { gestaoRoutes } from '../src/modules/gestao/gestao.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';

// O limite de cadastro (5/min por IP) fica no banco e vale para todos os arquivos de
// teste; cada arquivo usa um IP próprio (faixa de documentação) para não esgotar o dos outros.
const IP_CADASTRO = '198.51.100.15';

function travaBanco() {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://x@invalido/x');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432' || url.pathname.replace(/^\/+/, '') !== 'nexus_os_test') {
    throw new Error('Teste bloqueado: este teste só pode usar localhost:5432/nexus_os_test.');
  }
}

const SUF = Date.now().toString(36);
type Emp = { token: string; filialId: string; empresaId: string; ids: Record<string, string> };

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.code === 'P2025') return reply.status(404).send({ error: 'Registro não encontrado.' });
    if (typeof error?.statusCode === 'number' && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register(registerAuthentication);
  for (const r of [authRoutes, empresaRoutes, produtosRoutes, comprasRoutes, rhRoutes, gestaoRoutes, vendasRoutes]) await app.register(r);
  return app;
}

test('HTTP: isolamento multiempresa nos dois sentidos + usuário sem permissão', async (t) => {
  travaBanco();
  const app = await montarApp();
  const H = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const emps: Record<'A' | 'B', Emp> = {} as any;

  try {
    for (const k of ['A', 'B'] as const) {
      const email = `rlshttp${k.toLowerCase()}${SUF}@teste.local`;
      const reg = await app.inject({ method: 'POST', url: '/auth/register-company', remoteAddress: IP_CADASTRO, payload: { nomeEmpresa: `RLS HTTP ${k} ${SUF}`, nome: `Dono ${k}`, email, senha: 'SenhaForte123' } });
      assert.equal(reg.statusCode, 201, `cadastro ${k}: ${reg.body}`);
      const log = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'SenhaForte123' } });
      assert.equal(log.statusCode, 200);
      const token = log.json().token;
      const me = await app.inject({ method: 'GET', url: '/auth/me', headers: H(token) });
      const fil = await app.inject({ method: 'GET', url: '/filiais', headers: H(token) });
      const filiais = fil.json();
      const filialId = (Array.isArray(filiais) ? filiais : filiais.filiais)[0].id;
      emps[k] = { token, filialId, empresaId: me.json().company.id, ids: {} };
    }

    // Cada empresa cria um registro em cada módulo.
    for (const k of ['A', 'B'] as const) {
      const e = emps[k];
      const criar = async (nome: string, url: string, payload: unknown, pegarId = (j: any) => j?.id) => {
        const r = await app.inject({ method: 'POST', url, headers: H(e.token), payload: payload as any });
        assert.ok([200, 201].includes(r.statusCode), `${k} cria ${nome}: ${r.statusCode} ${r.body.slice(0, 200)}`);
        e.ids[nome] = pegarId(r.json());
        assert.ok(e.ids[nome], `${k} ${nome} sem id: ${r.body.slice(0, 200)}`);
      };
      await criar('produto', '/produtos', { nome: `Prod ${k}`, sku: `RH${k}${SUF}`, precoVenda: 10, custo: 4, unidade: 'UN' });
      await criar('cliente', '/clientes', { nome: `Cliente ${k} ${SUF}` });
      await criar('fornecedor', '/fornecedores', { nome: `Fornecedor ${k} ${SUF}` });
      await criar('funcionario', '/funcionarios', { nome: `Funcionario ${k} ${SUF}` }, (j) => j?.id ?? j?.funcionario?.id);
      await criar('financeiro', '/financeiro', { tipo: 'DESPESA', categoria: 'operacionais', descricao: `Despesa ${k}`, valor: 123.45, vencimento: new Date().toISOString().slice(0, 10) }, (j) => j?.id ?? j?.lancamento?.id);
      await criar('meta', '/metas', { tipo: 'VENDAS', periodo: '2026-11', metaValor: 1000 }, (j) => j?.id ?? j?.meta?.id);
    }

    const leituras: Array<[string, (id: string) => string]> = [
      ['produto', (id) => `/produtos/${id}`],
      ['cliente', (id) => `/clientes/${id}`],
      ['fornecedor', (id) => `/fornecedores/${id}`],
    ];
    const listas: Array<[string, string]> = [
      ['produto', '/produtos'], ['cliente', '/clientes'], ['fornecedor', '/fornecedores'],
      ['funcionario', '/funcionarios'], ['financeiro', '/financeiro'], ['meta', '/metas'],
    ];
    const edicoes: Array<[string, string, (id: string) => string, unknown]> = [
      ['produto', 'PUT', (id) => `/produtos/${id}`, { nome: 'INVADIDO', sku: `INV${SUF}`, precoVenda: 1, custo: 1, unidade: 'UN' }],
      ['cliente', 'PUT', (id) => `/clientes/${id}`, { nome: 'INVADIDO' }],
      ['fornecedor', 'PUT', (id) => `/fornecedores/${id}`, { nome: 'INVADIDO' }],
      ['funcionario', 'PUT', (id) => `/funcionarios/${id}`, { nome: 'INVADIDO' }],
      ['meta', 'PUT', (id) => `/metas/${id}`, { tipo: 'VENDAS', periodo: '2026-11', metaValor: 1 }],
    ];
    const exclusoes: Array<[string, (id: string) => string]> = [
      ['produto', (id) => `/produtos/${id}`],
      ['meta', (id) => `/metas/${id}`],
    ];

    for (const [de, para] of [['A', 'B'], ['B', 'A']] as const) {
      const atacante = emps[de];
      const vitima = emps[para];

      await t.test(`${de} não lê registros de ${para} pelo id`, async () => {
        for (const [nome, url] of leituras) {
          const r = await app.inject({ method: 'GET', url: url(vitima.ids[nome]), headers: H(atacante.token) });
          assert.ok([403, 404].includes(r.statusCode), `${nome}: ${r.statusCode} ${r.body.slice(0, 150)}`);
        }
      });

      await t.test(`${de} não vê registros de ${para} nas listagens`, async () => {
        for (const [nome, url] of listas) {
          const r = await app.inject({ method: 'GET', url, headers: H(atacante.token) });
          assert.equal(r.statusCode, 200, `${nome}: ${r.statusCode}`);
          assert.ok(!r.body.includes(vitima.ids[nome]), `${nome}: listagem de ${de} contém id de ${para}`);
          assert.ok(!r.body.includes(vitima.empresaId), `${nome}: listagem de ${de} contém empresaId de ${para}`);
        }
      });

      await t.test(`${de} não edita registros de ${para}`, async () => {
        for (const [nome, metodo, url, payload] of edicoes) {
          const r = await app.inject({ method: metodo as any, url: url(vitima.ids[nome]), headers: H(atacante.token), payload: payload as any });
          assert.ok([400, 403, 404].includes(r.statusCode), `${nome}: ${r.statusCode} ${r.body.slice(0, 150)}`);
        }
      });

      await t.test(`${de} não exclui registros de ${para}`, async () => {
        for (const [nome, url] of exclusoes) {
          const r = await app.inject({ method: 'DELETE', url: url(vitima.ids[nome]), headers: H(atacante.token) });
          assert.ok([403, 404].includes(r.statusCode), `${nome}: ${r.statusCode} ${r.body.slice(0, 150)}`);
        }
      });

      await t.test(`${de} não vende usando filial/produto de ${para}`, async () => {
        const r = await app.inject({
          method: 'POST', url: '/vendas', headers: H(atacante.token),
          payload: { filialId: vitima.filialId, formaPagamento: 'DINHEIRO', itens: [{ produtoId: vitima.ids.produto, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 10 }] },
        });
        assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${r.statusCode} ${r.body.slice(0, 150)}`);
      });
    }

    await t.test('registros continuam intactos depois das tentativas', async () => {
      const intactos = await comoSistema('teste:conferir', async () => ({
        produtoA: await prisma.produto.findUnique({ where: { id: emps.A.ids.produto } }),
        produtoB: await prisma.produto.findUnique({ where: { id: emps.B.ids.produto } }),
        clienteA: await prisma.cliente.findUnique({ where: { id: emps.A.ids.cliente } }),
        metaB: await prisma.meta.findUnique({ where: { id: emps.B.ids.meta } }),
      }));
      assert.equal(intactos.produtoA?.nome, 'Prod A');
      assert.equal(intactos.produtoB?.nome, 'Prod B');
      assert.equal(intactos.clienteA?.nome, `Cliente A ${SUF}`);
      assert.ok(intactos.metaB);
    });

    await t.test('dono acessa e edita os próprios registros normalmente', async () => {
      const r = await app.inject({ method: 'GET', url: `/produtos/${emps.A.ids.produto}`, headers: H(emps.A.token) });
      assert.equal(r.statusCode, 200);
      const u = await app.inject({ method: 'PUT', url: `/clientes/${emps.A.ids.cliente}`, headers: H(emps.A.token), payload: { nome: `Cliente A ${SUF} editado` } });
      assert.equal(u.statusCode, 200, u.body.slice(0, 150));
    });

    await t.test('usuário autenticado SEM permissão recebe 403 e não executa a operação', async () => {
      const email = `rlssemperm${SUF}@teste.local`;
      const dono = await comoSistema('teste:fixture', () => prisma.usuario.findFirst({ where: { empresaId: emps.A.empresaId }, select: { senhaHash: true } }));
      await comoSistema('teste:fixture', () =>
        prisma.usuario.create({ data: { empresaId: emps.A.empresaId, nome: 'Sem Permissao', email, senhaHash: dono!.senhaHash, status: 'ATIVO' } }),
      );
      const log = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'SenhaForte123' } });
      assert.equal(log.statusCode, 200, log.body.slice(0, 150));
      const tok = log.json().token;
      const lista = await app.inject({ method: 'GET', url: '/produtos', headers: H(tok) });
      assert.equal(lista.statusCode, 403);
      const cria = await app.inject({ method: 'POST', url: '/produtos', headers: H(tok), payload: { nome: 'Nao pode', sku: `NP${SUF}`, precoVenda: 1, custo: 1, unidade: 'UN' } });
      assert.equal(cria.statusCode, 403);
      const apaga = await app.inject({ method: 'DELETE', url: `/produtos/${emps.A.ids.produto}`, headers: H(tok) });
      assert.equal(apaga.statusCode, 403);
      const existe = await comoSistema('teste:conferir', () => prisma.produto.count({ where: { sku: `NP${SUF}` } }));
      assert.equal(existe, 0);
    });

    await t.test('sem token e com token adulterado: 401', async () => {
      assert.equal((await app.inject({ method: 'GET', url: '/produtos' })).statusCode, 401);
      const adulterado = emps.A.token.slice(0, -3) + 'xyz';
      assert.equal((await app.inject({ method: 'GET', url: '/produtos', headers: H(adulterado) })).statusCode, 401);
    });
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
});

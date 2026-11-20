/**
 * Concorrência em operações que mexem com estoque e financeiro.
 *
 * Requisições SIMULTÂNEAS (Promise.all) pelas rotas reais, no banco de teste:
 *  - 5 recebimentos da mesma compra ao mesmo tempo -> exatamente 1 aceito,
 *    1 lançamento financeiro, 1 movimentação, estoque +quantidade uma vez;
 *  - 2 compras DIFERENTES do mesmo produto recebidas ao mesmo tempo -> o
 *    estoque soma as duas (sem atualização perdida);
 *  - 12 vendas simultâneas disputando estoque 5 -> exatamente 5 aprovadas,
 *    estoque final 0, nunca negativo;
 *  - 6 aberturas simultâneas de caixa pelo mesmo usuário -> exatamente 1.
 * Roda como postgres e como nexus_app (RLS).
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
import { estoqueRoutes } from '../src/modules/estoque/estoque.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';

const url = new URL(process.env.DATABASE_URL || 'postgresql://x@invalido/x');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432' || url.pathname.replace(/^\/+/, '') !== 'nexus_os_test') {
  throw new Error('Teste bloqueado: este teste só pode usar localhost:5432/nexus_os_test.');
}

const SUF = Date.now().toString(36);

test('concorrência: compras, vendas e caixa sob requisições simultâneas', async (t) => {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (typeof error?.statusCode === 'number' && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    if (error?.constructor === Error) return reply.status(400).send({ error: error.message });
    return reply.status(500).send({ error: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register(registerAuthentication);
  for (const r of [authRoutes, empresaRoutes, produtosRoutes, comprasRoutes, estoqueRoutes, vendasRoutes, pdvRoutes]) await app.register(r);

  const email = `conc${SUF}@teste.local`;
  const reg = await app.inject({ method: 'POST', url: '/auth/register-company', payload: { nomeEmpresa: `Concorrencia ${SUF}`, nome: 'Dono Conc', email, senha: 'SenhaForte123' } });
  assert.equal(reg.statusCode, 201, reg.body);
  const tok = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'SenhaForte123' } })).json().token;
  const H = { authorization: `Bearer ${tok}` };
  const fil = (await app.inject({ method: 'GET', url: '/filiais', headers: H })).json();
  const filialId = (Array.isArray(fil) ? fil : fil.filiais)[0].id;
  const empresaId = (await app.inject({ method: 'GET', url: '/auth/me', headers: H })).json().company.id;

  const criarProduto = async (nome: string) => {
    const p = await app.inject({ method: 'POST', url: '/produtos', headers: H, payload: { nome, sku: `${nome}${SUF}`, precoVenda: 10, custo: 4, unidade: 'UN' } });
    assert.ok([200, 201].includes(p.statusCode), p.body);
    return p.json().id as string;
  };
  const saldo = async (produtoId: string) =>
    Number((await comoSistema('teste', () => prisma.estoque.findFirst({ where: { produtoId, filialId } })))?.quantidade ?? 0);
  const fornecedorId = (await app.inject({ method: 'POST', url: '/fornecedores', headers: H, payload: { nome: `Forn ${SUF}` } })).json().id;
  const criarCompraConfirmada = async (produtoId: string, quantidade: number, valorUnit: number) => {
    const c = await app.inject({ method: 'POST', url: '/compras', headers: H, payload: { fornecedorId, filialId, itens: [{ produtoId, quantidade, valorUnit }] } });
    assert.ok([200, 201].includes(c.statusCode), c.body);
    const id = c.json().id as string;
    const conf = await app.inject({ method: 'POST', url: `/compras/${id}/confirmar`, headers: H });
    assert.ok([200, 201].includes(conf.statusCode), conf.body);
    return id;
  };

  try {
    await t.test('5 recebimentos simultâneos da mesma compra: 1 aceito, 1 lançamento, estoque +7 uma vez', async () => {
      const produtoId = await criarProduto('RECEB');
      const compraId = await criarCompraConfirmada(produtoId, 7, 3);
      const res = await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: `/compras/${compraId}/receber`, headers: H })));
      const codigos = res.map((r) => r.statusCode).sort();
      assert.deepEqual(codigos, [200, 409, 409, 409, 409], `códigos: ${codigos}`);
      const [fin, mov] = await comoSistema('teste', () => Promise.all([
        prisma.financeiro.count({ where: { compraId } }),
        prisma.estoqueMovimentacao.findMany({ where: { documento: compraId } }),
      ]));
      assert.equal(fin, 1, 'lançamentos financeiros');
      assert.equal(mov.length, 1, 'movimentações');
      assert.equal(await saldo(produtoId), 7);
    });

    await t.test('2 compras diferentes do mesmo produto recebidas juntas: estoque soma as duas', async () => {
      const produtoId = await criarProduto('DUAS');
      const c1 = await criarCompraConfirmada(produtoId, 4, 2);
      const c2 = await criarCompraConfirmada(produtoId, 6, 5);
      const res = await Promise.all([c1, c2].map((id) => app.inject({ method: 'POST', url: `/compras/${id}/receber`, headers: H })));
      assert.deepEqual(res.map((r) => r.statusCode), [200, 200]);
      assert.equal(await saldo(produtoId), 10, 'sem atualização perdida');
      const produto = await comoSistema('teste', () => prisma.produto.findUnique({ where: { id: produtoId } }));
      // custo médio ponderado: (4*2 + 6*5) / 10 = 3.8
      assert.equal(Number(produto?.custo), 3.8);
    });

    await t.test('12 vendas simultâneas com estoque 5: exatamente 5 aprovadas, estoque 0', async () => {
      const produtoId = await criarProduto('VENDA');
      const mov = await app.inject({ method: 'POST', url: '/estoque/movimentar', headers: H, payload: { produtoId, filialId, tipo: 'ENTRADA', quantidade: 5, motivo: 'teste' } });
      assert.ok([200, 201].includes(mov.statusCode), mov.body);
      const res = await Promise.all(Array.from({ length: 12 }, () => app.inject({
        method: 'POST', url: '/vendas', headers: H,
        payload: { filialId, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 10 }] },
      })));
      const aprovadas = res.filter((r) => [200, 201].includes(r.statusCode)).length;
      assert.equal(aprovadas, 5, `códigos: ${res.map((r) => r.statusCode)}`);
      assert.ok(res.every((r) => r.statusCode < 500), 'nenhum 5xx');
      assert.equal(await saldo(produtoId), 0);
    });

    await t.test('6 aberturas simultâneas de caixa pelo mesmo usuário: exatamente 1', async () => {
      const res = await Promise.all(Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: H, payload: { filialId, fundoTroco: 10 } })));
      assert.equal(res.filter((r) => [200, 201].includes(r.statusCode)).length, 1, `códigos: ${res.map((r) => r.statusCode)}`);
    });
  } finally {
    await app.close();
    void empresaId;
    await prisma.$disconnect();
  }
});

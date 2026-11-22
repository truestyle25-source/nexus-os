/**
 * TESTE — Fase C3: pedidos do WooCommerce viram vendas (mesmo modelo do Mercado Livre).
 *
 * Pedidos no formato da REST API do WooCommerce (valores como texto, ids inteiros):
 *  - pedido pago → venda FINALIZADA, itens casados pelo SKU, pagamento registrado, baixa de
 *    estoque na filial; reimportar não duplica venda nem baixa;
 *  - cancelamento posterior → venda CANCELADA e estoque devolvido UMA vez;
 *  - SKU inexistente → não importa (relatório); failed → ignorado; moeda ≠ BRL → recusado;
 *  - pedido anterior à conexão → registra a venda sem baixar estoque;
 *  - 4 importações simultâneas do mesmo pedido → 1 venda e 1 baixa;
 *  - SKU de outra empresa nunca casa; rota sem conexão 409; loja real sem WooCommerce → erro claro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { encryptSecret } from '../src/lib/secrets.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { ErroDeNegocio } from '../src/lib/erros.js';
import { MODULOS, ACOES } from '../src/lib/permissoes-catalogo.js';
import { generateRandomValidCnpj } from '../src/domain/cnpj.js';
import { produtosRoutes } from '../src/modules/produtos/produtos.routes.js';
import { produtoFichaRoutes } from '../src/modules/produtos/produto-ficha.routes.js';
import { centralIntegracoesRoutes } from '../src/modules/integracoes/central/central.routes.js';
import { formaPagamentoWoo, importarPedidoWoo, statusVendaWoo, type PedidoWoo } from '../src/modules/integracoes/central/woocommerce-pedidos.service.js';

const URL_TESTE = process.env.DATABASE_URL ?? '';
const BANCO_DE_TESTE = /@(localhost|127\.0\.0\.1):5432\/nexus_os_test/.test(URL_TESTE);
const SUF = Date.now().toString(36);
const SEGREDO = 'segredo-teste-integracoes-fase-c3-012345678';
const LOJA = 'loja.exemplo.com.br';

test('regras: status e forma de pagamento', () => {
  assert.equal(statusVendaWoo({ id: 1, status: 'processing', date_paid_gmt: '2026-11-20T10:00:00' }), 'FINALIZADA');
  assert.equal(statusVendaWoo({ id: 1, status: 'on-hold' }), 'ABERTA');
  assert.equal(statusVendaWoo({ id: 1, status: 'completed' }), 'FINALIZADA');
  assert.equal(statusVendaWoo({ id: 1, status: 'refunded' }), 'CANCELADA');
  assert.equal(statusVendaWoo({ id: 1, status: 'failed' }), null);
  assert.equal(formaPagamentoWoo({ id: 1, payment_method: 'woo-mercado-pago-pix' }), 'PIX');
  assert.equal(formaPagamentoWoo({ id: 1, payment_method: 'bacs' }), 'TRANSFERENCIA');
  assert.equal(formaPagamentoWoo({ id: 1, payment_method: 'stripe' }), 'CARTAO_CREDITO');
  assert.equal(formaPagamentoWoo({ id: 1, payment_method: 'xyz' }), 'OUTRO');
});

async function montarApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.' });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno.', detalhe: String(error?.message).slice(0, 300) });
  });
  await app.register(jwt, { secret: SEGREDO });
  await registerAuthentication(app);
  for (const r of [produtosRoutes, produtoFichaRoutes, centralIntegracoesRoutes]) await app.register(r);
  await app.ready();
  return app;
}

async function criarEmpresa(nome: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `${nome} ${SUF}`, cnpj: generateRandomValidCnpj() } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: 'Matriz', status: 'ATIVO' } });
  const u = await prisma.usuario.create({ data: { empresaId: empresa.id, filialId: filial.id, nome: 'admin', email: `admin-${nome}-${SUF}@teste.local`.toLowerCase(), senhaHash: 'x' } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ usuarioId: u.id, modulo: m, acao: a, permitido: true }))) });
  return { empresa, filial, admin: u };
}

test('Fase C3 — pedidos WooCommerce em Vendas', { skip: !BANCO_DE_TESTE && 'exige localhost:5432/nexus_os_test' }, async (t) => {
  const app = await montarApp();
  const A = await criarEmpresa('C3A');
  const B = await criarEmpresa('C3B');
  const tok = (u: { id: string; empresaId: string; email: string }) => ({ authorization: `Bearer ${app.jwt.sign({ id: u.id, empresaId: u.empresaId, email: u.email, jti: `j-${u.id}`, emitidoEmMs: Date.now() } as any)}` });
  const H = tok(A.admin);
  const call = async (method: string, url: string, headers: any, payload?: any) => {
    const r = await app.inject({ method: method as any, url, headers, payload });
    let body: any; try { body = r.json(); } catch { body = r.body; }
    return { s: r.statusCode, b: body, raw: r.body };
  };
  const SKU = `CAN${SUF}`.toUpperCase();
  let produtoId = '';
  const saldo = async () => Number((await prisma.estoque.findUnique({ where: { filialId_produtoId: { filialId: A.filial.id, produtoId } } }))?.quantidade ?? 0);
  const base = { empresaId: A.empresa.id, filialId: A.filial.id, usuarioId: A.admin.id, loja: LOJA, fusoHorario: 'America/Sao_Paulo' };
  const conexao = new Date(Date.now() - 86400_000);
  const pedido = (id: number, extra: Partial<PedidoWoo> = {}): PedidoWoo => ({
    id, status: 'processing', currency: 'BRL', date_created_gmt: new Date().toISOString().slice(0, 19), date_paid_gmt: new Date().toISOString().slice(0, 19),
    total: '59.80', payment_method: 'pix', payment_method_title: 'PIX', line_items: [{ name: 'Caneca', sku: SKU, quantity: 2, price: '29.90' }], ...extra,
  });

  try {
    await t.test('preparação: produto com SKU e estoque 10', async () => {
      const cat = (await call('GET', '/produtos/catalogos', H)).b;
      const un = cat.unidades.find((u: any) => u.simbolo === 'UN');
      const p = await call('POST', '/produtos', H, { nome: `Caneca ${SUF}`, sku: SKU, custo: 12, precoVenda: 29.9, unidade: 'UN', unidadeBaseId: un.id });
      assert.equal(p.s, 200, p.raw.slice(0, 200)); produtoId = p.b.id;
      await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId: A.filial.id, produtoId } }, create: { empresaId: A.empresa.id, filialId: A.filial.id, produtoId, quantidade: 10 }, update: { quantidade: 10 } });
      assert.equal(await saldo(), 10);
    });

    await t.test('pedido pago vira venda FINALIZADA com baixa; reimportar não duplica', async () => {
      const r = await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1001) });
      assert.equal(r.acao, 'importada', r.detalhe);
      const v = await prisma.venda.findUniqueOrThrow({ where: { id: r.vendaId! }, include: { itens: true, pagamentos: true } });
      assert.equal(v.status, 'FINALIZADA'); assert.equal(Number(v.total), 59.8); assert.equal(v.formaPagamento, 'PIX'); assert.equal(v.origem, 'INTEGRACAO');
      assert.equal(v.itens.length, 1); assert.equal(Number(v.itens[0].quantidade), 2); assert.equal(v.pagamentos.length, 1);
      assert.equal(await saldo(), 8);
      assert.equal((await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1001) })).acao, 'duplicada');
      assert.equal(await prisma.venda.count({ where: { empresaId: A.empresa.id, idempotencyKey: `woo:order:${LOJA}:1001` } }), 1);
      assert.equal(await saldo(), 8, 'sem segunda baixa');
    });

    await t.test('cancelamento devolve o estoque uma única vez', async () => {
      const r = await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1001, { status: 'cancelled' }) });
      assert.equal(r.acao, 'atualizada');
      assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: r.vendaId! } })).status, 'CANCELADA');
      assert.equal(await saldo(), 10);
      assert.equal((await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1001, { status: 'refunded' }) })).acao, 'duplicada');
      assert.equal(await saldo(), 10, 'sem devolução dupla');
    });

    await t.test('SKU inexistente, failed e moeda estrangeira não viram venda', async () => {
      const semSku = await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1002, { line_items: [{ name: 'X', sku: 'NAO-EXISTE', quantity: 1, price: '5.00' }] }) });
      assert.equal(semSku.acao, 'semVinculoProduto'); assert.match(semSku.detalhe!, /NAO-EXISTE/);
      const vazioSku = await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1006, { line_items: [{ name: 'Sem código', sku: '', quantity: 1, price: '5.00' }] }) });
      assert.equal(vazioSku.acao, 'semVinculoProduto');
      assert.equal((await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1003, { status: 'failed' }) })).acao, 'ignorado');
      assert.equal((await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(1004, { currency: 'USD' }) })).acao, 'moedaNaoSuportada');
      assert.equal(await prisma.venda.count({ where: { empresaId: A.empresa.id, idempotencyKey: { in: [1002, 1003, 1004, 1006].map((n) => `woo:order:${LOJA}:${n}`) } } }), 0);
      assert.equal(await saldo(), 10);
    });

    await t.test('pedido anterior à conexão: registra a venda sem baixar estoque', async () => {
      const antigo = pedido(1005, { date_created_gmt: '2026-01-10T12:00:00', status: 'on-hold', date_paid_gmt: null });
      const r = await importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: antigo });
      assert.equal(r.acao, 'importada');
      assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: r.vendaId! } })).status, 'ABERTA');
      assert.equal(await saldo(), 10);
    });

    await t.test('4 importações simultâneas do mesmo pedido → 1 venda e 1 baixa', async () => {
      const rs = await Promise.all(Array.from({ length: 4 }, () => importarPedidoWoo({ ...base, inicioIntegracao: conexao, pedido: pedido(2001) })));
      assert.equal(rs.filter((r) => r.acao === 'importada').length, 1, JSON.stringify(rs.map((r) => r.acao)));
      assert.equal(await prisma.venda.count({ where: { empresaId: A.empresa.id, idempotencyKey: `woo:order:${LOJA}:2001` } }), 1);
      assert.equal(await saldo(), 8);
    });

    await t.test('SKU de outra empresa nunca casa', async () => {
      const r = await importarPedidoWoo({ ...base, empresaId: B.empresa.id, filialId: B.filial.id, usuarioId: B.admin.id, inicioIntegracao: conexao, pedido: pedido(3001) });
      assert.equal(r.acao, 'semVinculoProduto');
    });

    await t.test('rota: sem conexão 409; loja real sem WooCommerce → erro claro', async () => {
      assert.equal((await call('POST', '/integracoes/central/woocommerce/pedidos/importar', H, { filialId: A.filial.id })).s, 409);
      await prisma.integracaoExterno.create({ data: { empresaId: A.empresa.id, tipo: 'WOOCOMMERCE', nome: 'WooCommerce', status: 'CONECTADO', conectadoEm: conexao, config: { urlLoja: 'https://example.com' }, credenciais: encryptSecret(JSON.stringify({ consumerKey: 'ck_falso', consumerSecret: 'cs_falso' })) } });
      assert.equal((await call('POST', '/integracoes/central/woocommerce/pedidos/importar', H, { filialId: B.filial.id })).s, 404, 'filial de outra empresa');
      const r = await call('POST', '/integracoes/central/woocommerce/pedidos/importar', H, { filialId: A.filial.id });
      console.log('[c3 loja real]', r.s, r.b.error);
      assert.equal(r.s, 502);
    });
  } finally {
    await app.close();
    for (const e of [A, B]) {
      const id = e.empresa.id;
      await prisma.vendaPagamento.deleteMany({ where: { empresaId: id } }).catch(() => {});
      await prisma.vendaItem.deleteMany({ where: { venda: { empresaId: id } } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { empresaId: id } });
      await prisma.idempotencyKey.deleteMany({ where: { empresaId: id } });
      await prisma.venda.deleteMany({ where: { empresaId: id } });
      await prisma.estoque.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoEvento.deleteMany({ where: { empresaId: id } });
      await prisma.integracaoExterno.deleteMany({ where: { empresaId: id } });
      await prisma.auditoria.deleteMany({ where: { empresaId: id } });
      await prisma.produtoPrecoHistorico.deleteMany({ where: { produto: { empresaId: id } } }).catch(() => {});
      await prisma.produtoFilial.deleteMany({ where: { produto: { empresaId: id } } }).catch(() => {});
      await prisma.produto.deleteMany({ where: { empresaId: id } });
      await prisma.fatorConversao.deleteMany({ where: { empresaId: id } }).catch(() => {});
      await prisma.unidade.deleteMany({ where: { empresaId: id } });
      await prisma.dimensao.deleteMany({ where: { empresaId: id } });
      await prisma.tipoProduto.deleteMany({ where: { empresaId: id } });
      await prisma.categoria.deleteMany({ where: { empresaId: id } }).catch(() => {});
      await prisma.permissao.deleteMany({ where: { usuario: { empresaId: id } } });
      await prisma.usuario.deleteMany({ where: { empresaId: id } });
      await prisma.filial.deleteMany({ where: { empresaId: id } });
      await prisma.empresa.delete({ where: { id } }).catch((err) => console.log('[limpeza]', String(err.message).match(/constraint[^\n]*/)?.[0]));
    }
  }
});

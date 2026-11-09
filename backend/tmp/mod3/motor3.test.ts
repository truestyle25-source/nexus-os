// MÓDULO 03 — testes de estoque/disponibilidade/concorrência (autocontido).
// Roda contra o banco ISOLADO nexus_os_mod3 via DATABASE_URL definido no ambiente.
// Cria fixtures próprias (empresa/filial/usuário/produto/estoque) e usa o POST /vendas REAL.
import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma.js';
import { vendasRoutes } from '../../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../../src/middlewares/auth.js';
import { hashSenha } from '../../src/lib/auth.js';
import { MODULOS, ACOES } from '../../src/lib/permissoes-catalogo.js';

let passou = 0;
let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

const runId = Date.now().toString(36);

// Cria uma empresa/filial/usuário (com todas as permissões) e um app Fastify pronto.
async function criarTenant(sufixo: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `M3-${sufixo}-${runId}`, cnpj: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14) } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: `Filial ${sufixo}` } });
  const senhaHash = await hashSenha('senha12345');
  const usuario = await prisma.usuario.create({ data: { empresaId: empresa.id, nome: `Op ${sufixo}`, email: `m3-${sufixo}-${runId}@teste.local`, senhaHash } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true, usuarioId: usuario.id }))) });
  const app = Fastify();
  await app.register(jwt, { secret: 'segredo-mod3' });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email }, { expiresIn: '1h' });
  return { empresa, filial, usuario, app, token };
}

// Cria um produto ATIVO com saldo informado na filial.
async function criarProduto(empresaId: string, filialId: string, saldo: number, opts: { status?: 'ATIVO' | 'INATIVO'; nome?: string } = {}) {
  const id = randomUUID();
  await prisma.produto.create({ data: { id, empresaId, nome: opts.nome ?? `PROD-${id.slice(0, 6)}`, sku: `SKU-${id.slice(0, 8)}`, custo: 5, precoVenda: 100, unidade: 'UN', status: opts.status ?? 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId, produtoId: id } }, update: { quantidade: saldo }, create: { empresaId, filialId, produtoId: id, quantidade: saldo, valorTotal: saldo * 5 } });
  return id;
}

function vendaReq(app: any, token: string, filialId: string, itens: any[], key?: string) {
  return app.inject({ method: 'POST', url: '/vendas', headers: { authorization: `Bearer ${token}`, ...(key ? { 'x-idempotency-key': key } : {}) }, payload: { filialId, formaPagamento: 'DINHEIRO', itens } });
}

// Limpeza segura de tudo que pertence a uma empresa de teste (só o tenant criado).
async function limparTenant(empresaId: string) {
  const vendas = await prisma.venda.findMany({ where: { empresaId }, select: { id: true } });
  const vids = vendas.map((v) => v.id);
  if (vids.length) {
    await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vids } } });
    await prisma.idempotencyKey.deleteMany({ where: { vendaId: { in: vids } } });
    await prisma.financeiro.deleteMany({ where: { vendaId: { in: vids } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { documento: { in: vids } } });
    await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: { in: vids } } });
    await prisma.venda.deleteMany({ where: { id: { in: vids } } });
  }
  await prisma.idempotencyKey.deleteMany({ where: { empresaId } });
  const produtos = await prisma.produto.findMany({ where: { empresaId }, select: { id: true } });
  const pids = produtos.map((p) => p.id);
  if (pids.length) {
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: pids } } });
    await prisma.estoque.deleteMany({ where: { produtoId: { in: pids } } });
    await prisma.produto.deleteMany({ where: { id: { in: pids } } });
  }
  await prisma.permissao.deleteMany({ where: { usuario: { empresaId } } });
  await prisma.usuario.deleteMany({ where: { empresaId } });
  await prisma.filial.deleteMany({ where: { empresaId } });
  await prisma.empresa.deleteMany({ where: { id: empresaId } });
}


async function main() {
  console.log('=== MÓDULO 03 — Estoque/Disponibilidade/Concorrência (banco isolado) ===');

  // ── TESTE 1: Venda normal ──────────────────────────────────────────────
  {
    const t = await criarTenant('t1');
    const p = await criarProduto(t.empresa.id, t.filial.id, 10);
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p, quantidade: 3, desconto: 0 }], `t1-${runId}`);
    ok('T1 venda normal responde 201', r.statusCode === 201, `status=${r.statusCode} body=${r.body?.slice(0,160)}`);
    const vid = r.json()?.venda?.id;
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    ok('T1 saldo 10-3=7', est.quantidade === 7, `saldo=${est.quantidade}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { documento: vid, produtoId: p, tipo: 'VENDA' } });
    ok('T1 exatamente 1 movimentação de baixa', movs === 1, `movs=${movs}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 2: Múltiplos itens ───────────────────────────────────────────
  {
    const t = await criarTenant('t2');
    const p1 = await criarProduto(t.empresa.id, t.filial.id, 10);
    const p2 = await criarProduto(t.empresa.id, t.filial.id, 20);
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p1, quantidade: 2, desconto: 0 }, { produtoId: p2, quantidade: 5, desconto: 0 }], `t2-${runId}`);
    ok('T2 múltiplos itens 201', r.statusCode === 201, `status=${r.statusCode}`);
    const e1 = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p1 } } });
    const e2 = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p2 } } });
    ok('T2 p1 10-2=8', e1.quantidade === 8, `p1=${e1.quantidade}`);
    ok('T2 p2 20-5=15', e2.quantidade === 15, `p2=${e2.quantidade}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 3: Estoque insuficiente ──────────────────────────────────────
  {
    const t = await criarTenant('t3');
    const p = await criarProduto(t.empresa.id, t.filial.id, 2);
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p, quantidade: 5, desconto: 0 }], `t3-${runId}`);
    ok('T3 estoque insuficiente rejeitado (400/409/422)', [400, 409, 422].includes(r.statusCode), `status=${r.statusCode}`);
    ok('T3 nunca 500', r.statusCode !== 500, `status=${r.statusCode}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    ok('T3 saldo intacto (2)', est.quantidade === 2, `saldo=${est.quantidade}`);
    const vendas = await prisma.venda.count({ where: { empresaId: t.empresa.id, itens: { some: { produtoId: p } } } });
    ok('T3 nenhuma venda persistida', vendas === 0, `vendas=${vendas}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 4: Produto inativo ───────────────────────────────────────────
  {
    const t = await criarTenant('t4');
    const p = await criarProduto(t.empresa.id, t.filial.id, 10, { status: 'INATIVO' });
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p, quantidade: 1, desconto: 0 }], `t4-${runId}`);
    ok('T4 produto inativo rejeitado (400/404/422)', [400, 404, 422].includes(r.statusCode), `status=${r.statusCode}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    ok('T4 saldo intacto (10)', est.quantidade === 10, `saldo=${est.quantidade}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 5: Produto inexistente ───────────────────────────────────────
  {
    const t = await criarTenant('t5');
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: randomUUID(), quantidade: 1, desconto: 0 }], `t5-${runId}`);
    ok('T5 produto inexistente rejeitado (400/404/422)', [400, 404, 422].includes(r.statusCode), `status=${r.statusCode}`);
    const vendas = await prisma.venda.count({ where: { empresaId: t.empresa.id } });
    ok('T5 nenhuma venda persistida', vendas === 0, `vendas=${vendas}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 6: Isolamento entre empresas ─────────────────────────────────
  {
    const a = await criarTenant('t6a');
    const b = await criarTenant('t6b');
    const pB = await criarProduto(b.empresa.id, b.filial.id, 10);
    // Tenant A tenta vender produto de B usando sua própria filial.
    const r = await vendaReq(a.app, a.token, a.filial.id, [{ produtoId: pB, quantidade: 1, desconto: 0 }], `t6-${runId}`);
    ok('T6 cross-tenant rejeitado (400/404/422)', [400, 404, 422].includes(r.statusCode), `status=${r.statusCode}`);
    const estB = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: b.filial.id, produtoId: pB } } });
    ok('T6 estoque de B intacto (10)', estB.quantidade === 10, `saldoB=${estB.quantidade}`);
    await a.app.close(); await b.app.close(); await limparTenant(a.empresa.id); await limparTenant(b.empresa.id);
  }

  // ── TESTE 7: Concorrência crítica (10 requisições, 1 unidade) ──────────
  {
    const t = await criarTenant('t7');
    const p = await criarProduto(t.empresa.id, t.filial.id, 1);
    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.app.inject({ method: 'POST', url: '/vendas', headers: { authorization: `Bearer ${t.token}`, 'x-idempotency-key': `t7-${runId}-${i}` }, payload: { filialId: t.filial.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: p, quantidade: 1, desconto: 0 }] } }),
      ),
    );
    const sucessos = respostas.filter((r) => r.statusCode === 201);
    const rejeitados = respostas.filter((r) => r.statusCode !== 201);
    ok('T7 exatamente 1 venda vencedora', sucessos.length === 1, `sucessos=${sucessos.length} status=[${respostas.map((r) => r.statusCode).join(',')}]`);
    ok('T7 9 rejeitados', rejeitados.length === 9, `rejeitados=${rejeitados.length}`);
    ok('T7 nenhum 500', respostas.every((r) => r.statusCode !== 500), `status=[${respostas.map((r) => r.statusCode).join(',')}]`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    ok('T7 saldo final 0 (nunca negativo)', est.quantidade === 0, `saldo=${est.quantidade}`);
    const vendas = await prisma.venda.count({ where: { empresaId: t.empresa.id, itens: { some: { produtoId: p } } } });
    ok('T7 exatamente 1 venda persistida', vendas === 1, `vendas=${vendas}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { produtoId: p, tipo: 'VENDA' } });
    ok('T7 exatamente 1 baixa registrada', movs === 1, `movs=${movs}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 8: Reenvio idempotente (mesma chave) ─────────────────────────
  {
    const t = await criarTenant('t8');
    const p = await criarProduto(t.empresa.id, t.filial.id, 10);
    const key = `t8-${runId}`;
    const r1 = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p, quantidade: 2, desconto: 0 }], key);
    const r2 = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: p, quantidade: 2, desconto: 0 }], key);
    ok('T8 1º envio 201', r1.statusCode === 201, `status=${r1.statusCode}`);
    ok('T8 replay 201 (mesma venda)', r2.statusCode === 201, `status=${r2.statusCode}`);
    ok('T8 mesmo id de venda no replay', r1.json()?.venda?.id === r2.json()?.venda?.id, `id1=${r1.json()?.venda?.id} id2=${r2.json()?.venda?.id}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    ok('T8 baixa única 10-2=8', est.quantidade === 8, `saldo=${est.quantidade}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { produtoId: p, tipo: 'VENDA' } });
    ok('T8 exatamente 1 movimentação (sem duplicar)', movs === 1, `movs=${movs}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 9: Falha transacional (2º item sem estoque => rollback total) ─
  {
    const t = await criarTenant('t9');
    const pOk = await criarProduto(t.empresa.id, t.filial.id, 10);
    const pFalta = await criarProduto(t.empresa.id, t.filial.id, 0); // sem saldo
    const r = await vendaReq(t.app, t.token, t.filial.id, [{ produtoId: pOk, quantidade: 1, desconto: 0 }, { produtoId: pFalta, quantidade: 1, desconto: 0 }], `t9-${runId}`);
    ok('T9 operação rejeitada (400/409/422)', [400, 409, 422].includes(r.statusCode), `status=${r.statusCode}`);
    const estOk = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: pOk } } });
    ok('T9 rollback: item válido NÃO baixado (saldo 10)', estOk.quantidade === 10, `saldo=${estOk.quantidade}`);
    const vendas = await prisma.venda.count({ where: { empresaId: t.empresa.id } });
    ok('T9 nenhuma venda persistida', vendas === 0, `vendas=${vendas}`);
    const movsOk = await prisma.estoqueMovimentacao.count({ where: { produtoId: pOk, tipo: 'VENDA' } });
    ok('T9 nenhuma baixa parcial registrada', movsOk === 0, `movs=${movsOk}`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  // ── TESTE 10: Concorrência com estoque limitado (saldo 5, 10 reqs) ─────
  {
    const t = await criarTenant('t10');
    const p = await criarProduto(t.empresa.id, t.filial.id, 5);
    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.app.inject({ method: 'POST', url: '/vendas', headers: { authorization: `Bearer ${t.token}`, 'x-idempotency-key': `t10-${runId}-${i}` }, payload: { filialId: t.filial.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: p, quantidade: 1, desconto: 0 }] } }),
      ),
    );
    const vendasConfirmadas = respostas.filter((r) => r.statusCode === 201).length;
    ok('T7/T10 no máximo 5 vendas confirmadas (<= saldo)', vendasConfirmadas <= 5, `confirmadas=${vendasConfirmadas}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: p } } });
    const somaVendida = 5 - est.quantidade;
    ok('T10 soma vendida == vendas confirmadas', somaVendida === vendasConfirmadas, `somaVendida=${somaVendida} confirmadas=${vendasConfirmadas}`);
    ok('T10 saldo final nunca negativo', est.quantidade >= 0, `saldo=${est.quantidade}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { produtoId: p, tipo: 'VENDA' } });
    ok('T10 baixas == vendas confirmadas', movs === vendasConfirmadas, `movs=${movs} confirmadas=${vendasConfirmadas}`);
    console.log(`  info T10: ${vendasConfirmadas} vendas confirmadas, saldo final ${est.quantidade}, ${movs} baixas.`);
    await t.app.close(); await limparTenant(t.empresa.id);
  }

  console.log(`\n=== RESULTADO: passou=${passou} falhas=${falhas} ===`);
  await prisma.$disconnect();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('ERRO FATAL', e); await prisma.$disconnect(); process.exit(1); });



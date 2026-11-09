// MÓDULO 05 — Cancelamentos/Estornos/Devoluções (autocontido).
// Roda contra o banco ISOLADO nexus_os_mod5 via DATABASE_URL do ambiente.
// Harness reaproveitado do mod4 (comprovado). Exercita POST /vendas/:id/cancelar REAL.
import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma.js';
import { vendasRoutes } from '../../src/modules/vendas/vendas.routes.js';
import { pdvRoutes } from '../../src/modules/pdv/pdv.routes.js';
import { registerAuthentication } from '../../src/middlewares/auth.js';
import { hashSenha } from '../../src/lib/auth.js';
import { MODULOS, ACOES } from '../../src/lib/permissoes-catalogo.js';
import { ErroDeNegocio } from '../../src/lib/erros.js';

let passou = 0;
let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = '') {
  if (cond) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

const runId = Date.now().toString(36);

async function criarTenant(sufixo: string) {
  const empresa = await prisma.empresa.create({ data: { nome: `M5-${sufixo}-${runId}`, cnpj: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14) } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: `Filial ${sufixo}` } });
  const senhaHash = await hashSenha('senha12345');
  const usuario = await prisma.usuario.create({ data: { empresaId: empresa.id, nome: `Op ${sufixo}`, email: `m5-${sufixo}-${runId}@teste.local`, senhaHash } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true, usuarioId: usuario.id }))) });
  const app = Fastify();
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: 'segredo-mod5' });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email }, { expiresIn: '1h' });
  return { empresa, filial, usuario, app, token };
}

async function criarProduto(empresaId: string, filialId: string, saldo: number) {
  const id = randomUUID();
  await prisma.produto.create({ data: { id, empresaId, nome: `PROD-${id.slice(0, 6)}`, sku: `SKU-${id.slice(0, 8)}`, custo: 5, precoVenda: 100, unidade: 'UN', status: 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId, produtoId: id } }, update: { quantidade: saldo }, create: { empresaId, filialId, produtoId: id, quantidade: saldo, valorTotal: saldo * 5 } });
  return id;
}

function H(t: { app: any; token: string }) { return { authorization: `Bearer ${t.token}` }; }

function abrir(t: any, fundoTroco: number) {
  return t.app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: H(t), payload: { filialId: t.filial.id, fundoTroco } });
}
function fechar(t: any, valorContado?: number) {
  return t.app.inject({ method: 'POST', url: '/pdv/caixa/fechar', headers: H(t), payload: valorContado === undefined ? {} : { valorContado } });
}
function vendaReq(t: any, itens: any[], opts: { key?: string; caixaId?: string; pagamentos?: any[] } = {}) {
  return t.app.inject({
    method: 'POST', url: '/vendas',
    headers: { ...H(t), ...(opts.key ? { 'x-idempotency-key': opts.key } : {}) },
    payload: { filialId: t.filial.id, formaPagamento: 'DINHEIRO', itens, ...(opts.caixaId ? { caixaId: opts.caixaId } : {}), ...(opts.pagamentos ? { pagamentos: opts.pagamentos } : {}) },
  });
}
function cancelar(t: any, vendaId: string, body: any = { motivo: 'Cancelamento de teste' }) {
  return t.app.inject({ method: 'POST', url: `/vendas/${vendaId}/cancelar`, headers: H(t), payload: body });
}
async function saldo(caixaId: string) {
  const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } });
  return Number(c.saldo);
}

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
  const caixas = await prisma.caixa.findMany({ where: { empresaId }, select: { id: true } });
  const cids = caixas.map((c) => c.id);
  if (cids.length) {
    await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId: { in: cids } } });
    await prisma.caixa.deleteMany({ where: { id: { in: cids } } });
  }
  await prisma.idempotencyKey.deleteMany({ where: { empresaId } });
  await prisma.auditoria.deleteMany({ where: { empresaId } });
  await prisma.indicadorDiario.deleteMany({ where: { empresaId } });
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
  console.log('=== MÓDULO 05 — Cancelamentos/Estornos/Devoluções (banco isolado) ===');

  // Turno principal t1 para T01+T02 (cancelar → cancelar de novo).
  const t1 = await criarTenant('t1');
  const prod = await criarProduto(t1.empresa.id, t1.filial.id, 10);
  let cid1 = '';
  let vid1 = '';

  // ── T01: Cancelamento válido (dinheiro + caixa aberto) — efeitos consistentes ──
  {
    const ab = await abrir(t1, 100);
    cid1 = ab.json()?.id;
    const rv = await vendaReq(t1, [{ produtoId: prod, quantidade: 2, desconto: 0 }], { caixaId: cid1, key: `m5-t01-${runId}` });
    ok('T01 venda base 201 (saldo 300, estoque 8)', rv.statusCode === 201 && (await saldo(cid1)) === 300, `status=${rv.statusCode}`);
    vid1 = rv.json()?.venda?.id;
    const estAntes = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t1.filial.id, produtoId: prod } } });
    ok('T01 estoque baixado na venda (8)', estAntes.quantidade === 8, `estoque=${estAntes.quantidade}`);
    const indAntes = await prisma.indicadorDiario.findUnique({ where: { empresaId_filialId_data: { empresaId: t1.empresa.id, filialId: t1.filial.id, data: new Date() } } }).catch(() => null);
    const rc = await cancelar(t1, vid1, { motivo: 'Defeito no produto' });
    ok('T01 cancelamento 200', rc.statusCode === 200, `status=${rc.statusCode} ${rc.body?.slice(0, 120)}`);
    const v = await prisma.venda.findUniqueOrThrow({ where: { id: vid1 }, include: { itens: true } });
    ok('T01 status CANCELADA persistido', v.status === 'CANCELADA', `status=${v.status}`);
    ok('T01 dados originais preservados (total 200, item qtd 2)', Number(v.total) === 200 && v.itens.length === 1 && v.itens[0].quantidade === 2);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t1.filial.id, produtoId: prod } } });
    ok('T01 estoque reposto 8→10', est.quantidade === 10, `estoque=${est.quantidade}`);
    const movDev = await prisma.estoqueMovimentacao.findMany({ where: { documento: vid1, tipo: 'DEVOLUCAO' } });
    ok('T01 1 movimentação DEVOLUCAO (+2) e nenhuma duplicada', movDev.length === 1 && movDev[0].quantidade === 2, `movs=${movDev.length} qtd=${movDev[0]?.quantidade}`);
    const s = await saldo(cid1);
    ok('T01 caixa estornou só o dinheiro (300-200=100)', s === 100, `saldo=${s}`);
    const sangria = await prisma.movimentacaoCaixa.findMany({ where: { caixaId: cid1, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
    ok('T01 1 sangria AUTOMATICO vinculada à venda (200)', sangria.length === 1 && Number(sangria[0].valor) === 200 && sangria[0].vendaId === vid1, `movs=${sangria.length}`);
    const fin = await prisma.financeiro.findMany({ where: { vendaId: vid1 } });
    ok('T01 financeiro: nenhum registro da venda com status ≠ CANCELADO', fin.every((f) => f.status === 'CANCELADO'), JSON.stringify(fin.map((f) => f.status)));
    if (indAntes) {
      const indDepois = await prisma.indicadorDiario.findUniqueOrThrow({ where: { id: indAntes.id } });
      ok('T01 indicador diário estornado (faturamento −200, qtd −1)', Number(indDepois.faturamento) === Math.max(0, Number(indAntes.faturamento) - 200) && indDepois.qtdVendas === Math.max(0, indAntes.qtdVendas - 1), `antes=${indAntes.faturamento}/${indAntes.qtdVendas} depois=${indDepois.faturamento}/${indDepois.qtdVendas}`);
    } else {
      console.log('  info T01: indicador diário não existia para esta data (venda não gerou linha) — assert ignorado');
    }
    const aud = await prisma.auditoria.findFirst({ where: { entidade: 'Venda', entidadeId: vid1, acao: 'EDITAR' } });
    ok('T01 auditoria registra o cancelamento com motivo', !!aud && String((aud as any).contexto ?? '').includes('Defeito no produto'), `aud=${aud ? 'sim' : 'nao'}`);
  }

  // ── T02: Cancelamento duplicado — nenhum efeito repetido ──
  {
    const rc = await cancelar(t1, vid1);
    ok('T02 segunda chamada rejeitada (409 conflito)', rc.statusCode === 409, `status=${rc.statusCode} ${rc.body?.slice(0, 120)}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t1.filial.id, produtoId: prod } } });
    ok('T02 estoque NÃO reposto 2x (continua 10)', est.quantidade === 10, `estoque=${est.quantidade}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { documento: vid1, tipo: 'DEVOLUCAO' } });
    ok('T02 continua 1 movimentação DEVOLUCAO', movs === 1, `movs=${movs}`);
    const sangrias = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid1, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
    ok('T02 continua 1 sangria automática', sangrias === 1, `sangrias=${sangrias}`);
    const s = await saldo(cid1);
    ok('T02 saldo intacto (100)', s === 100, `saldo=${s}`);
  }

  // ── T03: Cancelamentos simultâneos — apenas um efeito efetivo ──
  {
    const rv = await vendaReq(t1, [{ produtoId: prod, quantidade: 1, desconto: 0 }], { caixaId: cid1, key: `m5-t03-${runId}` });
    const vid = rv.json()?.venda?.id;
    ok('T03 venda base 201 (saldo 200, estoque 9)', rv.statusCode === 201 && (await saldo(cid1)) === 200, `status=${rv.statusCode}`);
    const [r1, r2] = await Promise.all([cancelar(t1, vid), cancelar(t1, vid)]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    ok('T03 exatamente 1 sucesso + 1 conflito (200,409)', codes[0] === 200 && codes[1] === 409, `codes=${codes}`);
    const movs = await prisma.estoqueMovimentacao.count({ where: { documento: vid, tipo: 'DEVOLUCAO' } });
    ok('T03 estoque reposto UMA vez (10)', movs === 1 && (await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t1.filial.id, produtoId: prod } } })).quantidade === 10, `movs=${movs}`);
    const sangrias = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid1, tipo: 'SANGRIA', origem: 'AUTOMATICO', vendaId: vid } });
    ok('T03 UMA sangria automática (100)', sangrias === 1, `sangrias=${sangrias}`);
    const s = await saldo(cid1);
    ok('T03 saldo estornado uma vez (200-100=100)', s === 100, `saldo=${s}`);
  }

  // ── T04: Venda inexistente — rejeitada sem efeitos ──
  {
    const rc = await cancelar(t1, randomUUID());
    ok('T04 venda inexistente → 404', rc.statusCode === 404, `status=${rc.statusCode}`);
    ok('T04 saldo intacto (100)', (await saldo(cid1)) === 100);
    await t1.app.close(); await limparTenant(t1.empresa.id);
  }

  // ── T05: Venda de outra empresa — isolamento ──
  {
    const tA = await criarTenant('t8a');
    const tB = await criarTenant('t8b');
    try {
      const pA = await criarProduto(tA.empresa.id, tA.filial.id, 10);
      const rv = await vendaReq(tA, [{ produtoId: pA, quantidade: 1, desconto: 0 }], { key: `m5-t05-${runId}` });
      const vidA = rv.json()?.venda?.id;
      ok('T05 venda A 201', rv.statusCode === 201, `status=${rv.statusCode}`);
      const rc = await cancelar(tB, vidA);
      ok('T05 cancelamento cross-tenant → 404', rc.statusCode === 404, `status=${rc.statusCode}`);
      const vA = await prisma.venda.findUniqueOrThrow({ where: { id: vidA } });
      ok('T05 venda A permanece FINALIZADA', vA.status === 'FINALIZADA', `status=${vA.status}`);
      const estA = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: tA.filial.id, produtoId: pA } } });
      ok('T05 estoque de A intacto (9)', estA.quantidade === 9, `estoque=${estA.quantidade}`);
    } finally {
      await tA.app.close(); await limparTenant(tA.empresa.id);
      await tB.app.close(); await limparTenant(tB.empresa.id);
    }
  }

  // ── T06: Falha transacional CONTROLADA — rollback total ──
  // Após a venda, remove-se o produto (fixture) fazendo aplicarMovimento falhar
  // no meio do cancelamento. O status CANCELADA gravado antes deve ser desfeito.
  {
    const t6 = await criarTenant('t6');
    try {
      const p6 = await criarProduto(t6.empresa.id, t6.filial.id, 10);
      const ab = await abrir(t6, 100);
      const cid6 = ab.json()?.id;
      const rv = await vendaReq(t6, [{ produtoId: p6, quantidade: 2, desconto: 0 }], { caixaId: cid6, key: `m5-t06-${runId}` });
      const vid6 = rv.json()?.venda?.id;
      ok('T06 venda base 201 (saldo 300)', rv.statusCode === 201 && (await saldo(cid6)) === 300, `status=${rv.statusCode}`);
      // Quebra controlada: remove produto (FK RESTRICT exige remover movs/estoque antes).
      await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: p6 } });
      await prisma.estoque.deleteMany({ where: { produtoId: p6 } });
      await prisma.produto.deleteMany({ where: { id: p6 } });
      const rc = await cancelar(t6, vid6);
      ok('T06 cancelamento falha com 4xx (produto ausente)', rc.statusCode >= 400 && rc.statusCode < 500, `status=${rc.statusCode}`);
      const v = await prisma.venda.findUniqueOrThrow({ where: { id: vid6 } });
      ok('T06 ROLLBACK: status continua FINALIZADA', v.status === 'FINALIZADA', `status=${v.status}`);
      const s = await saldo(cid6);
      ok('T06 ROLLBACK: caixa intacto (300)', s === 300, `saldo=${s}`);
      const sangrias = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid6, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
      ok('T06 ROLLBACK: nenhuma sangria automática', sangrias === 0, `sangrias=${sangrias}`);
    } finally {
      await t6.app.close(); await limparTenant(t6.empresa.id);
    }
  }

  // ── T07: estornarEstoque=false — estoque NÃO é reposto ──
  {
    const t7 = await criarTenant('t7');
    try {
      const p7 = await criarProduto(t7.empresa.id, t7.filial.id, 10);
      const ab = await abrir(t7, 100);
      const cid7 = ab.json()?.id;
      const rv = await vendaReq(t7, [{ produtoId: p7, quantidade: 2, desconto: 0 }], { caixaId: cid7, key: `m5-t07-${runId}` });
      const vid7 = rv.json()?.venda?.id;
      const rc = await cancelar(t7, vid7, { motivo: 'Cancelamento sem estorno de estoque', estornarEstoque: false });
      ok('T07 cancelamento 200', rc.statusCode === 200, `status=${rc.statusCode}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t7.filial.id, produtoId: p7 } } });
      ok('T07 estoque permanece 8 (não reposto)', est.quantidade === 8, `estoque=${est.quantidade}`);
      const movs = await prisma.estoqueMovimentacao.count({ where: { documento: vid7, tipo: 'DEVOLUCAO' } });
      ok('T07 nenhuma movimentação DEVOLUCAO', movs === 0, `movs=${movs}`);
      const s = await saldo(cid7);
      ok('T07 financeiro ESTORNA mesmo sem estoque (100)', s === 100, `saldo=${s}`);
    } finally {
      await t7.app.close(); await limparTenant(t7.empresa.id);
    }
  }

  // ── T08: estornarFinanceiro=false — caixa NÃO muda; estoque repõe ──
  {
    const t8 = await criarTenant('t8');
    try {
      const p8 = await criarProduto(t8.empresa.id, t8.filial.id, 10);
      const ab = await abrir(t8, 100);
      const cid8 = ab.json()?.id;
      const rv = await vendaReq(t8, [{ produtoId: p8, quantidade: 1, desconto: 0 }], { caixaId: cid8, key: `m5-t08-${runId}` });
      const vid8 = rv.json()?.venda?.id;
      const rc = await cancelar(t8, vid8, { motivo: 'Cancelamento sem estorno financeiro', estornarFinanceiro: false });
      ok('T08 cancelamento 200', rc.statusCode === 200, `status=${rc.statusCode}`);
      const s = await saldo(cid8);
      ok('T08 caixa intacto (200) — dinheiro NÃO devolvido', s === 200, `saldo=${s}`);
      const sangrias = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid8, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
      ok('T08 nenhuma sangria automática', sangrias === 0, `sangrias=${sangrias}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t8.filial.id, produtoId: p8 } } });
      ok('T08 estoque reposto (10) — estorno de estoque é independente', est.quantidade === 10, `estoque=${est.quantidade}`);
    } finally {
      await t8.app.close(); await limparTenant(t8.empresa.id);
    }
  }

  // ── T09: Pagamento misto — estorna SOMENTE a parcela em dinheiro ──
  // A API bloqueia eletrônico sem provider (503); a fixture representa venda
  // mista registrada por outro fluxo e valida a CONTA de dinheiroEstornado.
  {
    const t9 = await criarTenant('t9');
    try {
      const p9 = await criarProduto(t9.empresa.id, t9.filial.id, 10);
      const ab = await abrir(t9, 100);
      const cid9 = ab.json()?.id;
      const vM = await prisma.venda.create({ data: { empresaId: t9.empresa.id, filialId: t9.filial.id, caixaId: cid9, status: 'FINALIZADA', subtotal: 100, total: 100, formaPagamento: 'DINHEIRO', origem: 'MANUAL', itens: { create: [{ produtoId: p9, quantidade: 1, preco: 100, custoUnitario: 5, desconto: 0, total: 100 }] } } });
      await prisma.vendaPagamento.createMany({ data: [{ vendaId: vM.id, empresaId: t9.empresa.id, forma: 'DINHEIRO', valor: 40 }, { vendaId: vM.id, empresaId: t9.empresa.id, forma: 'CARTAO_DEBITO', valor: 60 }] });
      const rc = await cancelar(t9, vM.id, { motivo: 'Cancelamento de venda mista' });
      ok('T09 cancelamento 200', rc.statusCode === 200, `status=${rc.statusCode}`);
      const s = await saldo(cid9);
      ok('T09 caixa estornou SÓ os R$40 de dinheiro (100−40=60)', s === 60, `saldo=${s}`);
      const sangria = await prisma.movimentacaoCaixa.findMany({ where: { caixaId: cid9, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
      ok('T09 sangria automática = 40 (parcela dinheiro)', sangria.length === 1 && Number(sangria[0].valor) === 40, `valor=${sangria[0]?.valor}`);
      const pags = await prisma.vendaPagamento.findMany({ where: { vendaId: vM.id }, orderBy: { valor: 'asc' } });
      ok('T09 pagamentos originais preservados (40 e 60)', pags.length === 2 && Number(pags[0].valor) === 40 && Number(pags[1].valor) === 60, `pags=${pags.map((p) => p.valor).join(',')}`);
    } finally {
      await t9.app.close(); await limparTenant(t9.empresa.id);
    }
  }

  // ── T10: Caixa fechado — estoque repõe, caixa intocado (correção M04 preservada) ──
  {
    const t10 = await criarTenant('t10');
    try {
      const p10 = await criarProduto(t10.empresa.id, t10.filial.id, 10);
      const ab = await abrir(t10, 100);
      const cid10 = ab.json()?.id;
      const rv = await vendaReq(t10, [{ produtoId: p10, quantidade: 2, desconto: 0 }], { caixaId: cid10, key: `m5-t10-${runId}` });
      const vid10 = rv.json()?.venda?.id;
      await fechar(t10, 300);
      const rc = await cancelar(t10, vid10, { motivo: 'Cancelamento pós-fechamento' });
      ok('T10 cancelamento aceito com caixa fechado', rc.statusCode === 200, `status=${rc.statusCode}`);
      const v = await prisma.venda.findUniqueOrThrow({ where: { id: vid10 } });
      ok('T10 status CANCELADA', v.status === 'CANCELADA', `status=${v.status}`);
      const c = await prisma.caixa.findUniqueOrThrow({ where: { id: cid10 } });
      ok('T10 saldo do caixa fechado inalterado (300)', Number(c.saldo) === 300, `saldo=${c.saldo}`);
      ok('T10 status do caixa continua FECHADO', c.status === 'FECHADO', `status=${c.status}`);
      const auto = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid10, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
      ok('T10 nenhuma sangria automática no caixa fechado', auto === 0, `auto=${auto}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t10.filial.id, produtoId: p10 } } });
      ok('T10 estoque reposto (10) mesmo com caixa fechado', est.quantidade === 10, `estoque=${est.quantidade}`);
    } finally {
      await t10.app.close(); await limparTenant(t10.empresa.id);
    }
  }

  // ── T11: Permissões — sem vendas:editar nem pdv:editar → 403 ──
  {
    const t11 = await criarTenant('t11');
    try {
      const p11 = await criarProduto(t11.empresa.id, t11.filial.id, 10);
      const rv = await vendaReq(t11, [{ produtoId: p11, quantidade: 1, desconto: 0 }], { key: `m5-t11-${runId}` });
      const vid11 = rv.json()?.venda?.id;
      const senhaHash = await hashSenha('senha12345');
      const leitor = await prisma.usuario.create({ data: { empresaId: t11.empresa.id, nome: 'Leitor', email: `m5-leitor-${runId}@teste.local`, senhaHash } });
      await prisma.permissao.createMany({ data: [{ usuarioId: leitor.id, modulo: 'vendas', acao: 'visualizar', permitido: true }] });
      const tokenL = t11.app.jwt.sign({ id: leitor.id, empresaId: t11.empresa.id, email: leitor.email }, { expiresIn: '1h' });
      const rc = await t11.app.inject({ method: 'POST', url: `/vendas/${vid11}/cancelar`, headers: { authorization: `Bearer ${tokenL}` }, payload: { motivo: 'Tentativa sem permissão' } });
      ok('T11 cancelamento sem permissão → 403', rc.statusCode === 403, `status=${rc.statusCode}`);
      const v = await prisma.venda.findUniqueOrThrow({ where: { id: vid11 } });
      ok('T11 venda permanece FINALIZADA', v.status === 'FINALIZADA', `status=${v.status}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t11.filial.id, produtoId: p11 } } });
      ok('T11 estoque intacto (9)', est.quantidade === 9, `estoque=${est.quantidade}`);
    } finally {
      await t11.app.close(); await limparTenant(t11.empresa.id);
    }
  }

  // ── T12: Venda não FINALIZADA (ABERTA) não pode ser cancelada ──
  {
    const t12 = await criarTenant('t12');
    try {
      const p12 = await criarProduto(t12.empresa.id, t12.filial.id, 10);
      const vAberta = await prisma.venda.create({ data: { empresaId: t12.empresa.id, filialId: t12.filial.id, status: 'ABERTA', subtotal: 100, total: 100, formaPagamento: 'DINHEIRO', origem: 'MANUAL', itens: { create: [{ produtoId: p12, quantidade: 1, preco: 100, custoUnitario: 5, desconto: 0, total: 100 }] } } });
      const rc = await cancelar(t12, vAberta.id, { motivo: 'Tentativa de estorno de ABERTA' });
      ok('T12 venda ABERTA → conflito (409)', rc.statusCode === 409, `status=${rc.statusCode} ${rc.body?.slice(0, 100)}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t12.filial.id, produtoId: p12 } } });
      ok('T12 estoque intacto (10) — ABERTA nunca baixou', est.quantidade === 10, `estoque=${est.quantidade}`);
    } finally {
      await t12.app.close(); await limparTenant(t12.empresa.id);
    }
  }

  // Devolução parcial/totaIS EXCE: funcionalidade NÃO EXISTE no sistema
  // (nenhuma rota/modelo). Conforme seção 7 do prompt: documentar a limitação
  // e propor próximo passo — não fabricar implementação de teste.

  console.log(`\n=== RESULTADO: passou=${passou} falhas=${falhas} ===`);
  await prisma.$disconnect();
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });






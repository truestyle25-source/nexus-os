// MÓDULO 04 — Caixa/Movimentações/Fechamento (autocontido).
// Roda contra o banco ISOLADO nexus_os_mod4 via DATABASE_URL do ambiente.
// Fixtures próprias; exercita as rotas REAIS de caixa + POST /vendas + cancelar.
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

async function criarTenant(sufixo: string, acoes: string[] | null = null) {
  const empresa = await prisma.empresa.create({ data: { nome: `M4-${sufixo}-${runId}`, cnpj: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14) } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: `Filial ${sufixo}` } });
  const senhaHash = await hashSenha('senha12345');
  const usuario = await prisma.usuario.create({ data: { empresaId: empresa.id, nome: `Op ${sufixo}`, email: `m4-${sufixo}-${runId}@teste.local`, senhaHash } });
  const pares = acoes === null
    ? MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a })))
    : acoes.map((p) => { const [modulo, acao] = p.split(':'); return { modulo, acao }; });
  await prisma.permissao.createMany({ data: pares.map((p) => ({ ...p, permitido: true, usuarioId: usuario.id })) });
  const app = Fastify();
  // Espelha o handler global do server.ts (ZodError→400, ErroDeNegocio→status):
  // sem ele, o Fastify default devolveria 500 para ZodError e o teste mediria
  // o harness, não o servidor.
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: 'segredo-mod4' });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: empresa.id, email: usuario.email }, { expiresIn: '1h' });
  return { empresa, filial, usuario, app, token };
}

async function criarProduto(empresaId: string, filialId: string, saldo: number, opts: { status?: 'ATIVO' | 'INATIVO' } = {}) {
  const id = randomUUID();
  await prisma.produto.create({ data: { id, empresaId, nome: `PROD-${id.slice(0, 6)}`, sku: `SKU-${id.slice(0, 8)}`, custo: 5, precoVenda: 100, unidade: 'UN', status: opts.status ?? 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId, produtoId: id } }, update: { quantidade: saldo }, create: { empresaId, filialId, produtoId: id, quantidade: saldo, valorTotal: saldo * 5 } });
  return id;
}

function H(t: { app: any; token: string }) { return { authorization: `Bearer ${t.token}` }; }

function abrir(t: any, fundoTroco: number, filialId?: string) {
  return t.app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: H(t), payload: { filialId: filialId ?? t.filial.id, fundoTroco } });
}
function mov(t: any, tipo: string, valor: number, motivo?: string) {
  return t.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: H(t), payload: { tipo, valor, ...(motivo ? { motivo } : {}) } });
}
function fechar(t: any, valorContado?: number) {
  return t.app.inject({ method: 'POST', url: '/pdv/caixa/fechar', headers: H(t), payload: valorContado === undefined ? {} : { valorContado } });
}
function vendaReq(t: any, filialId: string, itens: any[], opts: { key?: string; caixaId?: string; pagamentos?: any[] } = {}) {
  return t.app.inject({
    method: 'POST', url: '/vendas',
    headers: { ...H(t), ...(opts.key ? { 'x-idempotency-key': opts.key } : {}) },
    payload: { filialId, formaPagamento: 'DINHEIRO', itens, ...(opts.caixaId ? { caixaId: opts.caixaId } : {}), ...(opts.pagamentos ? { pagamentos: opts.pagamentos } : {}) },
  });
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
  console.log('=== MÓDULO 04 — Caixa/Movimentações/Fechamento (banco isolado) ===');

  const t1 = await criarTenant('t1');
  const prod = await criarProduto(t1.empresa.id, t1.filial.id, 50);
  let caixaId = '';

  // ── T01: Abertura ──
  {
    const r = await abrir(t1, 100);
    ok('T01 abertura 200', r.statusCode === 200, `status=${r.statusCode} ${r.body?.slice(0, 120)}`);
    const c = r.json();
    caixaId = c?.id;
    ok('T01 saldo=fundoTroco=100', Number(c?.saldo) === 100, `saldo=${c?.saldo}`);
    ok('T01 status ABERTO', c?.status === 'ABERTO', `status=${c?.status}`);
    ok('T01 empresa/filial/usuário corretos', c?.empresaId === t1.empresa.id && c?.filialId === t1.filial.id && c?.usuarioId === t1.usuario.id);
    const abertura = await prisma.movimentacaoCaixa.findMany({ where: { caixaId, tipo: 'ABERTURA' } });
    ok('T01 movimentação ABERTURA registrada (100)', abertura.length === 1 && Number(abertura[0].valor) === 100, `movs=${abertura.length}`);
    const atual = await t1.app.inject({ method: 'GET', url: '/pdv/caixa/atual', headers: H(t1) });
    ok('T01 GET /pdv/caixa/atual devolve o caixa', atual.json()?.id === caixaId);
  }

  // ── T02: Abertura duplicada ──
  {
    const r = await abrir(t1, 50);
    ok('T02 segunda abertura rejeitada 409', r.statusCode === 409, `status=${r.statusCode}`);
    const total = await prisma.caixa.count({ where: { empresaId: t1.empresa.id, usuarioId: t1.usuario.id, status: 'ABERTO' } });
    ok('T02 apenas 1 caixa aberto persistido', total === 1, `total=${total}`);
  }

  // ── T03: Venda em dinheiro atualiza saldo físico ──
  {
    const r = await vendaReq(t1, t1.filial.id, [{ produtoId: prod, quantidade: 3, desconto: 0 }], { caixaId, key: `m4-t03-${runId}` });
    ok('T03 venda 201', r.statusCode === 201, `status=${r.statusCode} ${r.body?.slice(0, 140)}`);
    const s = await saldo(caixaId);
    ok('T03 saldo 100+300=400', s === 400, `saldo=${s}`);
  }

  // ── T04: PIX sem provider → 503, sem efeitos ──
  {
    const pix = await vendaReq(t1, t1.filial.id, [{ produtoId: prod, quantidade: 1, desconto: 0 }], { caixaId, pagamentos: [{ forma: 'PIX', valor: 100 }] });
    ok('T04 PIX sem provider rejeitado 503 (sem confirmação falsa)', pix.statusCode === 503, `status=${pix.statusCode}`);
    const s = await saldo(caixaId);
    ok('T04 saldo inalterado após 503', s === 400, `saldo=${s}`);
  }

  // ── T05: Pagamento misto — separação dinheiro × eletrônico no resumo ──
  {
    const tE = await criarTenant('te');
    try {
      const pe = await criarProduto(tE.empresa.id, tE.filial.id, 10);
      const ab = await abrir(tE, 50);
      const cidE = ab.json()?.id;
      const rd = await vendaReq(tE, tE.filial.id, [{ produtoId: pe, quantidade: 1, desconto: 0 }], { caixaId: cidE, key: `m4-te-din-${runId}` });
      ok('T05 venda dinheiro 201 (base)', rd.statusCode === 201, `status=${rd.statusCode}`);
      // Fixtures diretas representam vendas eletrônicas registradas por outro fluxo:
      // testam a CONTA do resumoDoCaixa (não a confirmação da API).
      const vC = await prisma.venda.create({ data: { empresaId: tE.empresa.id, filialId: tE.filial.id, caixaId: cidE, status: 'FINALIZADA', subtotal: 150, total: 150, formaPagamento: 'CARTAO_CREDITO', origem: 'MANUAL', itens: { create: [{ produtoId: pe, quantidade: 1, preco: 150, custoUnitario: 5, desconto: 0, total: 150 }] } } });
      await prisma.vendaPagamento.create({ data: { vendaId: vC.id, empresaId: tE.empresa.id, forma: 'CARTAO_CREDITO', valor: 150 } });
      const vM = await prisma.venda.create({ data: { empresaId: tE.empresa.id, filialId: tE.filial.id, caixaId: cidE, status: 'FINALIZADA', subtotal: 100, total: 100, formaPagamento: 'DINHEIRO', origem: 'MANUAL', itens: { create: [{ produtoId: pe, quantidade: 1, preco: 100, custoUnitario: 5, desconto: 0, total: 100 }] } } });
      await prisma.vendaPagamento.createMany({ data: [{ vendaId: vM.id, empresaId: tE.empresa.id, forma: 'DINHEIRO', valor: 40 }, { vendaId: vM.id, empresaId: tE.empresa.id, forma: 'CARTAO_DEBITO', valor: 60 }] });
      const rr = (await tE.app.inject({ method: 'GET', url: '/pdv/caixa/resumo', headers: H(tE) })).json();
      ok('T05 dinheiroVendas conta só DINHEIRO (100+40=140)', Number(rr?.dinheiroVendas) === 140, `dinheiroVendas=${rr?.dinheiroVendas}`);
      ok('T05 esperado 50+140=190 (eletrônico não contamina)', Number(rr?.dinheiroEsperado) === 190, `esperado=${rr?.dinheiroEsperado}`);
      ok('T05 porForma separa (crédito 150, débito 60)', Number(rr?.porForma?.CARTAO_CREDITO) === 150 && Number(rr?.porForma?.CARTAO_DEBITO) === 60, JSON.stringify(rr?.porForma));
      // Saldo físico do turno tE: fundo 50 + venda real via API 100 = 150.
      // As fixtures eletrônicas NÃO mexem na gaveta (é esse o ponto testado).
      ok('T05 saldo físico registrado = 150 (50 fundo + 100 venda real; fixtures não mexem)', Number(rr?.saldoRegistrado) === 150, `saldoRegistrado=${rr?.saldoRegistrado}`);
    } finally {
      await tE.app.close(); await limparTenant(tE.empresa.id);
    }
  }

  // ── T06: Sangria ──
  {
    const r = await mov(t1, 'SANGRIA', 50, 'Retirada parcial');
    ok('T06 sangria 200', r.statusCode === 200, `status=${r.statusCode} ${r.body?.slice(0, 120)}`);
    const s = await saldo(caixaId);
    ok('T06 saldo 400-50=350', s === 350, `saldo=${s}`);
    const m = r.json();
    ok('T06 mov SANGRIA/MANUAL/usuário corretos', m?.tipo === 'SANGRIA' && m?.origem === 'MANUAL' && m?.usuarioId === t1.usuario.id && m?.caixaId === caixaId);
  }

  // ── T07: Suprimento ──
  {
    const r = await mov(t1, 'SUPRIMENTO', 25, 'Troco recebido');
    ok('T07 suprimento 200', r.statusCode === 200, `status=${r.statusCode}`);
    const s = await saldo(caixaId);
    ok('T07 saldo 350+25=375', s === 375, `saldo=${s}`);
  }

  // ── T08: Valores inválidos ──
  {
    const neg = await mov(t1, 'SANGRIA', -5);
    ok('T08 valor negativo rejeitado (400)', neg.statusCode === 400, `status=${neg.statusCode}`);
    const zero = await mov(t1, 'SANGRIA', 0);
    ok('T08 valor zero rejeitado (400)', zero.statusCode === 400, `status=${zero.statusCode}`);
    const maior = await mov(t1, 'SANGRIA', 999999);
    ok('T08 sangria > saldo rejeitada 422', maior.statusCode === 422, `status=${maior.statusCode}`);
    const s = await saldo(caixaId);
    ok('T08 saldo intacto 375', s === 375, `saldo=${s}`);
  }

  // ── T09: Permissões ──
  {
    const senhaHash = await hashSenha('senha12345');
    const vis = await prisma.usuario.create({ data: { empresaId: t1.empresa.id, nome: 'Só visualiza', email: `m4-vis-${runId}@teste.local`, senhaHash } });
    await prisma.permissao.createMany({ data: [{ usuarioId: vis.id, modulo: 'pdv', acao: 'visualizar', permitido: true }] });
    const tokenVis = t1.app.jwt.sign({ id: vis.id, empresaId: t1.empresa.id, email: vis.email }, { expiresIn: '1h' });
    const hv = { authorization: `Bearer ${tokenVis}` };
    const r1 = await t1.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: hv, payload: { tipo: 'SANGRIA', valor: 1 } });
    ok('T09 movimentação sem pdv:editar → 403', r1.statusCode === 403, `status=${r1.statusCode}`);
    const r2 = await t1.app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: hv, payload: { filialId: t1.filial.id, fundoTroco: 0 } });
    ok('T09 abertura sem pdv:criar → 403', r2.statusCode === 403, `status=${r2.statusCode}`);
    const r3 = await t1.app.inject({ method: 'POST', url: '/pdv/caixa/fechar', headers: hv, payload: { valorContado: 0 } });
    ok('T09 fechamento sem pdv:editar → 403', r3.statusCode === 403, `status=${r3.statusCode}`);
    const s = await saldo(caixaId);
    ok('T09 saldo intacto após tentativas', s === 375, `saldo=${s}`);
  }

  // ── T10: Fechamento sem divergência ──
  {
    const resumo = (await t1.app.inject({ method: 'GET', url: '/pdv/caixa/resumo', headers: H(t1) })).json();
    ok('T10 resumo esperado = 375 (fundo 100 + venda 300 − sangria 50 + suprimento 25)', Number(resumo?.dinheiroEsperado) === 375, `esperado=${resumo?.dinheiroEsperado}`);
    ok('T10 totalVendas 300 / qtdVendas 1', Number(resumo?.totalVendas) === 300 && resumo?.qtdVendas === 1, JSON.stringify({ tv: resumo?.totalVendas, q: resumo?.qtdVendas }));
    const r = await fechar(t1, Number(resumo?.dinheiroEsperado));
    ok('T10 fechamento 200', r.statusCode === 200, `status=${r.statusCode} ${r.body?.slice(0, 140)}`);
    const f = r.json();
    ok('T10 status FECHADO', f?.caixa?.status === 'FECHADO', `status=${f?.caixa?.status}`);
    ok('T10 diferenca = 0', Number(f?.caixa?.diferenca) === 0, `diferenca=${f?.caixa?.diferenca}`);
    ok('T10 valorContado registrado', Number(f?.caixa?.valorContado) === 375, `valorContado=${f?.caixa?.valorContado}`);
    ok('T10 fechadoEm preenchido', !!f?.caixa?.fechadoEm);
    await t1.app.close(); await limparTenant(t1.empresa.id);
  }

  // ── T11: Fechamento COM divergência (novo tenant t2) ──
  const t2 = await criarTenant('t2');
  let cid2 = '';
  {
    const ab = await abrir(t2, 100);
    cid2 = ab.json()?.id;
    const r = await fechar(t2, 90);
    ok('T11 fechamento com divergência 200', r.statusCode === 200, `status=${r.statusCode}`);
    const f = r.json();
    ok('T11 diferenca preservada = −10 (contado − esperado)', Number(f?.caixa?.diferenca) === -10, `diferenca=${f?.caixa?.diferenca}`);
    ok('T11 valorContado = 90 registrado', Number(f?.caixa?.valorContado) === 90);
    ok('T11 resumo devolvido com fundoTroco 100', Number(f?.resumo?.fundoTroco) === 100);
  }

  // ── T12: Operações após fechamento ──
  {
    const p2 = await criarProduto(t2.empresa.id, t2.filial.id, 10);
    const rv = await vendaReq(t2, t2.filial.id, [{ produtoId: p2, quantidade: 1, desconto: 0 }], { caixaId: cid2, key: `m4-t12-${runId}` });
    ok('T12 venda em caixa FECHADO rejeitada 422', rv.statusCode === 422, `status=${rv.statusCode} ${rv.body?.slice(0, 120)}`);
    const rm = await mov(t2, 'SANGRIA', 10);
    ok('T12 movimentação sem caixa aberto rejeitada 422', rm.statusCode === 422, `status=${rm.statusCode}`);
    const movs = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid2 } });
    ok('T12 nenhuma movimentação nova no caixa fechado', movs === 1, `movs=${movs} (só a ABERTURA)`);
    const vendasCaixa = await prisma.venda.count({ where: { caixaId: cid2 } });
    ok('T12 nenhuma venda persistida no caixa fechado', vendasCaixa === 0, `vendas=${vendasCaixa}`);
  }

  // ── T13: Venda × fechamento concorrentes (tenant t3) ──
  {
    const t3 = await criarTenant('t3');
    try {
      const p3 = await criarProduto(t3.empresa.id, t3.filial.id, 10);
      const ab = await abrir(t3, 100);
      const cid3 = ab.json()?.id;
      const [rv, rf] = await Promise.all([
        vendaReq(t3, t3.filial.id, [{ produtoId: p3, quantidade: 2, desconto: 0 }], { caixaId: cid3, key: `m4-t13-${runId}` }),
        fechar(t3, 300),
      ]);
      const c3 = await prisma.caixa.findUniqueOrThrow({ where: { id: cid3 } });
      ok('T13 caixa terminou FECHADO', c3.status === 'FECHADO', `status=${c3.status}`);
      const vendasCaixa = await prisma.venda.findMany({ where: { caixaId: cid3 } });
      if (rv.statusCode === 201) {
        // Venda venceu o lock → entrou no resumo do fechamento.
        const f = rf.json();
        ok('T13 venda venceu → fechamento 200 e resumo inclui a venda', rf.statusCode === 201 || rf.statusCode === 200, `rf=${rf.statusCode}`);
        ok('T13 resumo conta a venda (qtdVendas 1)', f?.resumo?.qtdVendas === 1, `qtd=${f?.resumo?.qtdVendas}`);
        ok('T13 saldo = esperado (100+200=300)', Number(c3.saldo) === 300, `saldo=${c3.saldo}`);
      } else {
        // Fechamento venceu → venda rejeitada e fora do resumo.
        ok('T13 fechamento venceu → venda rejeitada 4xx', rv.statusCode === 422, `rv=${rv.statusCode}`);
        ok('T13 nenhuma venda persistida', vendasCaixa.length === 0, `vendas=${vendasCaixa.length}`);
      }
    } finally {
      await t3.app.close(); await limparTenant(t3.empresa.id);
    }
  }

  // ── T14: Fechamentos concorrentes (tenant t4) ──
  {
    const t4 = await criarTenant('t4');
    try {
      const ab = await abrir(t4, 50);
      const cid4 = ab.json()?.id;
      const [r1, r2] = await Promise.all([fechar(t4, 50), fechar(t4, 50)]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      ok('T14 exatamente 1 sucesso + 1 rejeição (200,422)', codes[0] === 200 && codes[1] === 422, `codes=${codes}`);
      const fechamentos = await prisma.caixa.count({ where: { id: cid4, status: 'FECHADO' } });
      ok('T14 caixa FECHADO uma única vez', fechamentos === 1, `fechados=${fechamentos}`);
      const movs = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid4, tipo: 'FECHAMENTO' } });
      ok('T14 sem movimentação FECHAMENTO duplicada', movs <= 1, `movs=${movs}`);
    } finally {
      await t4.app.close(); await limparTenant(t4.empresa.id);
    }
  }

  // ── T15: Idempotência (replay de venda não duplica saldo) ──
  {
    const t5 = await criarTenant('t5');
    try {
      const p5 = await criarProduto(t5.empresa.id, t5.filial.id, 10);
      const ab = await abrir(t5, 100);
      const cid5 = ab.json()?.id;
      const key = `m4-t15-${runId}`;
      const r1 = await vendaReq(t5, t5.filial.id, [{ produtoId: p5, quantidade: 2, desconto: 0 }], { caixaId: cid5, key });
      const r2 = await vendaReq(t5, t5.filial.id, [{ produtoId: p5, quantidade: 2, desconto: 0 }], { caixaId: cid5, key });
      ok('T15 replay 201 devolve a MESMA venda', r1.statusCode === 201 && r2.statusCode === 201 && r1.json()?.venda?.id === r2.json()?.venda?.id, `r1=${r1.statusCode} r2=${r2.statusCode}`);
      const s = await saldo(cid5);
      ok('T15 saldo incrementado UMA vez (100+200=300)', s === 300, `saldo=${s}`);
      const movsEstoque = await prisma.estoqueMovimentacao.count({ where: { produtoId: p5, tipo: 'VENDA' } });
      ok('T15 uma única baixa de estoque', movsEstoque === 1, `movs=${movsEstoque}`);
      // Documentado: movimentações não têm chave de idempotência — cada
      // chamada é um evento físico distinto (design atual, não defeito).
      await mov(t5, 'SANGRIA', 10, 'A');
      await mov(t5, 'SANGRIA', 10, 'A');
      const sangrias = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid5, tipo: 'SANGRIA' } });
      ok('T15 (documentado) sangrias repetidas geram 2 movs', sangrias === 2, `sangrias=${sangrias}`);
    } finally {
      await t5.app.close(); await limparTenant(t5.empresa.id);
    }
  }

  // ── T16: Cancelamento de venda em caixa FECHADO ──
  {
    const t6 = await criarTenant('t6');
    try {
      const p6 = await criarProduto(t6.empresa.id, t6.filial.id, 10);
      const ab = await abrir(t6, 100);
      const cid6 = ab.json()?.id;
      const rv = await vendaReq(t6, t6.filial.id, [{ produtoId: p6, quantidade: 2, desconto: 0 }], { caixaId: cid6, key: `m4-t16-${runId}` });
      const vid = rv.json()?.venda?.id;
      ok('T16 venda base 201 (saldo 300)', rv.statusCode === 201 && (await saldo(cid6)) === 300, `status=${rv.statusCode}`);
      await fechar(t6, 300);
      const rc = await t6.app.inject({ method: 'POST', url: `/vendas/${vid}/cancelar`, headers: H(t6), payload: { motivo: 'Teste cancelamento caixa fechado' } });
      ok('T16 cancelamento aceito', rc.statusCode === 200 || rc.statusCode === 201, `status=${rc.statusCode} ${rc.body?.slice(0, 140)}`);
      const vApos = await prisma.venda.findUniqueOrThrow({ where: { id: vid } });
      ok('T16 status CANCELADA persistido', vApos.status === 'CANCELADA', `status=${vApos.status}`);
      const s = await saldo(cid6);
      ok('T16 saldo do caixa fechado NÃO alterado (300)', s === 300, `saldo=${s}`);
      const auto = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid6, tipo: 'SANGRIA', origem: 'AUTOMATICO' } });
      ok('T16 NENHUMA sangria automática no caixa fechado', auto === 0, `auto=${auto}`);
    } finally {
      await t6.app.close(); await limparTenant(t6.empresa.id);
    }
  }

  // ── T17: Falha transacional (rollback total) ──
  {
    const t7 = await criarTenant('t7');
    try {
      const p7 = await criarProduto(t7.empresa.id, t7.filial.id, 10);
      const ab = await abrir(t7, 100);
      const cid7 = ab.json()?.id;
      const r = await vendaReq(t7, t7.filial.id, [
        { produtoId: p7, quantidade: 2, desconto: 0 },
        { produtoId: randomUUID(), quantidade: 1, desconto: 0 }, // inexistente
      ], { caixaId: cid7, key: `m4-t17-${runId}` });
      ok('T17 venda rejeitada (produto inexistente) 404', r.statusCode === 404, `status=${r.statusCode}`);
      const s = await saldo(cid7);
      ok('T17 saldo intacto (100) — sem efeito parcial', s === 100, `saldo=${s}`);
      const vendasCaixa = await prisma.venda.count({ where: { caixaId: cid7 } });
      ok('T17 nenhuma venda persistida', vendasCaixa === 0, `vendas=${vendasCaixa}`);
      const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t7.filial.id, produtoId: p7 } } });
      ok('T17 estoque do item válido intacto (10)', est.quantidade === 10, `estoque=${est.quantidade}`);
    } finally {
      await t7.app.close(); await limparTenant(t7.empresa.id);
    }
  }

  // ── T18: Isolamento entre empresas ──
  {
    const tA = await criarTenant('t8a');
    const tB = await criarTenant('t8b');
    try {
      const abA = await abrir(tA, 100);
      const cidA = abA.json()?.id;
      const rFilial = await abrir(tB, 50, tA.filial.id);
      ok('T18 abertura com filial de outra empresa → 404', rFilial.statusCode === 404, `status=${rFilial.statusCode}`);
      const pB = await criarProduto(tB.empresa.id, tB.filial.id, 10);
      const rVenda = await vendaReq(tB, tB.filial.id, [{ produtoId: pB, quantidade: 1, desconto: 0 }], { caixaId: cidA, key: `m4-t18-${runId}` });
      ok('T18 venda com caixa de outra empresa → 422', rVenda.statusCode === 422, `status=${rVenda.statusCode}`);
      const sA = await saldo(cidA);
      ok('T18 saldo do caixa de A intacto (100)', sA === 100, `saldo=${sA}`);
      const rResumo = await tB.app.inject({ method: 'GET', url: '/pdv/caixa/resumo', headers: H(tB) });
      ok('T18 resumo de B é 404 (não vê caixa de A)', rResumo.statusCode === 404, `status=${rResumo.statusCode}`);
    } finally {
      await tA.app.close(); await limparTenant(tA.empresa.id);
      await tB.app.close(); await limparTenant(tB.empresa.id);
    }
  }

  await t2.app.close(); await limparTenant(t2.empresa.id);

  console.log(`\n=== RESULTADO: passou=${passou} falhas=${falhas} ===`);
  await prisma.$disconnect();
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });







// MÓDULO 06 — Contratos backend de idempotência/sincronização do PDV offline.
// Roda contra o banco ISOLADO nexus_os_mod6 via DATABASE_URL do ambiente.
// Valida o SERVIDOR dos cenários que a fila offline do frontend depende:
// resposta perdida, retentativa com mesma chave, simultâneas, rejeição,
// reconciliação de PROCESSANDO e TTL.
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
  const empresa = await prisma.empresa.create({ data: { nome: `M6-${sufixo}-${runId}`, cnpj: `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14) } });
  const filial = await prisma.filial.create({ data: { empresaId: empresa.id, nome: `Filial ${sufixo}` } });
  const senhaHash = await hashSenha('senha12345');
  const usuario = await prisma.usuario.create({ data: { empresaId: empresa.id, nome: `Op ${sufixo}`, email: `m6-${sufixo}-${runId}@teste.local`, senhaHash } });
  await prisma.permissao.createMany({ data: MODULOS.flatMap((m) => ACOES.map((a) => ({ modulo: m, acao: a, permitido: true, usuarioId: usuario.id }))) });
  const app = Fastify();
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    if (error?.statusCode >= 400 && error?.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno do servidor.' });
  });
  await app.register(jwt, { secret: 'segredo-mod6' });
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

function H(t: { app: any; token: string }, key?: string) {
  return { authorization: `Bearer ${t.token}`, ...(key ? { 'x-idempotency-key': key } : {}) };
}

function vendaReq(t: any, produtoId: string, key: string, quantidade = 1) {
  return t.app.inject({
    method: 'POST', url: '/vendas',
    headers: H(t, key),
    payload: { filialId: t.filial.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade, desconto: 0 }] },
  });
}

function consultarChave(t: any, key: string) {
  return t.app.inject({ method: 'GET', url: `/vendas/idempotencia/${encodeURIComponent(key)}`, headers: H(t) });
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
  console.log('=== MÓDULO 06 — Contratos backend de idempotência/sincronização (banco isolado) ===');

  const t = await criarTenant('t1');
  const prod = await criarProduto(t.empresa.id, t.filial.id, 50);

  // ── T01: Resposta perdida após persistência — retentativa com a MESMA chave ──
  {
    const key = `venda-${runId}-t01key`;
    const r1 = await vendaReq(t, prod, key, 2);
    ok('T01 primeira venda 201', r1.statusCode === 201, `status=${r1.statusCode}`);
    const vid = r1.json()?.venda?.id;
    // Simula "resposta perdida": o cliente não tem o resultado e consulta.
    const consulta = await consultarChave(t, key);
    const c = consulta.json();
    ok('T01 consulta devolve CONFIRMADA com a venda real', consulta.statusCode === 200 && c?.status === 'CONFIRMADA' && c?.vendaId === vid, `status=${c?.status} vendaId=${c?.vendaId}`);
    // Retentativa com a mesma chave (o que a fila offline faz).
    const r2 = await vendaReq(t, prod, key, 2);
    ok('T01 retentativa 201 devolve a MESMA venda', r2.statusCode === 201 && r2.json()?.venda?.id === vid, `status=${r2.statusCode} id=${r2.json()?.venda?.id}`);
    const totalVendas = await prisma.venda.count({ where: { empresaId: t.empresa.id } });
    ok('T01 exatamente 1 venda persistida (sem duplicidade)', totalVendas === 1, `vendas=${totalVendas}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: prod } } });
    ok('T01 estoque baixado UMA vez (50−2=48)', est.quantidade === 48, `estoque=${est.quantidade}`);
  }

  // ── T02: Duas tentativas simultâneas com a mesma chave — uma única venda ──
  {
    const key = `venda-${runId}-t02key`;
    const [ra, rb] = await Promise.all([vendaReq(t, prod, key, 1), vendaReq(t, prod, key, 1)]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    ok('T02 ambas respondem 201 ou 409 (conflito transitório aceitável)', codes.every((s) => s === 201 || s === 409), `codes=${codes}`);
    const vendasKey = await prisma.venda.count({ where: { empresaId: t.empresa.id, idempotencyKey: key } });
    ok('T02 exatamente 1 venda para a chave', vendasKey === 1, `vendas=${vendasKey}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: prod } } });
    ok('T02 estoque baixado 1 unidade (48−1=47)', est.quantidade === 47, `estoque=${est.quantidade}`);
  }

  // ── T03: Rejeição por estoque — REJEITADA, sem efeitos, retry seguro ──
  {
    const key = `venda-${runId}-t03key`;
    const r1 = await vendaReq(t, prod, key, 999);
    ok('T03 venda acima do estoque → 422', r1.statusCode === 422, `status=${r1.statusCode}`);
    const consulta = await consultarChave(t, key);
    ok('T03 consulta devolve REJEITADA (fila não reenvia às cegas)', consulta.statusCode === 200 && consulta.json()?.status === 'REJEITADA', `status=${consulta.json()?.status}`);
    const r2 = await vendaReq(t, prod, key, 999);
    ok('T03 retentativa devolve a MESMA rejeição (422)', r2.statusCode === 422, `status=${r2.statusCode}`);
    const vendasKey = await prisma.venda.count({ where: { empresaId: t.empresa.id, idempotencyKey: key } });
    ok('T03 nenhuma venda persistida', vendasKey === 0, `vendas=${vendasKey}`);
    const est = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: prod } } });
    ok('T03 estoque intacto (47)', est.quantidade === 47, `estoque=${est.quantidade}`);
  }

  // ── T04: Consulta de chave inexistente → 404 (fila usa como "retryable") ──
  {
    const r = await consultarChave(t, `venda-${runId}-inexistente`);
    ok('T04 chave desconhecida → 404', r.statusCode === 404, `status=${r.statusCode}`);
  }

  // ── T05: PROCESSANDO preso com venda JÁ commitada (crash pós-COMMIT) ──
  {
    const key = `venda-${runId}-t05key`;
    // Fixture: chave PROCESSANDO "esquecida" + venda commitada com a mesma chave
    // (simula crash entre COMMIT da venda e conclusão da chave).
    const registro = await prisma.idempotencyKey.create({ data: { key, empresaId: t.empresa.id, filialId: t.filial.id, operadorId: t.usuario.id, status: 'PROCESSANDO' } });
    const vendaFixture = await prisma.venda.create({ data: { empresaId: t.empresa.id, filialId: t.filial.id, funcionarioId: t.usuario.id, status: 'FINALIZADA', subtotal: 100, total: 100, formaPagamento: 'DINHEIRO', origem: 'PDV', idempotencyKey: key } });
    const r = await vendaReq(t, prod, key, 1);
    // Contrato real: a resposta duplicada devolve o corpo GRAVADO na chave — que,
    // num crash antes de concluirIdempotencia, é null. O cliente (enviarOperacaoPdv)
    // trata exatamente isso consultando /vendas/idempotencia (teste de frontend
    // "resposta de sucesso sem ID consulta o registro durável"). O invariante
    // crítico é: 201 + NUNCA uma segunda venda.
    const vidResp = r.json()?.venda?.id ?? null;
    ok('T05 retry devolve 201 e NUNCA uma segunda venda', r.statusCode === 201 && (vidResp === null || vidResp === vendaFixture.id), `status=${r.statusCode} id=${vidResp}`);
    const consulta = await consultarChave(t, key);
    ok('T05 consulta devolve CONFIRMADA + vendaId real (rota de reconciliação do cliente)', consulta.json()?.status === 'CONFIRMADA' && consulta.json()?.vendaId === vendaFixture.id, `status=${consulta.json()?.status}`);
    const vendasKey = await prisma.venda.count({ where: { empresaId: t.empresa.id, idempotencyKey: key } });
    ok('T05 exatamente 1 venda para a chave', vendasKey === 1, `vendas=${vendasKey}`);
    const reg = await prisma.idempotencyKey.findUniqueOrThrow({ where: { id: registro.id } });
    ok('T05 chave reconciliada para CONFIRMADA com a venda real', reg.status === 'CONFIRMADA' && reg.vendaId === vendaFixture.id, `status=${reg.status} vendaId=${reg.vendaId}`);
  }

  // ── T06: PROCESSANDO com TTL expirado e SEM venda — reprocessa com a MESMA chave ──
  {
    const key = `venda-${runId}-t06key`;
    const registro = await prisma.idempotencyKey.create({ data: { key, empresaId: t.empresa.id, filialId: t.filial.id, operadorId: t.usuario.id, status: 'PROCESSANDO' } });
    await prisma.idempotencyKey.update({ where: { id: registro.id }, data: { updatedAt: new Date(Date.now() - 16 * 60 * 1000) } }); // TTL = 15min
    const estAntes = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: prod } } });
    const r = await vendaReq(t, prod, key, 1);
    ok('T06 após TTL, reprocessa e confirma (201)', r.statusCode === 201 && !!r.json()?.venda?.id, `status=${r.statusCode}`);
    const vendasKey = await prisma.venda.count({ where: { empresaId: t.empresa.id, idempotencyKey: key } });
    ok('T06 exatamente 1 venda para a chave (mesma identidade)', vendasKey === 1, `vendas=${vendasKey}`);
    const reg = await prisma.idempotencyKey.findUniqueOrThrow({ where: { id: registro.id } });
    ok('T06 chave CONCLUÍDA na MESMA row (não criou outra)', reg.status === 'CONFIRMADA' && reg.vendaId === r.json()?.venda?.id, `status=${reg.status}`);
    const estDepois = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: t.filial.id, produtoId: prod } } });
    ok('T06 estoque baixado 1 vez', estDepois.quantidade === estAntes.quantidade - 1, `antes=${estAntes.quantidade} depois=${estDepois.quantidade}`);
  }

  // ── T07: Isolamento — operador/empresa B não consulta a chave de A ──
  {
    const tB = await criarTenant('t7b');
    try {
      const keyA = `venda-${runId}-t01key`; // criada pelo tenant A no T01
      const r = await consultarChave(tB, keyA);
      ok('T07 consulta cross-tenant → 404 (escopo empresa+operador)', r.statusCode === 404, `status=${r.statusCode}`);
      // Espaço de chaves é por empresa: B pode usar o MESMO texto de chave.
      const pB = await criarProduto(tB.empresa.id, tB.filial.id, 10);
      const rB = await vendaReq(tB, pB, keyA, 1);
      ok('T07 mesma chave em outra empresa é operação independente (201)', rB.statusCode === 201, `status=${rB.statusCode}`);
      const vB = await prisma.venda.count({ where: { empresaId: tB.empresa.id, idempotencyKey: keyA } });
      ok('T07 1 venda no escopo B, vendas de A intactas', vB === 1 && (await prisma.venda.count({ where: { empresaId: t.empresa.id, idempotencyKey: keyA } })) === 1);
    } finally {
      await tB.app.close(); await limparTenant(tB.empresa.id);
    }
  }

  // ── T08: EVIDÊNCIA (Etapa G) — movimentações NÃO têm idempotência ──
  // Duas requisições idênticas de sangria geram DUAS movimentações: o risco de
  // duplicidade pós-timeout é real. Mitigações existentes: frontend NÃO retenta
  // automaticamente e a fila nem aceita o tipo offline. Correção requer chave na
  // rota → documentada para autorização (seção 10 do prompt do Módulo 06).
  {
    const ab = await t.app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: H(t), payload: { filialId: t.filial.id, fundoTroco: 500 } });
    const cid = ab.json()?.id;
    const payload = { tipo: 'SANGRIA', valor: 50, motivo: 'Risco de timeout' };
    const r1 = await t.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: H(t), payload });
    const r2 = await t.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: H(t), payload });
    const movs = await prisma.movimentacaoCaixa.count({ where: { caixaId: cid, tipo: 'SANGRIA' } });
    ok('T08 duas sangrias idênticas → 2 movs (risco confirmado)', r1.statusCode === 200 && r2.statusCode === 200 && movs === 2, `r1=${r1.statusCode} r2=${r2.statusCode} movs=${movs}`);
    ok('T08 sangria maior que a gaveta → 422 (proteção de saldo ativa)', (await t.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: H(t), payload: { tipo: 'SANGRIA', valor: 9999 } })).statusCode === 422);
    const tX = await criarTenant('t8x');
    try {
      const rX = await tX.app.inject({ method: 'POST', url: '/pdv/caixa/movimentacoes', headers: H(tX), payload });
      ok('T08 sem caixa aberto → 422', rX.statusCode === 422, `status=${rX.statusCode}`);
    } finally {
      await tX.app.close(); await limparTenant(tX.empresa.id);
    }
  }

  await t.app.close(); await limparTenant(t.empresa.id);
  console.log(`\n=== RESULTADO: passou=${passou} falhas=${falhas} ===`);
  await prisma.$disconnect();
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });




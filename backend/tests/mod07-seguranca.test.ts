/**
 * MÓDULO 07 — TESTES DE SEGURANÇA COMPLEMENTARES (etapas de endurecimento).
 *
 * Complementa `cross-tenant-isolamento.test.ts` (9 asserções de isolamento
 * básico). Cobre os cenários de segurança pendentes:
 *   S1  Revogação de permissão tem efeito imediato (checagem no banco).
 *   S2  Isolamento/compartilhamento entre filiais da MESMA empresa.
 *   S3  Idempotência entre empresas (chave de outra empresa não é recuperável).
 *   S4  Cancelamento entre empresas (404, nunca executa).
 *   S6  Permissão revogada antes da sincronização (POST /vendas -> 403).
 *   S7  Manipulação de identificadores (empresaId/filialId/produtoId/caixaId/vendaId).
 *
 * Ambiente isolado: cria dois tenants com sufixo único e NÃO altera código de
 * produção. Todas as checagens são de comportamento REAL em runtime.
 */

import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { ErroDeNegocio } from '../src/lib/erros.js';

const SEGREDO = 'segredo-teste-isolamento';
const SUFIXO = Date.now().toString(36);
let passou = 0;
let falhas = 0;
function ok(nome: string, condicao: boolean, detalhe = '') {
  if (condicao) { passou++; console.log(`  ok   ${nome}`); }
  else { falhas++; console.log(`  FAIL ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}
async function register(app: Fastify, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/auth/register-company', payload });
}
async function login(app: Fastify, email: string) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha: 'senha123' } });
}
function bearer(token: string) { return { authorization: `Bearer ${token}` }; }

async function criarProduto(empresaId: string, filialId: string, runId: string) {
  const produtoId = `prod-${runId}-${Date.now().toString(36)}`;
  await prisma.produto.create({ data: { id: produtoId, empresaId, nome: `Isola${runId}`, sku: `ISOLA${runId}`, precoVenda: 100, custo: 5, unidade: 'UN', status: 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId, produtoId } }, update: { quantidade: 100, valorTotal: 500 }, create: { empresaId, filialId, produtoId, quantidade: 100, valorTotal: 500 } });
  return produtoId;
}
function corpoVenda(filialId: string, produtoId: string, extra: Record<string, unknown> = {}) {
  return { filialId, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 100 }], ...extra };
}

async function main() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: (error as any).issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    return reply.status(500).send({ error: 'Erro interno.' });
  });
  await app.register(jwt, { secret: SEGREDO });
  await app.register(registerAuthentication);
  await app.register(authRoutes);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();

  const regA = await register(app, { nomeEmpresa: `A-${SUFIXO}`, nome: 'Op A', email: `a-${SUFIXO}@teste.local`, senha: 'senha123' });
  const uA = regA.json().usuario;
  const empA = uA.empresaId;
  const filA = await prisma.filial.findFirst({ where: { empresaId: empA }, select: { id: true } });
  const filA2 = await prisma.filial.create({ data: { empresaId: empA, nome: `Filial2-${SUFIXO}` }, select: { id: true } });
  const regB = await register(app, { nomeEmpresa: `B-${SUFIXO}`, nome: 'Op B', email: `b-${SUFIXO}@teste.local`, senha: 'senha123' });
  const uB = regB.json().usuario;
  const empB = uB.empresaId;
  const filB = await prisma.filial.findFirst({ where: { empresaId: empB }, select: { id: true } });
  const tokA = (await login(app, uA.email)).json().token;
  const tokB = (await login(app, uB.email)).json().token;
  const prodA1 = await criarProduto(empA, filA.id, `a1${SUFIXO}`);
  const prodA2 = await criarProduto(empA, filA2.id, `a2${SUFIXO}`);
  const prodB = await criarProduto(empB, filB.id, `b${SUFIXO}`);

  // ================= S2 — Isolamento/compartilhamento entre filiais =================
  const vendaFilial2 = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: corpoVenda(filA2.id, prodA2) });
  ok('S2-a: mesmo tenant vende em outra filial da empresa -> 201', vendaFilial2.statusCode === 201, `status=${vendaFilial2.statusCode} ${vendaFilial2.body}`);
  const idFilial2 = vendaFilial2.json().venda?.id;
  const listaFilial2 = await app.inject({ method: 'GET', url: `/vendas?filialId=${filA2.id}`, headers: bearer(tokA) });
  const idsFilial2 = listaFilial2.json().vendas?.map((v: any) => v.id) ?? [];
  ok('S2-b: dono da empresa enxerga venda da outra filial (tenant=empresa)', idsFilial2.includes(idFilial2), `ids=${JSON.stringify(idsFilial2).slice(0, 80)}`);
  const abrirCaixaA = await app.inject({ method: 'POST', url: '/pdv/caixa/abrir', headers: bearer(tokA), payload: { filialId: filA.id, fundoTroco: 0 } });
  ok('S2-c: operador abre caixa na filial -> 200', abrirCaixaA.statusCode === 200, `status=${abrirCaixaA.statusCode} ${abrirCaixaA.body}`);
  const caixaAId = abrirCaixaA.json().id;
  const caixaAtualA = await app.inject({ method: 'GET', url: '/pdv/caixa/atual', headers: bearer(tokA) });
  ok('S2-d: caixa atual é o do próprio operador (isolado por usuarioId)', caixaAtualA.json()?.id === caixaAId, `body=${caixaAtualA.body}`);

  // ================= S3 — Idempotência entre empresas =================
  const chave = `idem-cross-${SUFIXO}-abcdef`;
  const vendaIdemA = await app.inject({ method: 'POST', url: '/vendas', headers: { ...bearer(tokA), 'x-idempotency-key': chave }, payload: corpoVenda(filA.id, prodA1) });
  const idemA = vendaIdemA.json().venda?.id;
  ok('S3-a: A cria venda com chave de idempotência -> 201', vendaIdemA.statusCode === 201 && !!idemA, `status=${vendaIdemA.statusCode}`);
  const consultaIdemB = await app.inject({ method: 'GET', url: `/vendas/idempotencia/${chave}`, headers: bearer(tokB) });
  ok('S3-b: B NÃO recupera chave de idempotência de A -> 404', consultaIdemB.statusCode === 404, `status=${consultaIdemB.statusCode}`);
  const vendaIdemB = await app.inject({ method: 'POST', url: '/vendas', headers: { ...bearer(tokB), 'x-idempotency-key': chave }, payload: corpoVenda(filB.id, prodB) });
  const idemB = vendaIdemB.json().venda?.id;
  ok('S3-c: B com a MESMA chave cria venda PRÓPRIA (não recupera a de A)', vendaIdemB.statusCode === 201 && !!idemB && idemB !== idemA, `status=${vendaIdemB.statusCode} idemB=${idemB} idemA=${idemA}`);

  // ================= S4 — Cancelamento entre empresas =================
  const cancelaB = await app.inject({ method: 'POST', url: `/vendas/${idemA}/cancelar`, headers: bearer(tokB), payload: { motivo: 'tentativa cross-tenant' } });
  ok('S4-a: B NÃO cancela venda de A -> 404', cancelaB.statusCode === 404, `status=${cancelaB.statusCode}`);
  const vendaAindaAtiva = await prisma.venda.findUnique({ where: { id: idemA }, select: { status: true } });
  ok('S4-b: venda de A permanece FINALIZADA após tentativa de B', vendaAindaAtiva?.status === 'FINALIZADA', `status=${vendaAindaAtiva?.status}`);

  // ================= S7 — Manipulação de identificadores =================
  const filialCruzada = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokB), payload: corpoVenda(filA.id, prodA1) });
  ok('S7-a: B com filialId de A -> 404', filialCruzada.statusCode === 404, `status=${filialCruzada.statusCode}`);
  const produtoCruzado = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokB), payload: corpoVenda(filB.id, prodA1) });
  ok('S7-b: B com produtoId de A -> 404', produtoCruzado.statusCode === 404, `status=${produtoCruzado.statusCode}`);
  const caixaCruzado = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokB), payload: corpoVenda(filB.id, prodB, { caixaId: caixaAId }) });
  ok('S7-c: B com caixaId de A -> 422 (caixa não aberto para este usuário)', caixaCruzado.statusCode === 422, `status=${caixaCruzado.statusCode}`);
  const getVendaCruzada = await app.inject({ method: 'GET', url: `/vendas/${idemA}`, headers: bearer(tokB) });
  ok('S7-d: B lê vendaId de A -> 404', getVendaCruzada.statusCode === 404, `status=${getVendaCruzada.statusCode}`);
  const empresaForjada = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokB), payload: corpoVenda(filB.id, prodB, { empresaId: empA }) });
  const vendaForjada = await prisma.venda.findUnique({ where: { id: empresaForjada.json().venda?.id }, select: { empresaId: true } });
  ok('S7-e: empresaId forjado no corpo é ignorado (venda nasce na empresa do token)', empresaForjada.statusCode === 201 && vendaForjada?.empresaId === empB, `status=${empresaForjada.statusCode} empresaVenda=${vendaForjada?.empresaId} empB=${empB}`);

  // ================= S1/S6 — Revogação de permissão =================
  const antesRevogar = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: corpoVenda(filA.id, prodA1) });
  ok('S1-a: antes de revogar, A vende normalmente -> 201', antesRevogar.statusCode === 201, `status=${antesRevogar.statusCode}`);
  await prisma.permissao.updateMany({ where: { usuarioId: uA.id, acao: 'criar', modulo: { in: ['vendas', 'pdv'] } }, data: { permitido: false } });
  const depoisRevogar = await app.inject({ method: 'POST', url: '/vendas', headers: { ...bearer(tokA), 'x-idempotency-key': `sync-rev-${SUFIXO}-xy` }, payload: corpoVenda(filA.id, prodA1) });
  ok('S6-a: após revogar permissão, sincronização (POST /vendas) -> 403', depoisRevogar.statusCode === 403, `status=${depoisRevogar.statusCode} ${depoisRevogar.body}`);
  const novaOp = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: corpoVenda(filA.id, prodA1) });
  ok('S1-b: nova operação protegida após revogação -> 403', novaOp.statusCode === 403, `status=${novaOp.statusCode}`);

  console.log(`\nRESULTADO M07-SEGURANCA: ok=${passou} falha=${falhas}`);
  if (falhas > 0) process.exitCode = 1;
  await app.close();
  await prisma.$disconnect();
}

main();

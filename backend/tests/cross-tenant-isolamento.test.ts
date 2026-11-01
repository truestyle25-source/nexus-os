/**
 * ISOLAMENTO MULTI-TENANT (MÓDULO 07, etapas B–D/E).
 * Demonstrativa da ET B/C/D/E: dois tenantes isolados, NÃO há acesso cru.
 */

import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma.js';
import { authRoutes } from '../src/modules/auth/auth.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
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
async function criarProduto(app: Fastify, empresaId: string, filialId: string, runId: string) {
  const produtoId = `prod-${runId}-${Date.now().toString(36)}`;
  await prisma.produto.create({ data: { id: produtoId, empresaId, nome: `Isola${runId}`, sku: `ISOLA${runId}`, precoVenda: 100, custo: 5, unidade: 'UN', status: 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId, produtoId } }, update: { quantidade: 100, valorTotal: 500 }, create: { empresaId, filialId, produtoId, quantidade: 100, valorTotal: 500 } });
  return produtoId;
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
  await app.ready();

  const regA = await register(app, { nomeEmpresa: `A-${SUFIXO}`, nome: 'Op A', email: `a-${SUFIXO}@teste.local`, senha: 'senha123' });
  ok('B1-a: cadastro A -> 201', regA.statusCode === 201, `status=${regA.statusCode}`);
  const uA = regA.json().usuario;
  const empA = await prisma.empresa.findFirst({ where: { id: uA.empresaId }, select: { id: true } });
  const filA = await prisma.filial.findFirst({ where: { empresaId: uA.empresaId }, select: { id: true } });
  const regB = await register(app, { nomeEmpresa: `B-${SUFIXO}`, nome: 'Op B', email: `b-${SUFIXO}@teste.local`, senha: 'senha123' });
  ok('B1-b: cadastro B -> 201', regB.statusCode === 201, `status=${regB.statusCode}`);
  const uB = regB.json().usuario;
  const filB = await prisma.filial.findFirst({ where: { empresaId: uB.empresaId }, select: { id: true } });
  const tokA = (await login(app, uA.email)).json().token;
  const tokB = (await login(app, uB.email)).json().token;
  ok('B1-c: logins retornam token', !!tokA && !!tokB);

  const prodA = await criarProduto(app, empA.id, filA.id, `a${SUFIXO}`);
  const corpoA = { filialId: filA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: prodA, quantidade: 2, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 200 }] };
  const vendaA = (await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: corpoA })).json();
  const idA = vendaA.venda?.id;
  ok('B2-a: A cria venda -> 201', !!idA);

  const pB = await app.inject({ method: 'GET', url: `/vendas/${idA}`, headers: bearer(tokB) });
  ok('B2-b: B NÃO lÃª venda de A -> 404', pB.statusCode === 404, `status=${pB.statusCode}`);

  const listB = await app.inject({ method: 'GET', url: '/vendas', headers: bearer(tokB) });
  const idsB = listB.json().vendas?.map((v: any) => v.id) ?? [];
  ok('B3-a: B listagem -> 200', listB.statusCode === 200, `status=${listB.statusCode}`);
  ok('B3-b: B nÃ£o enxerga venda de A na listagem', !idsB.includes(idA), `ids=${JSON.stringify(idsB).slice(0, 80)}`);

  const cruzada = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokB), payload: { filialId: filA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: prodA, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 100 }] } });
  ok('B4-a: B NÃO cria venda com filial/produto de A -> 404', cruzada.statusCode === 404, `status=${cruzada.statusCode}`);

  // E1 — "permissão de venda mantida": asserção REAL (substitui o antigo
  // `ok(..., true)` que era vacuamente verdadeiro). Prova que o operador A,
  // com a permissão de venda intacta, consegue registrar OUTRA venda legítima
  // (201). Falha se a permissão de venda for negada — deixando de ser um
  // teste que passa incondicionalmente.
  const novaVendaA = await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: corpoA });
  const idNovaA = novaVendaA.json().venda?.id;
  ok('E1: permissão de venda mantida -> A cria nova venda 201', novaVendaA.statusCode === 201 && !!idNovaA, `status=${novaVendaA.statusCode}`);

  console.log(`\nRESULTADO M07: ok=${passou} falha=${falhas}`);
  if (falhas > 0) process.exitCode = 1;
}
main();
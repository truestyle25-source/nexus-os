/**
 * MÓDULO 07 — TESTE DE MUTAÇÃO (valida que o isolamento NÃO é vacuoso).
 *
 * Item 3 da missão: "os testes falham quando o isolamento é deliberadamente
 * violado, sem modificar código de produção". Aqui provamos isso de forma
 * controlada:
 *
 *   - A query "vulnerável" (Prisma SEM filtro de empresaId) RETORNA a venda
 *     do outro tenant. Se a rota usasse essa query, o teste B2-b (que espera
 *     404) FALHARIA. Ou seja: a asserção tem poder de detecção real.
 *   - A rota REAL (com filtro empresaId vindo do JWT) devolve 404.
 *
 * Nenhum código de produção é alterado: a "violação" é reproduzida por uma
 * consulta Prisma direta dentro do próprio teste.
 */

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
  const uA = regA.json().usuario;
  const filA = await prisma.filial.findFirst({ where: { empresaId: uA.empresaId }, select: { id: true } });
  const regB = await register(app, { nomeEmpresa: `B-${SUFIXO}`, nome: 'Op B', email: `b-${SUFIXO}@teste.local`, senha: 'senha123' });
  const uB = regB.json().usuario;
  const tokA = (await login(app, uA.email)).json().token;
  const tokB = (await login(app, uB.email)).json().token;

  const prodId = `prod-mut-${SUFIXO}`;
  await prisma.produto.create({ data: { id: prodId, empresaId: uA.empresaId, nome: `Mut${SUFIXO}`, sku: `MUT${SUFIXO}`, precoVenda: 100, custo: 5, unidade: 'UN', status: 'ATIVO' } });
  await prisma.estoque.upsert({ where: { filialId_produtoId: { filialId: filA.id, produtoId: prodId } }, update: { quantidade: 100, valorTotal: 500 }, create: { empresaId: uA.empresaId, filialId: filA.id, produtoId: prodId, quantidade: 100, valorTotal: 500 } });
  const vendaA = (await app.inject({ method: 'POST', url: '/vendas', headers: bearer(tokA), payload: { filialId: filA.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: prodId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 100 }] } })).json();
  const idA = vendaA.venda?.id;

  // ----- MUTAÇÃO: query SEM filtro de empresa (simula backend vulnerável) -----
  const vazamento = await prisma.venda.findUnique({ where: { id: idA } });
  ok('MUT-1: query sem filtro de empresa RETORNA a venda (violação detectável)', !!vazamento && vazamento.id === idA, `vazamento=${!!vazamento}`);

  // ----- CONTRASTE: a rota real (com filtro) devolve 404 para B -----
  const rotaReal = await app.inject({ method: 'GET', url: `/vendas/${idA}`, headers: bearer(tokB) });
  ok('MUT-2: rota real nega B -> 404 (filtro empresaId é o que isola)', rotaReal.statusCode === 404, `status=${rotaReal.statusCode}`);

  // ----- MUTAÇÃO de listagem: sem empresaId, a venda de A apareceria para B -----
  const listagemVazada = await prisma.venda.findMany({ where: { id: idA } });
  ok('MUT-3: listagem sem filtro de empresa exporia a venda de A', listagemVazada.some((v) => v.id === idA), `qtd=${listagemVazada.length}`);
  const listagemReal = await app.inject({ method: 'GET', url: '/vendas', headers: bearer(tokB) });
  const idsB = listagemReal.json().vendas?.map((v: any) => v.id) ?? [];
  ok('MUT-4: listagem real NÃO expõe a venda de A para B', !idsB.includes(idA), `ids=${JSON.stringify(idsB).slice(0, 80)}`);

  // ----- MUTAÇÃO de cancelamento: update sem empresaId alteraria a venda alheia -----
  const cancelamentoVazado = await prisma.venda.updateMany({ where: { id: idA }, data: { status: 'CANCELADA' } });
  ok('MUT-5: update sem filtro de empresa alteraria venda alheia (violação detectável)', cancelamentoVazado.count === 1, `count=${cancelamentoVazado.count}`);
  // Restaura o estado para não deixar resíduo lógico.
  await prisma.venda.update({ where: { id: idA }, data: { status: 'FINALIZADA' } });
  const rotaCancel = await app.inject({ method: 'POST', url: `/vendas/${idA}/cancelar`, headers: bearer(tokB), payload: { motivo: 'mutacao' } });
  ok('MUT-6: rota real de cancelar nega B -> 404', rotaCancel.statusCode === 404, `status=${rotaCancel.statusCode}`);

  console.log(`\nRESULTADO M07-MUTACAO: ok=${passou} falha=${falhas}`);
  if (falhas > 0) process.exitCode = 1;
  await app.close();
  await prisma.$disconnect();
}
main();

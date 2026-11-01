import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

// MÓDULO 10 — Idempotência de SANGRIA e SUPRIMENTO (pendência crítica do M06).
//
// Antes desta correção, duas requisições idênticas geravam DUAS movimentações e
// mexiam no saldo da gaveta duas vezes (clique duplo, retry após timeout,
// reconexão). Agora `POST /pdv/caixa/movimentacoes` aceita `X-Idempotency-Key`
// e reusa IdempotencyKey (único por [empresaId, key]) — mesma proteção das
// vendas, sem migração de schema.
//
// Este teste exige fixtures isoladas e roda só com RUN_PDV_DB_TEST=1.

const EMPRESA = 'pdv-audit-test-empresa';
const FILIAL = 'pdv-audit-test-filial';

test('M10 idempotência: sangria repetida com a mesma chave NÃO duplica movimentação nem saldo', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const runId = randomUUID();
  const operadorId = `pdv-m10-${runId}`;
  const operador = await prisma.usuario.create({
    data: {
      id: operadorId,
      empresaId: EMPRESA,
      filialId: FILIAL,
      nome: 'Operador M10 (teste dedicado)',
      email: `pdv-m10-${runId}@teste.local`,
      senhaHash: 'sem-login-neste-teste',
    },
    select: { id: true, email: true },
  });
  // Permissões exigidas pelas rotas: /pdv/caixa/abrir (pdv:criar) e
  // /pdv/caixa/movimentacoes (pdv:editar) — verificadas no banco pelo backend.
  await prisma.permissao.createMany({
    data: [
      { usuarioId: operadorId, modulo: 'pdv', acao: 'criar', permitido: true },
      { usuarioId: operadorId, modulo: 'pdv', acao: 'editar', permitido: true },
    ],
  });
  const filial = await prisma.filial.findFirst({ where: { id: FILIAL, empresaId: EMPRESA }, select: { id: true } });
  assert.ok(filial, 'fixture de filial precisa existir');

  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: operador.id, empresaId: EMPRESA, email: operador.email }, { expiresIn: '1h' });
  const req = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}`, ...headers }, payload });

  let caixaId: string | null = null;
  try {
    // Abre caixa isolado para o turno deste teste.
    const abertura = await req('/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 200 });
    assert.equal(abertura.statusCode, 200, abertura.body);
    caixaId = abertura.json().id;

    const chave = `sangria-${runId}-abcdef`;
    const corpo = { tipo: 'SANGRIA', valor: 50, motivo: 'Troco inicial' };

    // 1) Operação normal: 200, uma movimentação, saldo 200 -> 150.
    const primeira = await req('/pdv/caixa/movimentacoes', corpo, { 'x-idempotency-key': chave });
    assert.equal(primeira.statusCode, 200, primeira.body);
    const mov1 = primeira.json();
    assert.equal(Number((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).saldo), 150);

    // 2) Repetição com a MESMA chave (clique duplo / retry): devolve o MESMO
    //    resultado, sem criar segunda movimentação nem mexer no saldo de novo.
    const repeticao = await req('/pdv/caixa/movimentacoes', corpo, { 'x-idempotency-key': chave });
    assert.equal(repeticao.statusCode, 200, repeticao.body);
    assert.equal(repeticao.json().id, mov1.id, 'repetição devolve a mesma movimentação');
    assert.equal(Number((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).saldo), 150, 'saldo não muda na repetição');
    const movsChave = await prisma.movimentacaoCaixa.count({ where: { caixaId, usuarioId: operador.id, motivo: 'Troco inicial' } });
    assert.equal(movsChave, 1, 'deve existir exatamente UMA movimentação para a chave repetida');

    // 3) Nova sangria legítima, chave diferente, mesmo valor: cria nova e mexe no saldo.
    const chave2 = `sangria-${runId}-ghijkl`;
    const segunda = await req('/pdv/caixa/movimentacoes', corpo, { 'x-idempotency-key': chave2 });
    assert.equal(segunda.statusCode, 200, segunda.body);
    assert.notEqual(segunda.json().id, mov1.id, 'operação legítima distinta cria movimentação própria');
    assert.equal(Number((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).saldo), 100, 'segunda sangria legítima reduz o saldo');
  } finally {
    if (caixaId) {
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Caixa', entidadeId: caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: EMPRESA, key: { startsWith: `sangria-${runId}` } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: operadorId } });
    await prisma.usuario.deleteMany({ where: { id: operadorId } });
    await app.close();
  }
});

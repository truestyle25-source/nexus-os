import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

test('PDV FASE 4: reconciliação idempotente é persistida e limitada ao operador no PostgreSQL', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const usuarios = await prisma.usuario.findMany({ where: { status: 'ATIVO' }, select: { id: true, empresaId: true, email: true } });
  let operador: (typeof usuarios)[number] | undefined;
  for (const usuario of usuarios) {
    const permissao = await prisma.permissao.findFirst({
      where: { usuarioId: usuario.id, permitido: true, OR: [{ modulo: 'pdv', acao: 'visualizar' }, { modulo: 'pdv', acao: 'criar' }, { modulo: 'vendas', acao: 'visualizar' }] },
      select: { id: true },
    });
    if (permissao) { operador = usuario; break; }
  }
  assert.ok(operador, 'PostgreSQL precisa de operador ativo com permissão de PDV/Vendas.');

  const prefixo = `pdv-fase4-${randomUUID()}`;
  const vendaId = randomUUID();
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: operador.id, empresaId: operador.empresaId, email: operador.email }, { expiresIn: '1h' });

  try {
    await prisma.idempotencyKey.createMany({ data: [
      { key: `${prefixo}-confirmada`, empresaId: operador.empresaId, operadorId: operador.id, status: 'CONFIRMADA', vendaId, responseStatus: 201, responseBody: { segredo: 'não deve ser exposto' } },
      { key: `${prefixo}-rejeitada`, empresaId: operador.empresaId, operadorId: operador.id, status: 'REJEITADA', responseStatus: 422, responseBody: { error: 'rejeitada' } },
      { key: `${prefixo}-processando`, empresaId: operador.empresaId, operadorId: operador.id, status: 'PROCESSANDO' },
      { key: `${prefixo}-outro-operador`, empresaId: operador.empresaId, operadorId: randomUUID(), status: 'CONFIRMADA', vendaId, responseStatus: 201 },
    ] });

    const consultar = (key: string) => app.inject({ method: 'GET', url: `/vendas/idempotencia/${encodeURIComponent(key)}`, headers: { authorization: `Bearer ${token}` } });
    const confirmada = await consultar(`${prefixo}-confirmada`);
    assert.equal(confirmada.statusCode, 200, confirmada.body);
    assert.equal(confirmada.json().status, 'CONFIRMADA');
    assert.equal(confirmada.json().vendaId, vendaId);
    assert.equal('responseBody' in confirmada.json(), false, 'a rota não deve expor o corpo completo da venda');
    assert.equal((await consultar(`${prefixo}-rejeitada`)).json().status, 'REJEITADA');
    assert.equal((await consultar(`${prefixo}-processando`)).json().status, 'PROCESSANDO');
    assert.equal((await consultar(`${prefixo}-inexistente`)).statusCode, 404);
    assert.equal((await consultar(`${prefixo}-outro-operador`)).statusCode, 404, 'uma chave de outro operador deve permanecer oculta');
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: operador.empresaId, key: { startsWith: prefixo } } });
    await app.close();
  }
});

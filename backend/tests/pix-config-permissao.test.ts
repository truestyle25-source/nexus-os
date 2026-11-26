import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissoesDoCargo } from '../src/lib/permissoes-catalogo.js';

/** Operador e Supervisor NÃO alteram nem veem o PIX da empresa; Gestor altera; Financeiro / RH só vê. */
test('PIX da empresa: só o Gestor altera', { skip: process.env.RUN_PDV_DB_TEST !== '1' }, async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  const { pixRoutes } = await import('../src/modules/payments/pix.routes.js');
  const { pdvRoutes } = await import('../src/modules/pdv/pdv.routes.js');
  const { registerAuthentication } = await import('../src/middlewares/auth.js');
  const empresaId = 'pdv-audit-test-empresa';
  const r = randomUUID().slice(0, 8);
  const ids: Record<string, string> = { OPERADOR: `pix-op-${r}`, SUPERVISOR: `pix-sup-${r}`, FINANCEIRO: `pix-fin-${r}`, GESTOR: `pix-ges-${r}` };
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(pixRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const chamar = (cargo: string, method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, payload, headers: { authorization: `Bearer ${app.jwt.sign({ id: ids[cargo], empresaId, email: `${ids[cargo]}@nexus.test` })}` } });
  const corpo = { enabled: false, keyType: 'CPF', pixKey: '00000000191', merchantName: 'Teste', merchantCity: 'Londrina', document: '00000000191' };
  try {
    for (const [cargo, id] of Object.entries(ids)) {
      await prisma.usuario.create({ data: { id, empresaId, nome: cargo, email: `${id}@nexus.test`, senhaHash: 'x', status: 'ATIVO', cargo } as any });
      await prisma.permissao.createMany({ data: permissoesDoCargo(cargo as any).map((p) => ({ usuarioId: id, ...p, permitido: true })) as any });
    }
    for (const cargo of ['OPERADOR', 'SUPERVISOR']) {
      assert.equal((await chamar(cargo, 'PUT', '/api/v1/settings/pix', corpo)).statusCode, 403, `${cargo} não altera o PIX`);
      assert.equal((await chamar(cargo, 'GET', '/api/v1/settings/pix')).statusCode, 403, `${cargo} não vê o PIX`);
      assert.equal((await chamar(cargo, 'POST', '/pdv/integracoes', { nome: 'X', tipo: 'BALANCA' })).statusCode, 403, `${cargo} não cadastra equipamento`);
    }
    assert.equal((await chamar('FINANCEIRO', 'GET', '/api/v1/settings/pix')).statusCode, 200, 'Financeiro / RH vê');
    assert.equal((await chamar('FINANCEIRO', 'PUT', '/api/v1/settings/pix', corpo)).statusCode, 403, 'Financeiro / RH não altera');
    assert.notEqual((await chamar('GESTOR', 'PUT', '/api/v1/settings/pix', corpo)).statusCode, 403, 'Gestor altera');
  } finally {
    const lista = Object.values(ids);
    await prisma.pixSettings.deleteMany({ where: { empresaId } });
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: lista } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: lista } } });
    await prisma.usuario.deleteMany({ where: { id: { in: lista } } });
    await app.close();
    await prisma.$disconnect();
  }
});

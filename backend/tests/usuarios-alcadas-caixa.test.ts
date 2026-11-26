import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { usuariosRoutes } from '../src/modules/usuarios/usuarios.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

/** Alçadas do caixa: ligar/desligar sem apagar as outras permissões. */
test('Usuários: alçadas do caixa (supervisor e descontos)', { skip: process.env.RUN_PDV_DB_TEST !== '1' }, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const runId = randomUUID();
  const adminId = `alc-admin-${runId}`;
  const alvoId = `alc-alvo-${runId}`;
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(usuariosRoutes);
  await app.ready();
  try {
    for (const id of [adminId, alvoId]) {
      await prisma.usuario.create({ data: { id, empresaId, nome: id, email: `${id}@nexus.test`, senhaHash: 'x', status: 'ATIVO' } as any });
    }
    await prisma.permissao.createMany({ data: [
      { usuarioId: adminId, modulo: 'usuarios', acao: 'visualizar', permitido: true },
      { usuarioId: adminId, modulo: 'usuarios', acao: 'editar', permitido: true },
      { usuarioId: alvoId, modulo: 'pdv', acao: 'criar', permitido: true },
    ] as any });
    const token = app.jwt.sign({ id: adminId, empresaId, email: `${adminId}@nexus.test` }, { expiresIn: '1h' });
    const req = (method: 'GET' | 'PATCH', id: string, payload?: unknown) =>
      app.inject({ method, url: `/usuarios/${id}/permissoes-especiais`, headers: { authorization: `Bearer ${token}` }, payload });

    const antes = await req('GET', alvoId);
    assert.equal(antes.statusCode, 200, antes.body);
    assert.equal(antes.json().permissoes.find((p: any) => p.acao === 'supervisor').rotulo, 'Supervisor');
    assert.ok(antes.json().permissoes.every((p: any) => p.permitido === false));

    const salvar = await req('PATCH', alvoId, { permissoes: [
      { modulo: 'pdv', acao: 'supervisor', permitido: true },
      { modulo: 'vendas', acao: 'desconto_supervisor', permitido: true },
      { modulo: 'vendas', acao: 'desconto_gerente', permitido: false },
    ] });
    assert.equal(salvar.statusCode, 200, salvar.body);
    const depois = (await req('GET', alvoId)).json().permissoes;
    assert.deepEqual(depois.map((p: any) => p.permitido), [true, true, false]);
    // As outras permissões continuam lá.
    assert.ok(await prisma.permissao.findFirst({ where: { usuarioId: alvoId, modulo: 'pdv', acao: 'criar' } }));

    // Permissão inventada é recusada.
    assert.equal((await req('PATCH', alvoId, { permissoes: [{ modulo: 'pdv', acao: 'dono', permitido: true }] })).statusCode >= 400, true);
    // Ninguém altera as próprias alçadas.
    assert.equal((await req('PATCH', adminId, { permissoes: [{ modulo: 'pdv', acao: 'supervisor', permitido: true }] })).statusCode, 403);
  } finally {
    await prisma.auditoria.deleteMany({ where: { usuarioId: adminId } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: [adminId, alvoId] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [adminId, alvoId] } } });
    await app.close();
    await prisma.$disconnect();
  }
});

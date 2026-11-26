import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissoesDoCargo, todasPermissoes } from '../src/lib/permissoes-catalogo.js';

const tem = (cargo: Parameters<typeof permissoesDoCargo>[0], chave: string) =>
  permissoesDoCargo(cargo).some((p) => `${p.modulo}:${p.acao}` === chave);

test('cargos: tabela aprovada', () => {
  // Operador: PDV e clientes; nada de RH, financeiro, usuários.
  for (const c of ['pdv:criar', 'clientes:criar', 'produtos:visualizar']) assert.ok(tem('OPERADOR', c), c);
  for (const c of ['rh:visualizar', 'ponto:visualizar', 'financeiro:visualizar', 'custos:visualizar', 'usuarios:visualizar', 'pdv:supervisor', 'vendas:desconto_supervisor', 'compras:visualizar'])
    assert.ok(!tem('OPERADOR', c), c);
  // Supervisor: autoriza no caixa, desconto até 30%; sem RH e financeiro.
  for (const c of ['pdv:supervisor', 'vendas:desconto_supervisor', 'estoque:editar', 'compras:criar']) assert.ok(tem('SUPERVISOR', c), c);
  for (const c of ['rh:visualizar', 'financeiro:visualizar', 'vendas:desconto_gerente', 'usuarios:visualizar']) assert.ok(!tem('SUPERVISOR', c), c);
  // Financeiro / RH: total em RH, ponto e financeiro; não vende nem autoriza no caixa.
  for (const c of ['rh:editar', 'rh:excluir', 'ponto:editar', 'financeiro:excluir', 'compras:administrar', 'pdv:visualizar']) assert.ok(tem('FINANCEIRO', c), c);
  for (const c of ['pdv:criar', 'pdv:supervisor', 'usuarios:visualizar', 'integracoes:visualizar', 'empresa:editar']) assert.ok(!tem('FINANCEIRO', c), c);
  // Gestor: tudo + alçadas.
  assert.ok(tem('GESTOR', 'vendas:desconto_gerente'));
  assert.ok(todasPermissoes().every((p) => tem('GESTOR', `${p.modulo}:${p.acao}`)));
});

test('cargos: criar operador pelo cargo e ele é barrado no RH', { skip: process.env.RUN_PDV_DB_TEST !== '1' }, async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  const { usuariosRoutes } = await import('../src/modules/usuarios/usuarios.routes.js');
  const { rhRoutes } = await import('../src/modules/rh/rh.routes.js') as any;
  const { registerAuthentication } = await import('../src/middlewares/auth.js');
  const empresaId = 'pdv-audit-test-empresa';
  const runId = randomUUID();
  const gestorId = `cargo-gestor-${runId}`;
  const email = `cargo-op-${runId}@nexus.test`;
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(usuariosRoutes);
  await app.register(rhRoutes);
  await app.ready();
  let novoId: string | null = null;
  try {
    await prisma.usuario.create({ data: { id: gestorId, empresaId, nome: 'Gestor', email: `${gestorId}@nexus.test`, senhaHash: 'x', status: 'ATIVO', cargo: 'GESTOR' } as any });
    await prisma.permissao.createMany({ data: permissoesDoCargo('GESTOR').map((p) => ({ usuarioId: gestorId, ...p, permitido: true })) as any });
    const tok = app.jwt.sign({ id: gestorId, empresaId, email: `${gestorId}@nexus.test` }, { expiresIn: '1h' });
    const criar = await app.inject({ method: 'POST', url: '/usuarios', headers: { authorization: `Bearer ${tok}` }, payload: { nome: 'Op Teste', email, senha: 'senha-op-1', cargo: 'OPERADOR' } });
    assert.equal(criar.statusCode, 200, criar.body);
    novoId = criar.json().id;
    assert.equal(criar.json().cargo, 'OPERADOR');
    const opTok = app.jwt.sign({ id: novoId, empresaId, email }, { expiresIn: '1h' });
    assert.equal((await app.inject({ method: 'GET', url: '/cargos', headers: { authorization: `Bearer ${opTok}` } })).statusCode, 403, 'operador barrado no RH');
    assert.equal((await app.inject({ method: 'GET', url: '/usuarios', headers: { authorization: `Bearer ${opTok}` } })).statusCode, 403, 'operador barrado em usuários');
    // Troca para Financeiro / RH: passa a entrar no RH.
    const troca = await app.inject({ method: 'PUT', url: `/usuarios/${novoId}/cargo`, headers: { authorization: `Bearer ${tok}` }, payload: { cargo: 'FINANCEIRO' } });
    assert.equal(troca.statusCode, 200, troca.body);
    assert.equal((await app.inject({ method: 'GET', url: '/cargos', headers: { authorization: `Bearer ${opTok}` } })).statusCode, 200, 'financeiro/RH entra no RH');
    // Ninguém troca o próprio cargo.
    assert.equal((await app.inject({ method: 'PUT', url: `/usuarios/${gestorId}/cargo`, headers: { authorization: `Bearer ${tok}` }, payload: { cargo: 'OPERADOR' } })).statusCode, 403);
  } finally {
    const ids = [gestorId, ...(novoId ? [novoId] : [])];
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await app.close();
    await prisma.$disconnect();
  }
});

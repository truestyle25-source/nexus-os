import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissoesDoCargo } from '../src/lib/permissoes-catalogo.js';

/** Operador vê só o próprio ponto e as próprias metas; supervisor vê a equipe; Financeiro / RH vê tudo. */
test('Ponto e Metas: só o próprio / da equipe', { skip: process.env.RUN_PDV_DB_TEST !== '1' }, async () => {
  const { prisma } = await import('../src/lib/prisma.js');
  const { rhRoutes } = await import('../src/modules/rh/rh.routes.js');
  const { gestaoRoutes } = await import('../src/modules/gestao/gestao.routes.js') as any;
  const { registerAuthentication } = await import('../src/middlewares/auth.js');
  const empresaId = 'pdv-audit-test-empresa';
  const r = randomUUID().slice(0, 8);
  const setorId = `esc-setor-${r}`;
  const pessoas = { op: `esc-op-${r}`, colega: `esc-colega-${r}`, sup: `esc-sup-${r}`, fin: `esc-fin-${r}`, fora: `esc-fora-${r}` };
  const cargoDe: Record<string, any> = { op: 'OPERADOR', colega: 'OPERADOR', sup: 'SUPERVISOR', fin: 'FINANCEIRO', fora: 'OPERADOR' };
  const funcs: Record<string, string> = {};
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(rhRoutes);
  await app.register(gestaoRoutes);
  await app.ready();
  const get = (quem: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${app.jwt.sign({ id: (pessoas as any)[quem], empresaId, email: `${(pessoas as any)[quem]}@nexus.test` })}` } });
  try {
    await prisma.setor.create({ data: { id: setorId, empresaId, nome: `Setor ${r}` } as any });
    for (const [k, id] of Object.entries(pessoas)) {
      await prisma.usuario.create({ data: { id, empresaId, nome: k, email: `${id}@nexus.test`, senhaHash: 'x', status: 'ATIVO', cargo: cargoDe[k], setorId: k === 'fora' ? null : setorId } as any });
      await prisma.permissao.createMany({ data: permissoesDoCargo(cargoDe[k]).map((p) => ({ usuarioId: id, ...p, permitido: true })) as any });
      if (k !== 'fin') {
        const f = await prisma.funcionario.create({ data: { empresaId, nome: k, cpf: `${Math.floor(Math.random() * 1e11)}`.padStart(11, '0'), usuarioId: id } as any });
        funcs[k] = f.id;
        await prisma.ponto.create({ data: { empresaId, funcionarioId: f.id, data: new Date('2026-11-20T00:00:00Z') } as any });
        await prisma.meta.create({ data: { empresaId, funcionarioId: f.id, tipo: 'FUNCIONARIO', periodo: '2026-11', metaValor: 100 } as any });
      }
    }

    // Operador: só o próprio, mesmo pedindo o de outro funcionário.
    const pontoOp = (await get('op', '/ponto')).json();
    assert.deepEqual([...new Set(pontoOp.map((p: any) => p.funcionarioId))], [funcs.op]);
    assert.ok((await get('op', `/ponto?funcionarioId=${funcs.colega}`)).json().every((p: any) => p.funcionarioId === funcs.op), "nunca o do colega");
    const metasOp = (await get('op', '/metas')).json().metas;
    assert.deepEqual(metasOp.map((m: any) => m.funcionarioId), [funcs.op]);

    // Supervisor: metas da equipe (mesmo setor), não de quem é de fora; ponto só o próprio.
    const metasSup = (await get('sup', '/metas')).json().metas.map((m: any) => m.funcionarioId);
    for (const k of ['op', 'colega', 'sup']) assert.ok(metasSup.includes(funcs[k]), k);
    assert.ok(!metasSup.includes(funcs.fora));
    assert.deepEqual([...new Set((await get('sup', '/ponto')).json().map((p: any) => p.funcionarioId))], [funcs.sup]);

    // Financeiro / RH: vê todos.
    const pontoFin = (await get('fin', '/ponto')).json().map((p: any) => p.funcionarioId);
    for (const k of ['op', 'colega', 'sup', 'fora']) assert.ok(pontoFin.includes(funcs[k]), k);
  } finally {
    const ids = Object.values(pessoas);
    const fids = Object.values(funcs);
    await prisma.ponto.deleteMany({ where: { funcionarioId: { in: fids } } });
    await prisma.meta.deleteMany({ where: { funcionarioId: { in: fids } } });
    await prisma.funcionario.deleteMany({ where: { id: { in: fids } } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: ids } } });
    await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
    await prisma.setor.deleteMany({ where: { id: setorId } });
    await app.close();
    await prisma.$disconnect();
  }
});

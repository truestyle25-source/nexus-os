import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissoesDoCargo } from '../src/lib/permissoes-catalogo.js';

/** Supervisor não lê RH; ativar/desativar produto, cliente e fornecedor exige "editar". */
test('Travas: RH e ativar/desativar', { skip: process.env.RUN_PDV_DB_TEST !== '1' }, async () => {
  const { app } = await import('../src/server.js');
  const { prisma } = await import('../src/lib/prisma.js');
  await app.ready();
  const empresaId = 'pdv-audit-test-empresa';
  const r = randomUUID().slice(0, 8);
  const cargos = ['OPERADOR', 'SUPERVISOR', 'FINANCEIRO'] as const;
  const ids: Record<string, string> = {};
  try {
    for (const c of cargos) {
      const id = `trava-${c.toLowerCase()}-${r}`; ids[c] = id;
      await prisma.usuario.create({ data: { id, empresaId, nome: c, email: `${id}@nexus.test`, senhaHash: 'x', status: 'ATIVO', cargo: c } as any });
      await prisma.permissao.createMany({ data: permissoesDoCargo(c).map((p) => ({ usuarioId: id, ...p, permitido: true })) as any });
    }
    const pedir = (c: string, method: any, url: string, body?: unknown) => app.inject({
      method, url, payload: body as any,
      headers: { authorization: `Bearer ${app.jwt.sign({ id: ids[c], empresaId, email: `${ids[c]}@nexus.test` })}` },
    });
    const rh = ['/rh/lideranca/feedbacks', '/rh/treinamentos', '/rh/planos-desenvolvimento', '/rh/pontuacao/criterios', '/rh/loja/saldos', '/rh/gestao-tempo/resumo', '/radar/disc/funcionarios'];
    for (const url of rh) {
      assert.equal((await pedir('SUPERVISOR', 'GET', url)).statusCode, 403, `supervisor ${url}`);
      assert.notEqual((await pedir('FINANCEIRO', 'GET', url)).statusCode, 403, `financeiro ${url}`);
    }
    const status = [
      ['/produtos/x-inexistente/status', { status: 'INATIVO' }],
      ['/produtos/status-lote', { ids: ['x-inexistente'], status: 'INATIVO' }],
      ['/clientes/x-inexistente/status', { status: 'INATIVO' }],
      ['/fornecedores/x-inexistente/status', { status: 'INATIVO' }],
    ] as const;
    for (const [url, body] of status) assert.equal((await pedir('OPERADOR', 'PATCH', url, body)).statusCode, 403, `operador ${url}`);
    assert.notEqual((await pedir('SUPERVISOR', 'PATCH', '/produtos/x-inexistente/status', { status: 'INATIVO' })).statusCode, 403);
  } finally {
    const lista = Object.values(ids);
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: lista } } });
    await prisma.usuario.deleteMany({ where: { id: { in: lista } } });
    await app.close();
    await prisma.$disconnect();
  }
});

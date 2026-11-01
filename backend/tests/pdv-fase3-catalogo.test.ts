import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

test('PDV FASE 3: catálogo mínimo é isolado por empresa/filial e pagina no PostgreSQL', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const secret = process.env.JWT_SECRET || 'secret';
  const usuarios = await prisma.usuario.findMany({ where: { status: 'ATIVO' }, select: { id: true, empresaId: true, email: true } });
  let operador: (typeof usuarios)[number] | undefined;
  let filialId = '';
  for (const usuario of usuarios) {
    const [permissao, filial] = await Promise.all([
      prisma.permissao.findFirst({ where: { usuarioId: usuario.id, modulo: 'pdv', acao: 'visualizar', permitido: true }, select: { id: true } }),
      prisma.filial.findFirst({ where: { empresaId: usuario.empresaId, status: 'ATIVO' }, select: { id: true } }),
    ]);
    if (permissao && filial) { operador = usuario; filialId = filial.id; break; }
  }
  assert.ok(operador, 'PostgreSQL precisa de operador ativo com pdv.visualizar e filial ativa.');

  const produtoId = randomUUID();
  const run = randomUUID();
  const app = Fastify();
  await app.register(jwt, { secret });
  registerAuthentication(app);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: operador.id, empresaId: operador.empresaId, email: operador.email }, { expiresIn: '1h' });

  try {
    await prisma.produto.create({
      data: {
        id: produtoId, empresaId: operador.empresaId, nome: `PDV-FASE3-${run}`,
        sku: `PDV-FASE3-${run}`, custo: 5, precoVenda: 23.45, unidade: 'UN', status: 'ATIVO',
      },
    });
    await prisma.estoque.create({ data: { empresaId: operador.empresaId, filialId, produtoId, quantidade: 17, valorTotal: 85 } });

    const resposta = await app.inject({
      method: 'GET',
      url: `/pdv/catalogo?filialId=${filialId}&take=500&skip=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(resposta.statusCode, 200, resposta.body);
    const corpo = resposta.json();
    const produto = corpo.produtos.find((item: any) => item.id === produtoId);
    assert.ok(produto, 'o produto de teste deve aparecer no catálogo da filial');
    assert.equal(produto.estoqueFilial, 17);
    assert.equal(produto.precoVenda, 23.45);
    assert.equal(produto.ativo, true);
    assert.equal('custo' in produto, false, 'o catálogo local não pode devolver custo');
    assert.equal('fornecedorId' in produto, false, 'o catálogo local deve conter apenas campos necessários');

    const desde = new Date(Date.now() - 60_000).toISOString();
    const incremental = await app.inject({
      method: 'GET',
      url: `/pdv/catalogo?filialId=${filialId}&desde=${encodeURIComponent(desde)}&take=500`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(incremental.statusCode, 200, incremental.body);
    assert.ok(incremental.json().produtos.some((item: any) => item.id === produtoId), 'atualização recente precisa ser incluída no sync incremental');
  } finally {
    await prisma.estoque.deleteMany({ where: { produtoId } });
    await prisma.produto.deleteMany({ where: { id: produtoId, empresaId: operador.empresaId } });
    await app.close();
  }
});

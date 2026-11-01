import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

// FASE 3 PDV PRO — 10 caixas simultâneos disputando a última unidade.
// Segue o padrão do teste FASE 2: fixtures próprias (produto + estoque +
// operador), chaves idempotentes distintas por caixa, cleanup no finally.
// Sem caixaId: isola a concorrência de ESTOQUE (o lock de caixa é outro eixo).
test('PDV PRO FASE 3: 10 caixas simultâneos, 1 vence e 9 são rejeitados sem estoque negativo', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const tokenSecret = process.env.JWT_SECRET || 'secret';

  const usuarios = await prisma.usuario.findMany({
    where: { status: 'ATIVO' },
    select: { id: true, empresaId: true, email: true },
  });
  let usuario: (typeof usuarios)[number] | undefined;
  for (const candidato of usuarios) {
    const perms = await prisma.permissao.findMany({
      where: { usuarioId: candidato.id, permitido: true, modulo: { in: ['vendas', 'pdv'] } },
      select: { modulo: true, acao: true },
    });
    const podeCriar = perms.some((p) => (p.modulo === 'vendas' && p.acao === 'criar') || (p.modulo === 'pdv' && p.acao === 'criar'));
    const filiais = await prisma.filial.count({ where: { empresaId: candidato.empresaId, status: 'ATIVO' } });
    if (podeCriar && filiais > 0) { usuario = candidato; break; }
  }
  assert.ok(usuario, 'PostgreSQL precisa conter um usuário ativo com vendas/pdv:criar e uma filial ativa.');
  const filial = await prisma.filial.findFirst({ where: { empresaId: usuario.empresaId, status: 'ATIVO' }, select: { id: true } });
  assert.ok(filial);

  const app = Fastify();
  await app.register(jwt, { secret: tokenSecret });
  await app.register(registerAuthentication);
  await app.register(vendasRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: usuario.id, empresaId: usuario.empresaId, email: usuario.email }, { expiresIn: '1h' });

  const runId = randomUUID();
  const produtoId = randomUUID();
  let vendaIdVencedora: string | null = null;

  try {
    await prisma.produto.create({
      data: {
        id: produtoId, empresaId: usuario.empresaId, nome: `PDV-FASE3-10CAIXAS-${runId}`,
        sku: `PDV-FASE3-${runId}`, custo: 5, precoVenda: 100, unidade: 'UN', status: 'ATIVO',
      },
    });
    await prisma.estoque.upsert({
      where: { filialId_produtoId: { filialId: filial.id, produtoId } },
      update: { quantidade: 1 },
      create: { empresaId: usuario.empresaId, filialId: filial.id, produtoId, quantidade: 1, valorTotal: 5 },
    });

    const corpo = {
      filialId: filial.id, formaPagamento: 'DINHEIRO',
      itens: [{ produtoId, quantidade: 1, desconto: 0 }],
    };
    // 10 caixas disparam ao mesmo tempo, cada um com sua chave idempotente.
    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: 'POST', url: '/vendas', headers: { authorization: `Bearer ${token}`, 'x-idempotency-key': `fase3-10caixas-${runId}-${i}` }, payload: corpo,
        }),
      ),
    );
    const sucessos = respostas.filter((r) => r.statusCode === 201);
    const rejeitados = respostas.filter((r) => r.statusCode !== 201);
    assert.equal(sucessos.length, 1, `Exatamente 1 caixa deve vencer, 9 rejeitados. Status: ${respostas.map((r) => r.statusCode).join(',')}`);
    assert.equal(rejeitados.length, 9);
    assert.ok(rejeitados.every((r) => r.statusCode === 400 || r.statusCode === 409 || r.statusCode === 422), 'Rejeitados devem ser 400/409/422 (estoque insuficiente/conflito), nunca 500.');

    vendaIdVencedora = sucessos[0].json().venda.id;
    const estoqueFinal = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId } } });
    assert.equal(estoqueFinal.quantidade, 0, 'Estoque final deve ser 0, nunca negativo.');

    const vendasDoProduto = await prisma.venda.count({ where: { empresaId: usuario.empresaId, itens: { some: { produtoId } } } });
    assert.equal(vendasDoProduto, 1, 'Deve existir exatamente 1 venda persistida.');
    assert.equal(await prisma.financeiro.count({ where: { vendaId: vendaIdVencedora, empresaId: usuario.empresaId, status: 'PAGO' } }), 1, 'A venda única deve produzir um único lançamento financeiro.');
    assert.equal(
      await prisma.estoqueMovimentacao.count({ where: { empresaId: usuario.empresaId, produtoId, documento: vendaIdVencedora, tipo: 'VENDA' } }),
      1, 'A venda única deve produzir uma única baixa de estoque.',
    );
  } finally {
    if (vendaIdVencedora) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId: vendaIdVencedora } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId: vendaIdVencedora } });
      await prisma.financeiro.deleteMany({ where: { vendaId: vendaIdVencedora } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: vendaIdVencedora } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: vendaIdVencedora } });
      await prisma.venda.deleteMany({ where: { id: vendaIdVencedora } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId: usuario.empresaId, key: { startsWith: `fase3-10caixas-${runId}` } } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId } });
    await prisma.estoque.deleteMany({ where: { produtoId } });
    await prisma.produto.deleteMany({ where: { empresaId: usuario.empresaId, id: produtoId } });
    await app.close();
  }
});

import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';

test('duas telas/operadores não vendem a última unidade duas vezes', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operadorA = await prisma.usuario.findUnique({ where: { id: 'pdv-audit-test-operador' } });
  assert.ok(operadorA, 'O fixture isolado de operador precisa existir.');
  const filial = await prisma.filial.findFirst({ where: { empresaId, status: 'ATIVO' }, select: { id: true } });
  assert.ok(filial, 'O fixture isolado de filial precisa existir.');

  const runId = randomUUID();
  const produtoId = randomUUID();
  const produtoIdIdempotente = randomUUID();
  const operadorBId = randomUUID();
  const keyPrefix = `pdv-concorrencia-${runId}`;
  const app = Fastify();
  const secret = process.env.JWT_SECRET || 'secret';
  await app.register(jwt, { secret });
  await registerAuthentication(app);
  await app.register(vendasRoutes);
  await app.ready();

  try {
    await prisma.usuario.create({
      data: {
        id: operadorBId,
        empresaId,
        filialId: filial.id,
        nome: 'Segundo Operador de Teste',
        email: `pdv-concorrencia-${runId}@nexus.test`,
        senhaHash: 'não usado em teste de rota autenticada por JWT',
        permissoes: { create: { modulo: 'pdv', acao: 'criar', permitido: true } },
      },
    });
    await prisma.produto.create({
      data: {
        id: produtoId,
        empresaId,
        nome: `PDV-CONCORRENCIA-${runId}`,
        sku: `PDV-CONCORRENCIA-${runId}`,
        custo: 1,
        precoVenda: 10,
        unidade: 'UN',
        status: 'ATIVO',
      },
    });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId, quantidade: 1, valorTotal: 1 } });
    await prisma.produto.create({
      data: {
        id: produtoIdIdempotente,
        empresaId,
        nome: `PDV-IDEMPOTENCIA-${runId}`,
        sku: `PDV-IDEMPOTENCIA-${runId}`,
        custo: 1,
        precoVenda: 20,
        unidade: 'UN',
        status: 'ATIVO',
      },
    });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId: produtoIdIdempotente, quantidade: 5, valorTotal: 5 } });

    const tokenA = app.jwt.sign({ id: operadorA.id, empresaId, email: operadorA.email }, { expiresIn: '1h' });
    const tokenB = app.jwt.sign({ id: operadorBId, empresaId, email: `pdv-concorrencia-${runId}@nexus.test` }, { expiresIn: '1h' });
    const vender = (token: string, key: string) => app.inject({
      method: 'POST',
      url: '/vendas',
      headers: { authorization: `Bearer ${token}`, 'x-idempotency-key': key },
      payload: { filialId: filial.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId, quantidade: 1, desconto: 0 }] },
    });

    const [respostaA, respostaB] = await Promise.all([
      vender(tokenA, `${keyPrefix}-a`),
      vender(tokenB, `${keyPrefix}-b`),
    ]);
    const respostas = [respostaA, respostaB];
    assert.equal(respostas.filter((resposta) => resposta.statusCode >= 200 && resposta.statusCode < 300).length, 1, 'Exatamente uma tela deve confirmar a venda.');
    assert.equal(respostas.filter((resposta) => [400, 409, 422].includes(resposta.statusCode)).length, 1, 'A segunda venda deve falhar por estoque insuficiente/conflito.');

    const [estoque, vendas] = await Promise.all([
      prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId } } }),
      prisma.venda.findMany({ where: { empresaId, itens: { some: { produtoId } } }, include: { itens: true } }),
    ]);
    assert.equal(estoque.quantidade, 0, 'O saldo final deve ser zero, nunca negativo.');
    assert.equal(vendas.length, 1, 'Deve existir uma única venda persistida.');
    assert.equal(vendas[0].total.toString(), '10');
    assert.equal(vendas[0].itens.length, 1);
    assert.equal(vendas[0].itens[0].quantidade, 1);
    assert.equal(await prisma.financeiro.count({ where: { vendaId: vendas[0].id, empresaId, status: 'PAGO' } }), 1, 'A venda única deve produzir um único lançamento financeiro.');
    assert.equal(await prisma.estoqueMovimentacao.count({ where: { empresaId, produtoId, documento: vendas[0].id, tipo: 'VENDA' } }), 1, 'A venda única deve produzir uma única baixa de estoque.');

    const mesmaChave = `${keyPrefix}-mesma-chave`;
    const venderMesmoPayload = (token: string) => app.inject({
      method: 'POST',
      url: '/vendas',
      headers: { authorization: `Bearer ${token}`, 'x-idempotency-key': mesmaChave },
      payload: { filialId: filial.id, formaPagamento: 'DINHEIRO', itens: [{ produtoId: produtoIdIdempotente, quantidade: 1, desconto: 0 }] },
    });
    const [retryA, retryB] = await Promise.all([venderMesmoPayload(tokenA), venderMesmoPayload(tokenB)]);
    assert.ok([retryA, retryB].some((resposta) => resposta.statusCode >= 200 && resposta.statusCode < 300), 'Ao menos uma tentativa simultânea com a mesma chave deve concluir.');
    const registroIdempotencia = await prisma.idempotencyKey.findUniqueOrThrow({ where: { empresaId_key: { empresaId, key: mesmaChave } } });
    assert.equal(registroIdempotencia.status, 'CONFIRMADA');
    const vendaIdIdempotente = registroIdempotencia.vendaId;
    assert.ok(vendaIdIdempotente);
    const vendasComMesmaChave = await prisma.venda.findMany({ where: { empresaId, itens: { some: { produtoId: produtoIdIdempotente } } } });
    assert.equal(vendasComMesmaChave.length, 1, 'Duas tentativas com a mesma chave devem persistir uma venda.');
    assert.equal(vendasComMesmaChave[0].id, vendaIdIdempotente);
    assert.equal(await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId: produtoIdIdempotente } } }).then((registro) => registro.quantidade), 4);
    assert.equal(await prisma.financeiro.count({ where: { vendaId: vendaIdIdempotente, empresaId, status: 'PAGO' } }), 1);
    assert.equal(await prisma.estoqueMovimentacao.count({ where: { empresaId, produtoId: produtoIdIdempotente, documento: vendaIdIdempotente, tipo: 'VENDA' } }), 1);
  } finally {
    const vendas = await prisma.venda.findMany({ where: { empresaId, itens: { some: { produtoId: { in: [produtoId, produtoIdIdempotente] } } } }, select: { id: true } });
    const vendaIds = vendas.map((venda) => venda.id);
    if (vendaIds.length) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.financeiro.deleteMany({ where: { vendaId: { in: vendaIds } } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: { in: vendaIds } } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: { in: vendaIds } } });
      await prisma.venda.deleteMany({ where: { id: { in: vendaIds } } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId, key: { startsWith: keyPrefix } } });
    await prisma.estoque.deleteMany({ where: { filialId: filial.id, produtoId: { in: [produtoId, produtoIdIdempotente] } } });
    await prisma.produto.deleteMany({ where: { id: { in: [produtoId, produtoIdIdempotente] }, empresaId } });
    await prisma.usuario.deleteMany({ where: { id: operadorBId, empresaId } });
    await app.close();
  }
});

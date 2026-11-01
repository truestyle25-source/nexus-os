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
import { dataOperacionalDate } from '../src/lib/fuso.js';

test('fluxo integrado: abre caixa, vende, cancela, confere saldo e fecha no PostgreSQL', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operador = await prisma.usuario.findUnique({ where: { id: 'pdv-audit-test-operador' } });
  assert.ok(operador, 'O fixture isolado do operador precisa existir.');
  const filial = await prisma.filial.findFirst({ where: { id: 'pdv-audit-test-filial', empresaId }, select: { id: true, fusoHorario: true } });
  assert.ok(filial, 'O fixture isolado da filial precisa existir.');

  const runId = randomUUID();
  const produtoId = randomUUID();
  const key = `pdv-fluxo-${runId}`;
  let caixaId: string | null = null;
  let vendaId: string | null = null;
  const [{ agoraInicial }] = await prisma.$queryRaw<Array<{ agoraInicial: Date }>>`SELECT CURRENT_TIMESTAMP AS "agoraInicial"`;
  const dataOperacionalInicial = dataOperacionalDate(agoraInicial, filial.fusoHorario);
  const indicadorAnterior = await prisma.indicadorDiario.findUnique({
    where: { empresaId_filialId_data: { empresaId, filialId: filial.id, data: dataOperacionalInicial } },
    select: { id: true },
  });
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: operador.id, empresaId, email: operador.email }, { expiresIn: '1h' });
  const request = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, payload });

  try {
    await prisma.produto.create({
      data: { id: produtoId, empresaId, nome: `PDV-FLUXO-${runId}`, sku: `PDV-FLUXO-${runId}`, custo: 4, precoVenda: 10, unidade: 'UN', status: 'ATIVO' },
    });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId, quantidade: 5, valorTotal: 20 } });

    const abertura = await request('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 20 });
    assert.equal(abertura.statusCode, 200, abertura.body);
    caixaId = abertura.json().id;
    assert.ok(caixaId);
    assert.equal((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).status, 'ABERTO');

    const venda = await request('POST', '/vendas', {
      filialId: filial.id,
      caixaId,
      formaPagamento: 'TRANSFERENCIA',
      itens: [{ produtoId, quantidade: 2, desconto: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 5 }, { forma: 'TRANSFERENCIA', valor: 15 }],
    }, { 'x-idempotency-key': key });
    // FASE 1 PDV PRO: a criação de venda passou a devolver 201 Created
    // (decisão documentada em vendas.routes.ts — o helper do PDV aceita 2xx).
    assert.equal(venda.statusCode, 201, venda.body);
    vendaId = venda.json().venda.id;
    const persistida = await prisma.venda.findUniqueOrThrow({ where: { id: vendaId }, include: { itens: true, pagamentos: true } });
    assert.equal(Number(persistida.total), 20);
    assert.equal(persistida.itens.length, 1);
    assert.equal(persistida.itens[0].quantidade, 2);
    assert.equal(persistida.pagamentos.length, 2);
    assert.equal((await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId } } })).quantidade, 3);
    assert.equal(await prisma.financeiro.count({ where: { vendaId, empresaId, status: 'PAGO', valor: 20 } }), 1);
    assert.equal((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).saldo.toString(), '25');

    const resumoVenda = await request('GET', '/pdv/caixa/resumo');
    assert.equal(resumoVenda.statusCode, 200, resumoVenda.body);
    assert.equal(resumoVenda.json().dinheiroEsperado, 25);
    assert.equal(resumoVenda.json().porForma.DINHEIRO, 5);
    assert.equal(resumoVenda.json().porForma.TRANSFERENCIA, 15);

    const cancelamento = await request('POST', `/vendas/${vendaId}/cancelar`, { motivo: 'Teste isolado de estorno PDV' });
    assert.equal(cancelamento.statusCode, 200, cancelamento.body);
    assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).status, 'CANCELADA');
    assert.equal((await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId } } })).quantidade, 5);
    assert.equal(await prisma.financeiro.count({ where: { vendaId, empresaId, status: 'CANCELADO' } }), 1);
    assert.equal((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).saldo.toString(), '20');
    const resumoCancelado = await request('GET', '/pdv/caixa/resumo');
    assert.equal(resumoCancelado.statusCode, 200, resumoCancelado.body);
    assert.equal(resumoCancelado.json().dinheiroEsperado, 20, JSON.stringify(resumoCancelado.json()));
    assert.equal(resumoCancelado.json().estornos, 5, JSON.stringify(resumoCancelado.json()));

    const fechamento = await request('POST', '/pdv/caixa/fechar', { valorContado: 20, observacao: 'Fechamento de teste isolado' });
    assert.equal(fechamento.statusCode, 200, fechamento.body);
    assert.equal(fechamento.json().resumo.dinheiroEsperado, 20);
    assert.equal(fechamento.json().caixa.status, 'FECHADO');
    assert.equal(Number(fechamento.json().caixa.diferenca), 0);
    assert.equal((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId } })).status, 'FECHADO');
  } finally {
    if (vendaId) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId } });
      await prisma.financeiro.deleteMany({ where: { vendaId, empresaId } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: vendaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: vendaId } });
      await prisma.venda.deleteMany({ where: { id: vendaId } });
    }
    if (caixaId) {
      await prisma.auditoria.deleteMany({ where: { entidade: 'Caixa', entidadeId: caixaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    await prisma.idempotencyKey.deleteMany({ where: { empresaId, key } });
    if (!indicadorAnterior) {
      await prisma.indicadorDiario.deleteMany({ where: { empresaId, filialId: filial.id, data: dataOperacionalInicial } });
    }
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId } });
    await prisma.estoque.deleteMany({ where: { filialId: filial.id, produtoId } });
    await prisma.produto.deleteMany({ where: { id: produtoId, empresaId } });
    await app.close();
  }
});

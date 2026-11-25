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

/** I3 (troco gravado) e I4 (venda fracionada) no PostgreSQL. */
test('PDV: troco gravado e venda fracionada (kg)', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operador = await prisma.usuario.findUnique({ where: { id: 'pdv-audit-test-operador' } });
  assert.ok(operador, 'O fixture isolado do operador precisa existir.');
  const filial = await prisma.filial.findFirst({ where: { id: 'pdv-audit-test-filial', empresaId }, select: { id: true, fusoHorario: true } });
  assert.ok(filial);

  const runId = randomUUID();
  const granelId = randomUUID();
  const unitarioId = randomUUID();
  let caixaId: string | null = null;
  let vendaId: string | null = null;
  const [{ agora }] = await prisma.$queryRaw<Array<{ agora: Date }>>`SELECT CURRENT_TIMESTAMP AS "agora"`;
  const dataOp = dataOperacionalDate(agora, filial.fusoHorario);
  const indicadorAnterior = await prisma.indicadorDiario.findUnique({ where: { empresaId_filialId_data: { empresaId, filialId: filial.id, data: dataOp } }, select: { id: true } });

  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  await registerAuthentication(app);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.ready();
  const token = app.jwt.sign({ id: operador.id, empresaId, email: operador.email }, { expiresIn: '1h' });
  const request = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  try {
    await prisma.produto.create({ data: { id: granelId, empresaId, nome: `GRANEL-${runId}`, sku: `GRANEL-${runId}`, custo: 10, precoVenda: 40, unidade: 'KG', status: 'ATIVO', vendaFracionada: true } as any });
    await prisma.produto.create({ data: { id: unitarioId, empresaId, nome: `UNIT-${runId}`, sku: `UNIT-${runId}`, custo: 1, precoVenda: 5, unidade: 'UN', status: 'ATIVO' } });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId: granelId, quantidade: 2.5, valorTotal: 25 } });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId: unitarioId, quantidade: 10, valorTotal: 10 } });

    const abertura = await request('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 0 });
    assert.equal(abertura.statusCode, 200, abertura.body);
    caixaId = abertura.json().id;

    // Catálogo traz o estoque fracionado sem truncar (2,5 kg, não 2).
    const catalogo = await request('GET', `/pdv/catalogo?filialId=${filial.id}&take=500`);
    assert.equal(catalogo.statusCode, 200, catalogo.body);
    const noCatalogo = catalogo.json().produtos.find((p: any) => p.id === granelId);
    assert.equal(noCatalogo.estoqueFilial, 2.5);
    assert.equal(noCatalogo.vendaFracionada, true);

    // Produto unitário não aceita fração.
    const fracaoInvalida = await request('POST', '/vendas', { filialId: filial.id, caixaId, formaPagamento: 'DINHEIRO', itens: [{ produtoId: unitarioId, quantidade: 0.5, desconto: 0 }] });
    assert.equal(fracaoInvalida.statusCode, 422, fracaoInvalida.body);
    assert.match(fracaoInvalida.body, /inteira/);

    // Recebido menor que a parte em dinheiro: recusado.
    const recebidoMenor = await request('POST', '/vendas', {
      filialId: filial.id, caixaId, formaPagamento: 'DINHEIRO', itens: [{ produtoId: granelId, quantidade: 0.35, desconto: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 14, valorRecebido: 10 }],
    });
    assert.equal(recebidoMenor.statusCode, 422, recebidoMenor.body);

    // 0,350 kg x R$ 40 = R$ 14,00; cliente entrega R$ 20 → troco R$ 6.
    const venda = await request('POST', '/vendas', {
      filialId: filial.id, caixaId, formaPagamento: 'DINHEIRO', origem: 'PDV', itens: [{ produtoId: granelId, quantidade: 0.35, desconto: 0 }],
      pagamentos: [{ forma: 'DINHEIRO', valor: 14, valorRecebido: 20 }],
    });
    assert.equal(venda.statusCode, 201, venda.body);
    vendaId = venda.json().venda.id;
    const [pag] = await prisma.$queryRaw<Array<{ valorRecebido: string; troco: string }>>`
      SELECT "valorRecebido"::text, "troco"::text FROM "VendaPagamento" WHERE "vendaId" = ${vendaId}`;
    assert.equal(Number(pag.valorRecebido), 20);
    assert.equal(Number(pag.troco), 6);
    const item = await prisma.vendaItem.findFirstOrThrow({ where: { vendaId } });
    assert.equal(Number(item.quantidade), 0.35);
    assert.equal(Number(item.total), 14);
    const estoque = await prisma.estoque.findUniqueOrThrow({ where: { filialId_produtoId: { filialId: filial.id, produtoId: granelId } } });
    assert.equal(Number(estoque.quantidade), 2.15);
    // Na gaveta entra o valor da venda (R$ 14), não o que o cliente entregou.
    assert.equal(Number((await prisma.caixa.findUniqueOrThrow({ where: { id: caixaId! } })).saldo), 14);
  } finally {
    if (vendaId) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId } });
      await prisma.financeiro.deleteMany({ where: { vendaId, empresaId } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: vendaId } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: vendaId } });
      await prisma.vendaItem.deleteMany({ where: { vendaId } });
      await prisma.venda.deleteMany({ where: { id: vendaId } });
    }
    if (caixaId) {
      await prisma.auditoria.deleteMany({ where: { entidade: 'Caixa', entidadeId: caixaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    if (!indicadorAnterior) await prisma.indicadorDiario.deleteMany({ where: { empresaId, filialId: filial.id, data: dataOp } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId: { in: [granelId, unitarioId] } } });
    await prisma.estoque.deleteMany({ where: { filialId: filial.id, produtoId: { in: [granelId, unitarioId] } } });
    await prisma.produto.deleteMany({ where: { id: { in: [granelId, unitarioId] }, empresaId } });
    await app.close();
    await prisma.$disconnect();
  }
});

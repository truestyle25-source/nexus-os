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
import { hashSenha } from '../src/lib/auth.js';
import { dataOperacionalDate } from '../src/lib/fuso.js';

/**
 * 1) sangria com autorização (uso único) e dados do comprovante;
 * 2) relatório de fechamento e histórico;
 * 3) cancelamento de item do carrinho com autorização;
 * 4) cancelamento de venda paga com autorização e regras de estorno.
 */
test('PDV: autorizações do supervisor, itens cancelados e relatório de fechamento', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operador = await prisma.usuario.findUnique({ where: { id: 'pdv-audit-test-operador' } });
  assert.ok(operador);
  const filial = await prisma.filial.findFirst({ where: { id: 'pdv-audit-test-filial', empresaId }, select: { id: true, fusoHorario: true } });
  assert.ok(filial);

  const runId = randomUUID();
  const produtoId = randomUUID();
  const supId = `pdv-sup2-${runId}`;
  const supEmail = `pdv-sup2-${runId}@nexus.test`;
  const senha = 'senha-teste-supervisor-2';
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
  const req = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...headers }, payload });
  const autorizar = async (acao: string) => {
    const r = await req('POST', '/pdv/autorizacoes', { email: supEmail, senha, acao });
    assert.equal(r.statusCode, 200, r.body);
    return r.json().autorizacao as string;
  };

  try {
    await prisma.usuario.create({ data: { id: supId, empresaId, filialId: filial.id, nome: 'Supervisor Caixa Teste', email: supEmail, senhaHash: await hashSenha(senha), status: 'ATIVO' } as any });
    await prisma.permissao.create({ data: { usuarioId: supId, modulo: 'pdv', acao: 'supervisor', permitido: true } as any });
    await prisma.produto.create({ data: { id: produtoId, empresaId, nome: `AUT-${runId}`, sku: `AUT-${runId}`, custo: 2, precoVenda: 10, unidade: 'UN', status: 'ATIVO' } });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId, quantidade: 10, valorTotal: 20 } });

    const abertura = await req('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 100 });
    assert.equal(abertura.statusCode, 200, abertura.body);
    caixaId = abertura.json().id;

    // 1) SANGRIA
    assert.equal((await req('POST', '/pdv/caixa/movimentacoes', { tipo: 'SANGRIA', valor: 30 })).statusCode, 422, 'sem motivo');
    assert.equal((await req('POST', '/pdv/caixa/movimentacoes', { tipo: 'SANGRIA', valor: 30, motivo: 'Excesso de dinheiro' })).statusCode, 403, 'sem supervisor');
    const autSangria = await autorizar('SANGRIA');
    const sangria = await req('POST', '/pdv/caixa/movimentacoes', { tipo: 'SANGRIA', valor: 30, motivo: 'Excesso de dinheiro' }, { 'x-autorizacao-supervisor': autSangria });
    assert.equal(sangria.statusCode, 200, sangria.body);
    assert.equal(sangria.json().autorizadoPorNome, 'Supervisor Caixa Teste');
    assert.equal(sangria.json().saldoAntes, 100);
    assert.equal(sangria.json().saldoDepois, 70);
    assert.equal((await prisma.movimentacaoCaixa.findUniqueOrThrow({ where: { id: sangria.json().id } })).autorizadoPorId, supId);
    // Uso único: a mesma autorização não serve de novo.
    const reuso = await req('POST', '/pdv/caixa/movimentacoes', { tipo: 'SANGRIA', valor: 5, motivo: 'Excesso de dinheiro' }, { 'x-autorizacao-supervisor': autSangria });
    assert.equal(reuso.statusCode, 403, reuso.body);
    assert.match(reuso.body, /já foi usada/);
    // Suprimento continua livre.
    assert.equal((await req('POST', '/pdv/caixa/movimentacoes', { tipo: 'SUPRIMENTO', valor: 20 })).statusCode, 200);

    // 3) ITEM CANCELADO NO CARRINHO
    assert.equal((await req('POST', '/pdv/itens-cancelados', { itens: [{ produtoId, quantidade: 1 }], motivo: 'Lançado errado' })).statusCode, 403);
    const item = await req('POST', '/pdv/itens-cancelados', { itens: [{ produtoId, quantidade: 2 }], motivo: 'Lançado errado' }, { 'x-autorizacao-supervisor': await autorizar('CANCELAR_ITEM') });
    assert.equal(item.statusCode, 200, item.body);
    assert.equal(Number(item.json().itens[0].valorTotal), 20);

    // 4) CANCELAMENTO DE VENDA PAGA
    const venda = await req('POST', '/vendas', { filialId: filial.id, caixaId, formaPagamento: 'DINHEIRO', origem: 'PDV', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 10, valorRecebido: 10 }] });
    assert.equal(venda.statusCode, 201, venda.body);
    vendaId = venda.json().venda.id;
    assert.equal((await req('POST', `/vendas/${vendaId}/cancelar`, { motivo: 'Cliente desistiu da compra' })).statusCode, 403, 'sem supervisor');
    const cancel = await req('POST', `/vendas/${vendaId}/cancelar`, { motivo: 'Cliente desistiu da compra' }, { 'x-autorizacao-supervisor': await autorizar('CANCELAMENTO') });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(cancel.json().estorno.dinheiro, 10);
    assert.equal(cancel.json().autorizadoPor.nome, 'Supervisor Caixa Teste');

    // 2) FECHAMENTO + RELATÓRIO + HISTÓRICO
    // fundo 100 − sangria 30 + suprimento 20 + venda 10 − estorno 10 = 90
    const fechar = await req('POST', '/pdv/caixa/fechar', { valorContado: 88 });
    assert.equal(fechar.statusCode, 200, fechar.body);
    const rel = fechar.json().relatorio;
    assert.equal(rel.fundoTroco, 100);
    assert.equal(rel.sangrias, 30);
    assert.equal(rel.suprimentos, 20);
    assert.equal(rel.estornos, 10);
    assert.equal(rel.dinheiroEsperado, 90);
    assert.equal(rel.valorContado, 88);
    assert.equal(rel.diferenca, -2);
    assert.equal(rel.vendasCanceladas, 1);
    assert.deepEqual(rel.itensCancelados, { quantidade: 1, valor: 20 });
    const hist = await req('GET', '/pdv/caixa/historico');
    assert.equal(hist.statusCode, 200);
    assert.ok(hist.json().caixas.some((c: any) => c.id === caixaId));
    const relDepois = await req('GET', `/pdv/caixa/${caixaId}/relatorio`);
    assert.equal(relDepois.statusCode, 200);
    assert.equal(relDepois.json().diferenca, -2);
  } finally {
    if (vendaId) {
      await prisma.vendaPagamento.deleteMany({ where: { vendaId } });
      await prisma.financeiro.deleteMany({ where: { vendaId, empresaId } });
      await prisma.estoqueMovimentacao.deleteMany({ where: { documento: vendaId } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Venda', entidadeId: vendaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { vendaId } });
      await prisma.vendaItem.deleteMany({ where: { vendaId } });
      await prisma.idempotencyKey.deleteMany({ where: { vendaId } });
      await prisma.venda.deleteMany({ where: { id: vendaId } });
    }
    if (caixaId) {
      await prisma.itemCanceladoPdv.deleteMany({ where: { caixaId } });
      await prisma.auditoria.deleteMany({ where: { entidade: 'Caixa', entidadeId: caixaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.divergenciaCaixa.deleteMany({ where: { caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    if (!indicadorAnterior) await prisma.indicadorDiario.deleteMany({ where: { empresaId, filialId: filial.id, data: dataOp } });
    await prisma.idempotencyKey.deleteMany({ where: { empresaId, key: { startsWith: 'autsup:' }, operadorId: operador.id } });
    await prisma.auditoria.deleteMany({ where: { entidade: { in: ['AutorizacaoSupervisor', 'ItemCanceladoPdv', 'MovimentacaoCaixa'] }, usuarioId: operador.id } });
    await prisma.permissao.deleteMany({ where: { usuarioId: supId } });
    await prisma.usuario.deleteMany({ where: { id: supId } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId } });
    await prisma.estoque.deleteMany({ where: { produtoId } });
    await prisma.produto.deleteMany({ where: { id: produtoId, empresaId } });
    await app.close();
    await prisma.$disconnect();
  }
});

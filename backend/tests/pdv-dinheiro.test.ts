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
import { resumoDoCaixa } from '../src/modules/pdv/pdv.service.js';
import { hashSenha } from '../src/lib/auth.js';

/**
 * C1, C2 e C3 da análise do PDV: alçada de desconto, cancelamento restrito ao
 * próprio turno e fechamento com contagem obrigatória + DivergenciaCaixa.
 *
 * O operador do fixture tem pdv:criar/visualizar/editar e vendas:criar/visualizar,
 * mas NÃO vendas:editar nem permissões de desconto — é o perfil típico de caixa.
 */

test('resumo do caixa soma em centavos (sem erro de ponto flutuante)', () => {
  const resumo = resumoDoCaixa(
    { id: 'c', fundoTroco: '0.10', saldo: '0', abertoEm: new Date() },
    [{ formaPagamento: 'DINHEIRO', total: '0.20', status: 'FINALIZADA' }],
    [],
  );
  assert.equal(resumo.dinheiroEsperado, 0.3);
  assert.equal(resumo.totalVendas, 0.2);
});

test('PDV: desconto, cancelamento e fechamento com divergência', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operador = await prisma.usuario.findUnique({ where: { id: 'pdv-audit-test-operador' } });
  assert.ok(operador, 'O fixture isolado do operador precisa existir.');
  const filial = await prisma.filial.findFirst({ where: { id: 'pdv-audit-test-filial', empresaId }, select: { id: true } });
  assert.ok(filial, 'O fixture isolado da filial precisa existir.');
  const temVendasEditar = await prisma.permissao.findFirst({ where: { usuarioId: operador.id, modulo: 'vendas', acao: 'editar', permitido: true } });
  assert.equal(temVendasEditar, null, 'O fixture deve ser um operador só de PDV.');

  const runId = randomUUID();
  const produtoId = randomUUID();
  const vendaAlheiaId = randomUUID();
  const caixas: string[] = [];
  const supervisorId = `pdv-sup-${runId}`;
  const supervisorEmail = `pdv-sup-${runId}@nexus.test`;

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
    await prisma.produto.create({
      data: { id: produtoId, empresaId, nome: `PDV-DIN-${runId}`, sku: `PDV-DIN-${runId}`, custo: 4, precoVenda: 100, unidade: 'UN', status: 'ATIVO' },
    });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId, quantidade: 5, valorTotal: 20 } });

    const abertura = await request('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 20 });
    assert.equal(abertura.statusCode, 200, abertura.body);
    caixas.push(abertura.json().id);

    // C1 — pdv:editar não dá mais alçada de supervisor/gerente.
    const comDesconto = await request('POST', '/vendas', {
      filialId: filial.id, caixaId: caixas[0], formaPagamento: 'DINHEIRO', desconto: 15,
      itens: [{ produtoId, quantidade: 1, desconto: 0 }],
    });
    assert.equal(comDesconto.statusCode, 403, comDesconto.body);
    assert.match(comDesconto.body, /supervisor/);
    assert.equal(await prisma.venda.count({ where: { caixaId: caixas[0] } }), 0);

    // I1 — autorização do supervisor no balcão.
    await prisma.usuario.create({
      data: { id: supervisorId, empresaId, filialId: filial.id, nome: 'Supervisor teste PDV', email: supervisorEmail, senhaHash: await hashSenha('senha-teste-supervisor'), status: 'ATIVO' } as any,
    });
    await prisma.permissao.create({ data: { usuarioId: supervisorId, modulo: 'vendas', acao: 'desconto_supervisor', permitido: true } as any });
    const senhaErrada = await request('POST', '/pdv/autorizacoes', { email: supervisorEmail, senha: 'errada', acao: 'DESCONTO' });
    assert.equal(senhaErrada.statusCode, 401, senhaErrada.body);
    const semPermissaoCancel = await request('POST', '/pdv/autorizacoes', { email: supervisorEmail, senha: 'senha-teste-supervisor', acao: 'CANCELAMENTO' });
    assert.equal(semPermissaoCancel.statusCode, 403, semPermissaoCancel.body);
    const autorizacao = await request('POST', '/pdv/autorizacoes', { email: supervisorEmail, senha: 'senha-teste-supervisor', acao: 'DESCONTO' });
    assert.equal(autorizacao.statusCode, 200, autorizacao.body);
    const tokenSupervisor = autorizacao.json().autorizacao as string;
    // O token de autorização NÃO serve como sessão.
    const comoSessao = await app.inject({ method: 'GET', url: '/pdv/caixa/atual', headers: { authorization: `Bearer ${tokenSupervisor}` } });
    assert.equal(comoSessao.statusCode, 401, comoSessao.body);
    // Com a autorização a alçada passa; a venda para depois, na soma dos
    // pagamentos (de propósito, para não gravar venda no teste).
    const autorizada = await app.inject({
      method: 'POST', url: '/vendas',
      headers: { authorization: `Bearer ${token}`, 'x-autorizacao-supervisor': tokenSupervisor },
      payload: { filialId: filial.id, caixaId: caixas[0], formaPagamento: 'DINHEIRO', desconto: 15, itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 1 }] },
    });
    assert.equal(autorizada.statusCode, 422, autorizada.body);
    assert.match(autorizada.body, /Soma dos pagamentos/);
    // 40% passa da alçada de supervisor: a autorização dele não basta.
    const acimaDaAlcada = await app.inject({
      method: 'POST', url: '/vendas',
      headers: { authorization: `Bearer ${token}`, 'x-autorizacao-supervisor': tokenSupervisor },
      payload: { filialId: filial.id, caixaId: caixas[0], formaPagamento: 'DINHEIRO', desconto: 40, itens: [{ produtoId, quantidade: 1, desconto: 0 }] },
    });
    assert.equal(acimaDaAlcada.statusCode, 403, acimaDaAlcada.body);

    // C2 — venda de fora do turno do operador: recusada.
    await prisma.venda.create({
      data: { id: vendaAlheiaId, empresaId, filialId: filial.id, formaPagamento: 'DINHEIRO', subtotal: 10, desconto: 0, total: 10, status: 'FINALIZADA', origem: 'MANUAL' },
    });
    const semMotivo = await request('POST', `/vendas/${vendaAlheiaId}/cancelar`, {});
    assert.equal(semMotivo.statusCode, 422, semMotivo.body);
    const motivoCurto = await request('POST', `/vendas/${vendaAlheiaId}/cancelar`, { motivo: 'erro' });
    assert.equal(motivoCurto.statusCode, 422, motivoCurto.body);
    const alheia = await request('POST', `/vendas/${vendaAlheiaId}/cancelar`, { motivo: 'Cliente desistiu da compra' });
    assert.equal(alheia.statusCode, 403, alheia.body);
    assert.equal((await prisma.venda.findUniqueOrThrow({ where: { id: vendaAlheiaId } })).status, 'FINALIZADA');

    // C3 — contagem obrigatória.
    const semContagem = await request('POST', '/pdv/caixa/fechar', {});
    assert.ok([400, 422].includes(semContagem.statusCode), semContagem.body);

    // Falta de R$ 10 (acima do limite de R$ 5) sem justificativa: recusado.
    const semJustificativa = await request('POST', '/pdv/caixa/fechar', { valorContado: 10 });
    assert.equal(semJustificativa.statusCode, 422, semJustificativa.body);
    assert.equal((await prisma.caixa.findUniqueOrThrow({ where: { id: caixas[0] } })).status, 'ABERTO');

    const comJustificativa = await request('POST', '/pdv/caixa/fechar', { valorContado: 10, observacao: 'Troco dado a mais em uma venda' });
    assert.equal(comJustificativa.statusCode, 200, comJustificativa.body);
    assert.equal(Number(comJustificativa.json().caixa.diferenca), -10);
    const divergencias = await prisma.divergenciaCaixa.findMany({ where: { caixaId: caixas[0] } });
    assert.equal(divergencias.length, 1);
    assert.equal(divergencias[0].status, 'ABERTA');
    assert.equal(divergencias[0].tipo, 'FALTA_NO_FECHAMENTO');
    assert.equal(Number(divergencias[0].diferenca), -10);
    assert.equal(divergencias[0].operadorId, operador.id);

    // Diferença dentro do limite: fecha sem justificativa e sem divergência.
    const reabertura = await request('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 20 });
    assert.equal(reabertura.statusCode, 200, reabertura.body);
    caixas.push(reabertura.json().id);
    const pequena = await request('POST', '/pdv/caixa/fechar', { valorContado: 22.5 });
    assert.equal(pequena.statusCode, 200, pequena.body);
    assert.equal(Number(pequena.json().caixa.diferenca), 2.5);
    assert.equal(pequena.json().divergencia, null);
    assert.equal(await prisma.divergenciaCaixa.count({ where: { caixaId: caixas[1] } }), 0);
  } finally {
    await prisma.venda.deleteMany({ where: { id: vendaAlheiaId } });
    await prisma.auditoria.deleteMany({ where: { entidade: 'AutorizacaoSupervisor', entidadeId: supervisorId } });
    await prisma.permissao.deleteMany({ where: { usuarioId: supervisorId } });
    await prisma.usuario.deleteMany({ where: { id: supervisorId } });
    for (const caixaId of caixas) {
      await prisma.auditoria.deleteMany({ where: { entidade: 'Caixa', entidadeId: caixaId } });
      await prisma.divergenciaCaixa.deleteMany({ where: { caixaId } });
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    await prisma.estoque.deleteMany({ where: { produtoId } });
    await prisma.produto.deleteMany({ where: { id: produtoId } });
    await app.close();
    await prisma.$disconnect();
  }
});

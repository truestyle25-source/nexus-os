import 'dotenv/config';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { pdvRoutes } from '../src/modules/pdv/pdv.routes.js';
import { vendasRoutes } from '../src/modules/vendas/vendas.routes.js';
import { fluxoCaixaRoutes } from '../src/modules/fluxo-caixa/fluxo-caixa.routes.js';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { dataOperacionalDate } from '../src/lib/fuso.js';
import { ErroDeNegocio } from '../src/lib/erros.js';

/**
 * Fluxo de Caixa ponta a ponta no banco real:
 * turnos → fechamento → conferência cega → aprovação por níveis →
 * conciliação bancária (CSV) → cartões; e prova de que vendas e
 * movimentações originais não mudam.
 */
test('Fluxo de Caixa: conferência cega, aprovações, turnos e conciliações', {
  skip: process.env.RUN_PDV_DB_TEST !== '1',
}, async () => {
  const empresaId = 'pdv-audit-test-empresa';
  const operador = await prisma.usuario.findUniqueOrThrow({ where: { id: 'pdv-audit-test-operador' } });
  const filial = await prisma.filial.findFirstOrThrow({ where: { id: 'pdv-audit-test-filial', empresaId }, select: { id: true, fusoHorario: true } });
  const run = randomUUID().slice(0, 8);
  const produtoId = randomUUID();
  const outraEmp = `fx-emp-${run}`, outroId = `fx-out-${run}`;
  const supId = `fx-sup-${run}`, gesId = `fx-ges-${run}`, finId = `fx-fin-${run}`;
  const vendaIds: string[] = [];
  let caixaId: string | null = null;
  let contaId: string | null = null;
  const finIds: string[] = [];
  const [{ agora }] = await prisma.$queryRaw<Array<{ agora: Date }>>`SELECT CURRENT_TIMESTAMP AS "agora"`;
  const dataOp = dataOperacionalDate(agora, filial.fusoHorario);
  const indicadorAnterior = await prisma.indicadorDiario.findUnique({ where: { empresaId_filialId_data: { empresaId, filialId: filial.id, data: dataOp } }, select: { id: true } });

  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'secret' });
  // Mesma tradução do server.ts: ZodError → 400, ErroDeNegocio → seu status.
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.name === 'ZodError') return reply.status(400).send({ error: 'Dados inválidos.', detalhes: error.issues });
    if (error instanceof ErroDeNegocio) return reply.status(error.status).send({ error: error.message });
    return reply.status(error?.statusCode ?? 500).send({ error: error?.message });
  });
  await registerAuthentication(app);
  await app.register(vendasRoutes);
  await app.register(pdvRoutes);
  await app.register(fluxoCaixaRoutes);
  await app.ready();
  const tok = (id: string, emp = empresaId) => app.jwt.sign({ id, empresaId: emp, email: `${id}@nexus.test` }, { expiresIn: '1h' });
  const como = (id: string, emp?: string) => (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${tok(id, emp)}` }, payload: payload as any });
  const op = como(operador.id), sup = como(supId), ges = como(gesId), fin = como(finId);

  try {
    for (const [id, nome, perms] of [
      [supId, 'Supervisor Fluxo', [['pdv', 'visualizar'], ['pdv', 'editar'], ['pdv', 'supervisor']]],
      [gesId, 'Gestor Fluxo', [['pdv', 'visualizar'], ['pdv', 'administrar'], ['financeiro', 'visualizar']]],
      [finId, 'Financeiro Fluxo', [['financeiro', 'visualizar'], ['financeiro', 'editar']]],
    ] as const) {
      await prisma.usuario.create({ data: { id, empresaId, filialId: filial.id, nome, email: `${id}@nexus.test`, senhaHash: 'x', status: 'ATIVO' } as any });
      await prisma.permissao.createMany({ data: perms.map(([modulo, acao]) => ({ usuarioId: id, modulo, acao, permitido: true })) as any });
    }
    await prisma.produto.create({ data: { id: produtoId, empresaId, nome: `FX-${run}`, sku: `FX-${run}`, custo: 1, precoVenda: 10, unidade: 'UN', status: 'ATIVO' } });
    await prisma.estoque.create({ data: { empresaId, filialId: filial.id, produtoId, quantidade: 100, valorTotal: 100 } });

    // Abertura + vendas: dinheiro 10, débito 20, crédito 30; suprimento 20.
    const ab = await op('POST', '/pdv/caixa/abrir', { filialId: filial.id, fundoTroco: 100 });
    assert.equal(ab.statusCode, 200, ab.body);
    caixaId = ab.json().id as string;
    const vd = await op('POST', '/vendas', { filialId: filial.id, caixaId, formaPagamento: 'DINHEIRO', origem: 'PDV', itens: [{ produtoId, quantidade: 1, desconto: 0 }], pagamentos: [{ forma: 'DINHEIRO', valor: 10, valorRecebido: 10 }] });
    assert.equal(vd.statusCode, 201, vd.body);
    vendaIds.push(vd.json().venda.id);
    // O PDV recusa cartão sem provedor TEF (503). Para testar a conferência e
    // os cartões, as vendas em cartão do turno são gravadas direto no banco.
    for (const [forma, valor] of [['CARTAO_DEBITO', 20], ['CARTAO_CREDITO', 30]] as const) {
      const vc = await prisma.venda.create({ data: { empresaId, filialId: filial.id, caixaId, subtotal: valor, total: valor, status: 'FINALIZADA', formaPagamento: forma, pagamentos: { create: [{ empresaId, forma, valor }] } } as any });
      vendaIds.push(vc.id);
    }
    assert.equal((await op('POST', '/pdv/caixa/movimentacoes', { tipo: 'SUPRIMENTO', valor: 20 })).statusCode, 200);

    // TURNOS: um ativo por caixa; passagem conferida → novo turno de quem recebe.
    const t1 = await op('POST', '/fluxo/turnos', { caixaId });
    assert.equal(t1.statusCode, 200, t1.body);
    assert.equal((await op('POST', '/fluxo/turnos', { caixaId })).statusCode, 409);
    assert.equal((await op('POST', '/fluxo/turnos', { caixaId, operadorId: supId })).statusCode, 403, 'operador não abre turno para outro');
    const p1 = await op('POST', `/fluxo/turnos/${t1.json().id}/passagem`, { valorConferido: 130, recebidoPorId: supId });
    assert.equal(p1.statusCode, 200, p1.body);
    assert.equal(p1.json().esperado, 130); // fundo 100 + venda 10 + suprimento 20
    assert.equal(p1.json().diferenca, 0);
    assert.equal(p1.json().aprovacao, null);
    const p2 = await sup('POST', `/fluxo/turnos/${p1.json().novoTurno.id}/passagem`, { valorConferido: 128 });
    assert.equal(p2.json().diferenca, -2);
    assert.equal(p2.json().aprovacao.nivelExigido, 'SUPERVISOR');
    assert.equal((await sup('POST', `/fluxo/turnos/${p1.json().novoTurno.id}/passagem`, { valorConferido: 128 })).statusCode, 409);

    // Fechamento no PDV; foto do original para provar que a conferência não altera nada.
    assert.equal((await op('POST', '/pdv/caixa/fechar', { valorContado: 130 })).statusCode, 200);
    const fotoAntes = JSON.stringify([
      await prisma.venda.findMany({ where: { caixaId }, orderBy: { id: 'asc' }, select: { id: true, total: true, status: true, updatedAt: true } }),
      await prisma.movimentacaoCaixa.findMany({ where: { caixaId }, orderBy: { id: 'asc' } }),
    ]);

    // CONFERÊNCIA CEGA: operador não vê o esperado antes de registrar.
    const cegoAntes = await op('GET', `/fluxo/caixas/${caixaId}`);
    assert.equal(cegoAntes.statusCode, 200, cegoAntes.body);
    assert.equal(cegoAntes.json().ocultarEsperado, true);
    assert.equal(cegoAntes.json().resumo, null);
    assert.equal(cegoAntes.json().esperadoPorForma, null);
    assert.equal((await op('GET', '/fluxo/caixas')).statusCode, 403, 'operador não vê a visão geral');
    const conf = await op('POST', `/fluxo/caixas/${caixaId}/conferencias`, { itens: [{ forma: 'DINHEIRO', valor: 125 }, { forma: 'CARTAO_DEBITO', valor: 20 }, { forma: 'CARTAO_CREDITO', valor: 30 }] });
    assert.equal(conf.statusCode, 200, conf.body);
    assert.equal(conf.json().diferenca, -5);
    assert.deepEqual(conf.json().itens.find((i: any) => i.forma === 'DINHEIRO'), { forma: 'DINHEIRO', esperado: 130, contado: 125, diferenca: -5 });
    const ap1 = conf.json().aprovacao;
    assert.equal(ap1.nivelExigido, 'SUPERVISOR');
    assert.equal((await op('POST', `/fluxo/caixas/${caixaId}/conferencias`, { itens: [{ forma: 'DINHEIRO', valor: 130 }] })).statusCode, 409, 'não refaz');
    assert.equal((await op('GET', `/fluxo/caixas/${caixaId}`)).json().ocultarEsperado, false, 'depois de conferir, vê');
    assert.equal((await prisma.conferenciaCaixa.findFirstOrThrow({ where: { caixaId, responsavelId: operador.id } })).cega, true);

    // APROVAÇÃO nível Supervisor.
    assert.equal((await op('POST', `/fluxo/aprovacoes/${ap1.id}/decidir`, { decisao: 'AUTORIZAR', justificativa: 'quero' })).statusCode, 403);
    assert.equal((await sup('POST', `/fluxo/aprovacoes/${ap1.id}/decidir`, { decisao: 'AUTORIZAR', justificativa: 'ok' })).statusCode, 400, 'justificativa curta');
    const d1 = await sup('POST', `/fluxo/aprovacoes/${ap1.id}/decidir`, { decisao: 'AUTORIZAR', justificativa: 'Troco conferido com o operador' });
    assert.equal(d1.statusCode, 200, d1.body);
    assert.equal(d1.json().status, 'AUTORIZADA');
    assert.equal((await ges('POST', `/fluxo/aprovacoes/${ap1.id}/decidir`, { decisao: 'REJEITAR', justificativa: 'Tentando mudar' })).statusCode, 409, 'decisão final imutável');

    // APROVAÇÃO nível Gestor (exceção > R$ 50): supervisor autoriza, gestor aprova.
    const conf2 = await sup('POST', `/fluxo/caixas/${caixaId}/conferencias`, { itens: [{ forma: 'DINHEIRO', valor: 30 }, { forma: 'CARTAO_DEBITO', valor: 20 }, { forma: 'CARTAO_CREDITO', valor: 30 }], justificativa: 'Recontagem' });
    const ap2 = conf2.json().aprovacao;
    assert.equal(ap2.nivelExigido, 'GESTOR');
    assert.equal((await sup('POST', `/fluxo/aprovacoes/${ap2.id}/decidir`, { decisao: 'AUTORIZAR', justificativa: 'Eu mesmo pedi' })).statusCode, 403, 'não decide a própria');
    const d2 = await ges('POST', `/fluxo/aprovacoes/${ap2.id}/decidir`, { decisao: 'APROVAR', justificativa: 'Exceção analisada pelo gestor' });
    assert.equal(d2.json().status, 'APROVADA');
    assert.equal(await prisma.decisaoAprovacaoCaixa.count({ where: { aprovacaoId: { in: [ap1.id, ap2.id] } } }), 2);

    // LIMITE configurável: só o gestor muda, com motivo, auditado; vale para as próximas.
    const L = '/fluxo/configuracao/limite-gestor';
    assert.equal((await sup('PUT', L, { valor: 150, justificativa: 'Fim de ano' })).statusCode, 403, 'supervisor não muda');
    assert.equal((await op('PUT', L, { valor: 150, justificativa: 'Fim de ano' })).statusCode, 403, 'operador não muda');
    assert.equal((await ges('PUT', L, { valor: 150, justificativa: 'ok' })).statusCode, 400, 'motivo obrigatório');
    assert.equal((await ges('PUT', L, { valor: -1, justificativa: 'Fim de ano' })).statusCode, 400, 'negativo não');
    const lim = await ges('PUT', L, { valor: 150, justificativa: 'Movimento maior no fim de ano' });
    assert.equal(lim.statusCode, 200, lim.body);
    assert.equal(lim.json().limiteGestor, 150);
    assert.equal((await sup('GET', '/fluxo/aprovacoes')).json().limiteGestor, 150);
    assert.equal(ap2.nivelExigido, 'GESTOR');
    assert.equal((await prisma.aprovacaoCaixa.findUniqueOrThrow({ where: { id: ap2.id } })).nivelExigido, 'GESTOR', 'a que já existia não muda');
    const conf3 = await fin('POST', `/fluxo/caixas/${caixaId}/conferencias`, { itens: [{ forma: 'DINHEIRO', valor: 30 }, { forma: 'CARTAO_DEBITO', valor: 20 }, { forma: 'CARTAO_CREDITO', valor: 30 }], justificativa: 'Terceira contagem' });
    assert.equal(conf3.statusCode, 200, conf3.body);
    assert.equal(conf3.json().aprovacao.nivelExigido, 'SUPERVISOR', 'diferença de 100 fica abaixo do novo limite');
    const audLim = await prisma.auditoria.findFirstOrThrow({ where: { empresaId, entidade: 'ConfiguracaoFluxoCaixa' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audLim.usuarioId, gesId);
    assert.equal(audLim.contexto, 'Movimento maior no fim de ano');

    // Nada original mudou.
    const fotoDepois = JSON.stringify([
      await prisma.venda.findMany({ where: { caixaId }, orderBy: { id: 'asc' }, select: { id: true, total: true, status: true, updatedAt: true } }),
      await prisma.movimentacaoCaixa.findMany({ where: { caixaId }, orderBy: { id: 'asc' } }),
    ]);
    assert.equal(fotoDepois, fotoAntes);

    // VISÃO GERAL e HISTÓRICO.
    const geral = await ges('GET', '/fluxo/caixas');
    assert.equal(geral.statusCode, 200, geral.body);
    const linha = geral.json().caixas.find((c: any) => c.id === caixaId);
    assert.equal(linha.totalVendas, 60);
    assert.equal(linha.conferido, true);
    const hist = await ges('GET', `/fluxo/historico?caixaId=${caixaId}`);
    const ent = new Set(hist.json().registros.map((r: any) => r.entidade));
    for (const e of ['ConferenciaCaixa', 'AprovacaoCaixa', 'TurnoCaixa', 'Caixa']) assert.ok(ent.has(e), `histórico sem ${e}`);

    // ISOLAMENTO: gestor de OUTRA empresa não enxerga este caixa nem as aprovações.
    await prisma.empresa.create({ data: { id: outraEmp, nome: 'Outra empresa FX' } as any });
    await prisma.usuario.create({ data: { id: outroId, empresaId: outraEmp, nome: 'Gestor de fora', email: `${outroId}@nexus.test`, senhaHash: 'x', status: 'ATIVO' } as any });
    await prisma.permissao.createMany({ data: [['pdv', 'administrar'], ['financeiro', 'visualizar'], ['financeiro', 'editar']].map(([modulo, acao]) => ({ usuarioId: outroId, modulo, acao, permitido: true })) as any });
    const fora = como(outroId, outraEmp);
    assert.equal((await fora('GET', '/fluxo/aprovacoes')).json().limiteGestor, 50, 'limite de outra empresa não é afetado');
    assert.equal((await fora('GET', `/fluxo/caixas/${caixaId}`)).statusCode, 404);
    assert.ok(!(await fora('GET', '/fluxo/caixas')).json().caixas.some((c: any) => c.id === caixaId));
    assert.equal((await fora('POST', `/fluxo/aprovacoes/${ap1.id}/decidir`, { decisao: 'REJEITAR', justificativa: 'De outra empresa' })).statusCode, 404);
    // Token forjado com a empresa errada: o servidor usa a empresa do banco.
    assert.ok(!(await como(outroId, empresaId)('GET', '/fluxo/caixas')).json().caixas.some((c: any) => c.id === caixaId));

    // CONCILIAÇÃO BANCÁRIA (CSV).
    assert.equal((await op('GET', '/fluxo/contas-bancarias')).statusCode, 403);
    const conta = await fin('POST', '/fluxo/contas-bancarias', { nome: `Conta FX ${run}`, banco: 'Banco Teste' });
    contaId = conta.json().id;
    const hoje = new Date();
    const dd = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
    const csv = `data;descricao;valor\n${dd};RECEBIMENTO A;50,00\n${dd};RECEBIMENTO B;45,00\n`;
    const imp = await fin('POST', `/fluxo/contas-bancarias/${contaId}/extrato`, { arquivoNome: 'extrato.csv', conteudo: csv });
    assert.equal(imp.statusCode, 200, imp.body);
    assert.equal(imp.json().linhasNovas, 2);
    assert.equal((await fin('POST', `/fluxo/contas-bancarias/${contaId}/extrato`, { arquivoNome: 'extrato.csv', conteudo: csv })).json().linhasRepetidas, 2);
    for (const desc of ['A', 'B']) {
      const f = await prisma.financeiro.create({ data: { empresaId, tipo: 'RECEITA', categoria: 'vendas', descricao: `FX ${run} ${desc}`, valor: 50, status: 'PAGO', pagoEm: new Date() } as any });
      finIds.push(f.id);
    }
    const tela = await fin('GET', `/fluxo/contas-bancarias/${contaId}/conciliacao`);
    assert.equal(tela.statusCode, 200, tela.body);
    const [la, lb] = tela.json().extrato;
    const v = await fin('POST', '/fluxo/conciliacoes', { extratoLinhaId: la.id, financeiroId: finIds[0] });
    assert.equal(v.json().conciliacao.tipo, 'VINCULO');
    assert.equal((await fin('POST', '/fluxo/conciliacoes', { extratoLinhaId: la.id, financeiroId: finIds[1] })).statusCode, 409);
    assert.equal((await fin('POST', '/fluxo/conciliacoes', { extratoLinhaId: lb.id, financeiroId: finIds[1] })).statusCode, 422, 'ajuste sem justificativa');
    const aj = await fin('POST', '/fluxo/conciliacoes', { extratoLinhaId: lb.id, financeiroId: finIds[1], justificativa: 'Banco descontou tarifa de 5 reais' });
    assert.equal(aj.json().conciliacao.tipo, 'AJUSTE');
    assert.equal(aj.json().aprovacao.tipo, 'AJUSTE_CONCILIACAO_BANCARIA');
    const des = await fin('POST', `/fluxo/conciliacoes/${v.json().conciliacao.id}/desfazer`, { justificativa: 'Vinculado errado' });
    assert.equal(des.statusCode, 200);
    assert.equal((await fin('POST', `/fluxo/conciliacoes/${v.json().conciliacao.id}/desfazer`, { justificativa: 'De novo' })).statusCode, 404);
    assert.equal(await prisma.conciliacaoBancaria.count({ where: { contaId } }), 2, 'desfazer não apaga');

    // CARTÕES.
    const semAdq = await fin('GET', '/fluxo/cartoes');
    assert.equal(semAdq.statusCode, 200, semAdq.body);
    await fin('POST', '/fluxo/adquirentes', { nome: `Adq ${run}`, taxaDebito: 1, taxaCredito: 2, prazoDebitoDias: 1, prazoCreditoDias: 30, padrao: true });
    const cart = await fin('GET', '/fluxo/cartoes');
    const minha = cart.json().linhas.find((l: any) => l.vendaId === vendaIds[2]);
    assert.equal(minha.bruto, 30);
    assert.equal(minha.taxa, 0.6);
    assert.equal(minha.liquido, 29.4);

    // DOCUMENTOS FISCAIS: bloqueado de forma explícita, sem dado inventado.
    assert.equal((await ges('GET', '/fluxo/documentos-fiscais')).json().disponivel, false);
  } finally {
    await prisma.empresa.update({ where: { id: empresaId }, data: { limiteAprovacaoGestorCaixa: 50 } }).catch(() => {});
    await prisma.auditoria.deleteMany({ where: { empresaId, entidade: 'ConfiguracaoFluxoCaixa' } }).catch(() => {});
    const aprovIds = (await prisma.aprovacaoCaixa.findMany({ where: { OR: [{ caixaId: caixaId ?? '-' }, { solicitanteId: finId }] }, select: { id: true } })).map((a) => a.id);
    await prisma.decisaoAprovacaoCaixa.deleteMany({ where: { aprovacaoId: { in: aprovIds } } });
    await prisma.aprovacaoCaixa.deleteMany({ where: { id: { in: aprovIds } } });
    if (contaId) {
      await prisma.conciliacaoBancaria.deleteMany({ where: { contaId } });
      await prisma.extratoLinha.deleteMany({ where: { contaId } });
      await prisma.extratoImportacao.deleteMany({ where: { contaId } });
      await prisma.contaBancaria.deleteMany({ where: { id: contaId } });
    }
    await prisma.adquirente.deleteMany({ where: { empresaId, nome: `Adq ${run}` } });
    await prisma.financeiro.deleteMany({ where: { id: { in: finIds } } });
    if (caixaId) {
      await prisma.conferenciaCaixaItem.deleteMany({ where: { conferencia: { caixaId } } });
      await prisma.conferenciaCaixa.deleteMany({ where: { caixaId } });
      await prisma.turnoCaixa.deleteMany({ where: { caixaId } });
    }
    for (const vendaId of vendaIds) {
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
      await prisma.movimentacaoCaixa.deleteMany({ where: { caixaId } });
      await prisma.divergenciaCaixa.deleteMany({ where: { caixaId } });
      await prisma.caixa.deleteMany({ where: { id: caixaId } });
    }
    await prisma.auditoria.deleteMany({ where: { usuarioId: { in: [operador.id, supId, gesId, finId] }, entidade: { in: ['Caixa', 'MovimentacaoCaixa', 'ConferenciaCaixa', 'AprovacaoCaixa', 'TurnoCaixa', 'ContaBancaria', 'ExtratoImportacao', 'ConciliacaoBancaria', 'Adquirente'] } } });
    if (!indicadorAnterior) await prisma.indicadorDiario.deleteMany({ where: { empresaId, filialId: filial.id, data: dataOp } });
    await prisma.permissao.deleteMany({ where: { usuarioId: { in: [supId, gesId, finId, outroId] } } });
    await prisma.usuario.deleteMany({ where: { id: { in: [supId, gesId, finId, outroId] } } });
    await prisma.empresa.deleteMany({ where: { id: outraEmp } });
    await prisma.estoqueMovimentacao.deleteMany({ where: { produtoId } });
    await prisma.estoque.deleteMany({ where: { produtoId } });
    await prisma.produto.deleteMany({ where: { id: produtoId, empresaId } });
    await app.close();
    await prisma.$disconnect();
  }
});

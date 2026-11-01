import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contarCanceladasEstornos,
  fimDoDia,
  fimDoDiaUTC,
  inicioDoDia,
  inicioDoDiaUTC,
  montarWhereVendas,
  normalizarContagemPorStatus,
  variacaoPercentual,
} from '../src/modules/vendas/vendas.filtros.js';

// Cobre a regra que sustenta os filtros da aba Vendas (período, status, forma
// de pagamento, filial, vendedor e busca). É a única parte desse fluxo que
// pode ser testada sem banco: o handler em si depende do Prisma Client, e
// teste de integração ainda não existe no projeto (DEBITO-TECNICO.md).

test('montarWhereVendas sempre isola a empresa, mesmo sem nenhum filtro', () => {
  assert.deepEqual(montarWhereVendas('empresa-1', {}), { empresaId: 'empresa-1' });
});

test('montarWhereVendas ignora filtro vazio (string vazia não pode virar cláusula)', () => {
  const where = montarWhereVendas('empresa-1', {
    filialId: '',
    clienteId: '',
    funcionarioId: '',
    busca: '   ',
    de: '',
    ate: '',
  });
  assert.deepEqual(where, { empresaId: 'empresa-1' });
});

test('montarWhereVendas aplica status, forma de pagamento, filial, cliente e vendedor', () => {
  const where = montarWhereVendas('empresa-1', {
    filialId: 'filial-9',
    clienteId: 'cliente-3',
    funcionarioId: 'user-7',
    status: 'CANCELADA',
    formaPagamento: 'PIX',
  });
  assert.equal(where.empresaId, 'empresa-1');
  assert.equal(where.filialId, 'filial-9');
  assert.equal(where.clienteId, 'cliente-3');
  assert.equal(where.funcionarioId, 'user-7');
  assert.equal(where.status, 'CANCELADA');
  assert.equal(where.formaPagamento, 'PIX');
});

test('montarWhereVendas filtra dia operacional como DATE UTC, sem depender do fuso do processo', () => {
  const where = montarWhereVendas('empresa-1', { de: '2026-09-01', ate: '2026-09-30' }) as any;
  assert.equal(where.dataOperacional.gte.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(where.dataOperacional.lte.toISOString(), '2026-09-30T23:59:59.999Z');
  assert.equal(where.createdAt, undefined);
});

test('montarWhereVendas aceita só início ou só fim do período', () => {
  const soInicio = montarWhereVendas('empresa-1', { de: '2026-09-01' }) as any;
  assert.ok(soInicio.dataOperacional.gte);
  assert.equal(soInicio.dataOperacional.lte, undefined);

  const soFim = montarWhereVendas('empresa-1', { ate: '2026-09-30' }) as any;
  assert.equal(soFim.dataOperacional.gte, undefined);
  assert.ok(soFim.dataOperacional.lte);
});

test('montarWhereVendas ignora data inválida em vez de gerar cláusula vazia', () => {
  const where = montarWhereVendas('empresa-1', { de: 'ontem' });
  assert.equal(where.dataOperacional, undefined);
});

test('montarWhereVendas monta a busca livre em ID da venda ou nome do cliente', () => {
  const where = montarWhereVendas('empresa-1', { busca: '  ana  ' }) as any;
  assert.deepEqual(where.OR, [
    { id: { contains: 'ana' } },
    { cliente: { nome: { contains: 'ana', mode: 'insensitive' } } },
  ]);
});

test('inicioDoDia/fimDoDia devolvem undefined para entrada vazia ou inválida', () => {
  assert.equal(inicioDoDia(undefined), undefined);
  assert.equal(fimDoDia(''), undefined);
  assert.equal(fimDoDia('2026-13-45'), undefined);
});

test('inicioDoDiaUTC/fimDoDiaUTC sempre usam a fronteira UTC do dia e não o fuso local do navegador', () => {
  const inicio = inicioDoDiaUTC('2026-10-02');
  const fim = fimDoDiaUTC('2026-10-02');

  assert.ok(inicio);
  assert.ok(fim);
  assert.equal(inicio.toISOString(), '2026-10-02T00:00:00.000Z');
  assert.equal(fim.toISOString(), '2026-10-02T23:59:59.999Z');
  assert.equal(inicioDoDiaUTC(undefined), undefined);
  assert.equal(fimDoDiaUTC(''), undefined);
});

test('normalizarContagemPorStatus devolve as 5 chaves do enum, zeradas quando ausentes', () => {
  const contagem = normalizarContagemPorStatus([
    { status: 'FINALIZADA', _count: { _all: 12 } },
    { status: 'CANCELADA', _count: { _all: 2 } },
  ]);
  assert.deepEqual(contagem, {
    ABERTA: 0,
    FINALIZADA: 12,
    CANCELADA: 2,
    DEVOLVIDA: 0,
    ESTORNADA: 0,
  });
});

test('normalizarContagemPorStatus aceita contagem numérica e ignora status fora do enum', () => {
  const contagem = normalizarContagemPorStatus([
    { status: 'ABERTA', _count: 3 },
    { status: 'INVENTADO', _count: 99 },
  ]);
  assert.equal(contagem.ABERTA, 3);
  assert.equal(Object.keys(contagem).length, 5);
});

test('contarCanceladasEstornos soma canceladas, estornadas e devolvidas', () => {
  const total = contarCanceladasEstornos({
    ABERTA: 4,
    FINALIZADA: 40,
    CANCELADA: 2,
    ESTORNADA: 1,
    DEVOLVIDA: 3,
  });
  assert.equal(total, 6);
  assert.equal(contarCanceladasEstornos({}), 0);
});

test('variacaoPercentual não inventa base quando o período anterior é zero', () => {
  assert.equal(variacaoPercentual(150, 0), null);
  assert.equal(variacaoPercentual(150, 100), 50);
  assert.equal(variacaoPercentual(50, 100), -50);
});

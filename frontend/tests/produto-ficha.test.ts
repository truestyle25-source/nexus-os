import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPrecificacao, lerNumero, precoPorMargemLiquida, precoPorMarkup } from '../lib/produto-ficha';
import { eanValido, modulosEan, svgEan } from '../lib/codigo-barras-svg';
import { formDaFicha, payloadAlterado } from '../components/produto/formulario';
import { novoBanco, destruirBanco } from './helpers-idb';
import { sincronizarCatalogo, resolverBipagem } from '../lib/pdv/catalogo';

test('precificação da tela = precificação do servidor (markup x margem)', () => {
  const r = calcularPrecificacao({ custo: 10, precoVenda: 20, impostosPercentual: 10, comissaoPercentual: 5, despesasPercentual: 5, descontoMaximoPercentual: 10 });
  assert.equal(r.markupPercentual, 100);
  assert.equal(r.margemBrutaPercentual, 50);
  assert.equal(r.margemLiquidaPercentual, 30);
  assert.equal(r.lucroLiquido, 6);
  assert.equal(r.precoMinimoComDesconto, 18);
  assert.equal(precoPorMarkup(10, 50), 15);
  assert.equal(precoPorMargemLiquida(10, 30, 20), 20);
  assert.equal(precoPorMargemLiquida(10, 80, 20), null);
});

test('números digitados no padrão brasileiro', () => {
  assert.equal(lerNumero('1.234,56'), 1234.56);
  assert.equal(lerNumero('12,5'), 12.5);
  assert.equal(lerNumero('12.5'), 12.5);
  assert.equal(lerNumero(''), null);
  assert.equal(lerNumero('abc'), null);
});

test('EAN-13: padrão de barras conhecido (exemplo GS1 4006381333931)', () => {
  assert.equal(eanValido('4006381333931'), true);
  assert.equal(eanValido('4006381333932'), false);
  const m = modulosEan('4006381333931')!;
  assert.equal(m.length, 95, 'EAN-13 tem 95 módulos');
  assert.equal(m.slice(0, 3), '101');
  assert.equal(m.slice(45, 50), '01010', 'guarda central');
  // 1º dígito 4 → paridade LGLLGG; 2º dígito 0 em L = 0001101
  assert.equal(m.slice(3, 10), '0001101');
  assert.match(String(svgEan('4006381333931')), /^<svg[^>]+aria-label="Código de barras 4006381333931"/);
  assert.equal(svgEan('123'), null);
});

test('EAN-8: 67 módulos', () => {
  assert.equal(modulosEan('96385074')!.length, 67);
});

test('formulário: só o que mudou vai para a API, nos tipos certos', () => {
  const ficha: any = {
    produto: { nome: 'Refri', sku: 'R1', custo: '10', precoVenda: '15', estoqueMinimo: '5', estoqueMaximo: '100', pontoPedido: '0', estoqueSeguranca: '0', politicaCusto: 'MEDIO_PONDERADO', controlaEstoque: true, diasValidade: null, premiacaoInicio: null, fatoresConversao: [], codigosBarras: [] },
    estoque: { filiais: [{ local: 'A1' }] }, podeVerCusto: true,
  };
  const original = formDaFicha(ficha);
  assert.equal(original.custo, '10');
  assert.equal(original.local, 'A1');
  const atual = { ...original, precoVenda: '17,90', diasValidade: '30', controlaEstoque: false, premiacaoInicio: '2026-12-01', referencia: '  ', nome: '' };
  assert.deepEqual(payloadAlterado(original, atual, true), {
    precoVenda: 17.9, diasValidade: 30, controlaEstoque: false, premiacaoInicio: '2026-12-01T00:00:00.000Z',
  }, 'nome vazio (obrigatório) e referência só com espaços não são enviados');
  assert.equal('custo' in payloadAlterado(original, { ...original, custo: '9' }, false), false, 'sem permissão de custo, custo não é enviado');
});

test('PDV offline: bipar um código ADICIONAL encontra o mesmo produto', async () => {
  const banco = await novoBanco(`pdv-codigos-${Date.now()}`);
  try {
    await sincronizarCatalogo({ empresaId: 'e1', usuarioId: 'u1' }, 'f1', [{
      id: 'p1', empresaId: 'e1', filialId: 'f1', nome: 'Refri 2L', sku: 'RF2', codigoBarras: '4006381333931',
      codigosBarras: ['4006381333931', '96385074', '01234'], precoVenda: 9.9, unidade: 'UN', ativo: true, atualizadoEm: 1000,
    } as any]);
    assert.equal((await resolverBipagem('e1', 'f1', '4006381333931'))?.id, 'p1', 'principal');
    assert.equal((await resolverBipagem('e1', 'f1', '96385074'))?.id, 'p1', 'EAN-8 adicional');
    assert.equal((await resolverBipagem('e1', 'f1', '01234'))?.id, 'p1', 'PLU de balança');
    assert.equal(await resolverBipagem('e1', 'f1', '00000000'), undefined);
    assert.equal(await resolverBipagem('e1', 'f2', '96385074'), undefined, 'outra filial não enxerga');
  } finally { await destruirBanco(banco); }
});

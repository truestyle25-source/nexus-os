/**
 * TESTE UNITÁRIO — regras do cadastro de produtos (precificação, fiscal, códigos GS1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularPrecificacao, precoPorMarkup, precoPorMargemLiquida, validarFiscal, somaImpostosSobreVenda,
  digitoGs1, gtinValido, validarCodigo, inferirTipoCodigo,
} from '../src/modules/produtos/produto-regras.js';

test('markup é sobre o custo; margem é sobre o preço', () => {
  const r = calcularPrecificacao({ custo: 10, precoVenda: 15 });
  assert.equal(r.markupPercentual, 50);
  assert.equal(r.margemBrutaPercentual, 33.33);
  assert.equal(r.lucroBruto, 5);
  assert.equal(r.margemLiquidaPercentual, 33.33, 'sem deduções, líquida = bruta');
});

test('margem líquida desconta impostos, comissão e despesas sobre o preço', () => {
  const r = calcularPrecificacao({ custo: 10, precoVenda: 20, impostosPercentual: 10, comissaoPercentual: 5, despesasPercentual: 5 });
  assert.equal(r.deducoesPercentual, 20);
  assert.equal(r.deducoesValor, 4);
  assert.equal(r.lucroLiquido, 6);
  assert.equal(r.margemLiquidaPercentual, 30);
  assert.equal(r.margemBrutaPercentual, 50);
});

test('desconto máximo: preço mínimo e lucro no limite', () => {
  const r = calcularPrecificacao({ custo: 10, precoVenda: 20, descontoMaximoPercentual: 10, impostosPercentual: 10 });
  assert.equal(r.precoMinimoComDesconto, 18);
  assert.equal(r.lucroLiquidoNoDescontoMaximo, 6.2);
});

test('sem custo não há markup; preço abaixo do custo é sinalizado', () => {
  assert.equal(calcularPrecificacao({ custo: 0, precoVenda: 10 }).markupPercentual, null);
  assert.equal(calcularPrecificacao({ custo: 12, precoVenda: 10 }).abaixoDoCusto, true);
  assert.equal(calcularPrecificacao({ custo: 12, precoVenda: 0 }).margemBrutaPercentual, null);
});

test('preço por markup e por margem líquida', () => {
  assert.equal(precoPorMarkup(10, 50), 15);
  assert.equal(precoPorMargemLiquida(10, 30, 20), 20);
  assert.equal(precoPorMargemLiquida(10, 60, 40), null, 'margem + deduções >= 100% é impossível');
});

test('fiscal: formatos oficiais', () => {
  const { erros } = validarFiscal('REGIME_NORMAL', { ncm: '1234', cest: '12', cfopEntrada: '5102', cfopSaida: '1102', cstIcms: '99', cstPis: '10', cstIpi: '77', aliquotaIcms: 150, origemMercadoria: 9 });
  const campos = erros.map((e) => e.campo).sort();
  assert.deepEqual(campos, ['aliquotaIcms', 'cest', 'cfopEntrada', 'cfopSaida', 'cstIcms', 'cstIpi', 'cstPis', 'ncm', 'origemMercadoria'].sort());
});

test('fiscal: válido no regime normal', () => {
  const r = validarFiscal('REGIME_NORMAL', { ncm: '22021000', cest: '0300700', cfopEntrada: '1102', cfopSaida: '5102', cstIcms: '00', aliquotaIcms: 18, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6, origemMercadoria: 0 });
  assert.deepEqual(r.erros, []);
});

test('fiscal: Simples usa CSOSN; regime normal usa CST', () => {
  assert.equal(validarFiscal('SIMPLES_NACIONAL', { cstIcms: '00' }).erros[0]?.campo, 'cstIcms');
  assert.deepEqual(validarFiscal('SIMPLES_NACIONAL', { csosn: '102' }).erros, []);
  assert.equal(validarFiscal('REGIME_NORMAL', { csosn: '102' }).erros[0]?.campo, 'csosn');
  assert.equal(validarFiscal('SIMPLES_EXCESSO_SUBLIMITE', { csosn: '102' }).erros[0]?.campo, 'csosn');
  assert.equal(validarFiscal(null, { csosn: '102' }).avisos[0]?.campo, 'regime', 'sem regime: aviso, não erro');
});

test('fiscal: reforma tributária (IBS/CBS) só formato', () => {
  assert.deepEqual(validarFiscal('REGIME_NORMAL', { cstIbsCbs: '000', classificacaoTributaria: '000001', aliquotaIbs: 0.1, aliquotaCbs: 0.9 }).erros, []);
  assert.equal(validarFiscal('REGIME_NORMAL', { classificacaoTributaria: '12' }).erros[0]?.campo, 'classificacaoTributaria');
});

test('soma de impostos sobre a venda (sem IPI)', () => {
  assert.equal(somaImpostosSobreVenda({ aliquotaIcms: 18, aliquotaPis: 1.65, aliquotaCofins: 7.6, aliquotaIpi: 10 }), 27.25);
});

test('GS1: dígito verificador e tipos', () => {
  assert.equal(digitoGs1('400638133393'), 1, 'exemplo de referência GS1');
  assert.equal(gtinValido('4006381333931'), true);
  assert.equal(gtinValido('4006381333932'), false);
  assert.equal(gtinValido('96385074'), true, 'EAN-8 válido');
  assert.equal(validarCodigo('4006381333931', 'EAN13'), null);
  assert.match(String(validarCodigo('4006381333932', 'EAN13')), /dígito verificador/);
  assert.equal(validarCodigo('96385074', 'EAN8'), null);
  assert.equal(validarCodigo('12345', 'BALANCA'), null);
  assert.match(String(validarCodigo('1234567', 'BALANCA')), /PLU/);
  assert.equal(validarCodigo('CX-12.A', 'INTERNO'), null);
  assert.match(String(validarCodigo('com espaço', 'INTERNO')), /interno/);
  assert.equal(inferirTipoCodigo('4006381333931'), 'EAN13');
  assert.equal(inferirTipoCodigo('ABC'), 'INTERNO');
});

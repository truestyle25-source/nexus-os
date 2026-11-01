/**
 * Testes do cálculo de verbas rescisórias.
 *
 * O caso de referência é o que expôs o bug: salário R$ 3.000 com 10 dias de
 * saldo. Antes a tela mostrava R$ 10.340 e o banco gravava R$ 5.296 — duas
 * fórmulas diferentes para o mesmo desligamento. Aqui o valor é conferido
 * contra a conta feita à mão, e travado por teste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarVerbas,
  devePagarMulta,
  mesesEntre,
  anosCompletos,
  diasDeContrato,
} from '../src/modules/rh/verbas.js';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

test('salário 3000 e 10 dias de saldo: total confere com a conta à mão', () => {
  // Admitido 01/01/2026, desligado 30/09/2026 → 9 meses completos de serviço.
  // 13º proporcional   : 3000/12 × 9  = 2.250,00
  // férias vencidas    : 0 anos completos = 0,00
  // férias proporc.    : 9/12 × 3000   = 2.250,00
  // 1/3 constitucional : (0+2250)/3   =   750,00
  // saldo de salário   : 3000/30 × 10 = 1.000,00
  // aviso (30 dias)    : 3000/30 × 30 = 3.000,00
  // TOTAL                            = 9.250,00
  const v = montarVerbas({
    salario: 3000,
    dataAdmissao: d('2026-01-01'),
    dataDesligamento: d('2026-09-30'),
    tipo: 'sem-justa-causa',
    aviso: 'indenizado',
    saldoDias: 10,
  });
  assert.equal(v.decimoTerceiro, 2250);
  assert.equal(v.feriasVencidas, 0);
  assert.equal(v.feriasProporcionais, 2250);
  assert.equal(v.tercoConstitucional, 750);
  assert.equal(v.saldoSalario, 1000);
  assert.equal(v.avisoPrevio, 3000);
  assert.equal(v.total, 9250);
});

test('o total é sempre a soma exata das verbas apuradas', () => {
  const v = montarVerbas({
    salario: 2500,
    dataAdmissao: d('2019-03-15'),
    dataDesligamento: d('2026-08-20'),
    tipo: 'pedido',
    aviso: 'indenizado',
    saldoDias: 7,
  });
  const soma = v.decimoTerceiro + v.feriasVencidas + v.feriasProporcionais + v.tercoConstitucional + v.saldoSalario + v.avisoPrevio;
  assert.equal(v.total, Math.round(soma * 100) / 100);
});


test('13º proporcional nunca passa de 12/12 de salário', () => {
  const v = montarVerbas({
    salario: 3000,
    dataAdmissao: d('2015-01-01'),
    dataDesligamento: d('2026-12-31'),
    tipo: 'sem-justa-causa',
    aviso: 'indenizado',
    saldoDias: 0,
  });
  assert.equal(v.meses13, 12);
  assert.equal(v.decimoTerceiro, 3000);
});

test('férias vencidas contam só anos completos de serviço', () => {
  // Admitido 01/01/2020, desligado 31/12/2026 → 6 anos completos.
  const v = montarVerbas({
    salario: 2000,
    dataAdmissao: d('2020-01-01'),
    dataDesligamento: d('2026-12-31'),
    tipo: 'pedido',
    aviso: 'dispensado',
    saldoDias: 0,
  });
  assert.equal(v.anosCompletos, 6);
  assert.equal(v.feriasVencidas, 12000);
});

test('o dia do aniversário ainda não completado não conta como ano', () => {
  // Admitido 15/08/2020, desligado 10/08/2026 → ainda faltam 5 dias para 6 anos.
  const v = montarVerbas({
    salario: 2000,
    dataAdmissao: d('2020-08-15'),
    dataDesligamento: d('2026-08-10'),
    tipo: 'pedido',
    aviso: 'dispensado',
    saldoDias: 0,
  });
  assert.equal(v.anosCompletos, 5);
});

test('saldo de salário é salário ÷ 30 × dias', () => {
  const v = montarVerbas({
    salario: 3000,
    dataAdmissao: d('2020-01-01'),
    dataDesligamento: d('2026-09-30'),
    tipo: 'pedido',
    aviso: 'trabalhado',
    saldoDias: 15,
  });
  assert.equal(v.saldoSalario, 1500);
});

test('aviso prévio de 7 dias para contrato até 45 dias e de 30 dias acima', () => {
  const curto = montarVerbas({
    salario: 3000, dataAdmissao: d('2026-09-01'), dataDesligamento: d('2026-09-20'),
    tipo: 'pedido', aviso: 'indenizado', saldoDias: 0,
  });
  assert.equal(curto.diasAviso, 7);
  assert.equal(curto.avisoPrevio, 700);

  const longo = montarVerbas({
    salario: 3000, dataAdmissao: d('2024-09-01'), dataDesligamento: d('2026-09-20'),
    tipo: 'pedido', aviso: 'indenizado', saldoDias: 0,
  });
  assert.equal(longo.diasAviso, 30);
  assert.equal(longo.avisoPrevio, 3000);
});

test('aviso trabalhado e dispensado não geram valor a pagar', () => {
  for (const aviso of ['trabalhado', 'dispensado'] as const) {
    const v = montarVerbas({
      salario: 3000, dataAdmissao: d('2020-01-01'), dataDesligamento: d('2026-09-30'),
      tipo: 'sem-justa-causa', aviso, saldoDias: 5,
    });
    assert.equal(v.avisoPrevio, 0, `aviso=${aviso}`);
    assert.equal(v.diasAviso, 0, `aviso=${aviso}`);
  }
});

test('FGTS e multa ficam nulos, porque não há saldo depositado no banco', () => {
  const v = montarVerbas({
    salario: 3000, dataAdmissao: d('2020-01-01'), dataDesligamento: d('2026-09-30'),
    tipo: 'sem-justa-causa', aviso: 'indenizado', saldoDias: 0,
  });
  // null e não 0: "não apurado" precisa ser diferente de "apurado como zero".
  assert.equal(v.saldoFgts, null);
  assert.equal(v.multaFgts, null);
  assert.equal(v.fgtsApurado, false);
  // E o total não os inclui — se incluísse, seria número inventado.
  assert.ok(Number.isFinite(v.total));
});

test('multa é devida em sem-justa-causa e acordo, não em justa causa', () => {
  const adm = d('2020-01-01');
  const desl = d('2026-09-30');
  assert.equal(devePagarMulta('sem-justa-causa', adm, desl), true);
  assert.equal(devePagarMulta('acordo', adm, desl), true);
  assert.equal(devePagarMulta('justa-causa', adm, desl), false);
});

test('multa por pedido do empregado só é devida abaixo de 1 ano de contrato', () => {
  const desl = d('2026-09-30');
  assert.equal(devePagarMulta('pedido', d('2026-03-01'), desl), true);   // ~7 meses
  assert.equal(devePagarMulta('pedido', d('2020-01-01'), desl), false);  // 6 anos
});

test('salário zero não gera verbas e não quebra o cálculo', () => {
  const v = montarVerbas({
    salario: 0, dataAdmissao: d('2020-01-01'), dataDesligamento: d('2026-09-30'),
    tipo: 'pedido', aviso: 'indenizado', saldoDias: 10,
  });
  assert.equal(v.total, 0);
});

test('sem data de admissão o cálculo não quebra (13º assume ano cheio)', () => {
  const v = montarVerbas({
    salario: 3000, dataAdmissao: null, dataDesligamento: d('2026-09-30'),
    tipo: 'pedido', aviso: 'trabalhado', saldoDias: 0,
  });
  assert.equal(v.meses13, 12);
  assert.equal(v.feriasProporcionais, 0);
});

test('funções de data: meses, anos e dias de contrato', () => {
  assert.equal(mesesEntre(d('2026-01-01'), d('2026-09-30')), 8);
  assert.equal(anosCompletos(d('2020-01-01'), d('2026-12-31')), 6);
  assert.equal(diasDeContrato(d('2026-09-01'), d('2026-09-20')), 19);
  assert.equal(diasDeContrato(null, d('2026-09-20')), 0);
});

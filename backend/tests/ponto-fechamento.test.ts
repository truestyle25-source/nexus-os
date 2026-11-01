/**
 * Testes da regra de fechamento de expediente (marcação de FALTA).
 *
 * A regra que estes testes travam: falta é o dia ÚTIL, com vínculo, em que o
 * funcionário não registrou NENHUMA batida — apurada quando o expediente fecha,
 * não no momento da marcação. Cada exclusão testada aqui (fim de semana,
 * pré-admissão, pós-desligamento, jornada incompleta) evitou desconto indevido
 * em folha.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasDeFalta, diaDaSemana, somaDias, diaDoPonto } from '../src/modules/rh/ponto-fechamento.service.js';

/** 2026-09-21 é uma segunda-feira; a semana vai até sexta 2026-09-25. */
const SEMANA = { primeiro: '2026-09-21', ultimo: '2026-09-25' };
const ATIVO = { id: 'f1', dataAdmissao: null, dataDesligamento: null };
const d = (data: string) => diaDoPonto(data);

test('semana completa sem nenhuma batida: 5 dias úteis de falta', () => {
  const r = diasDeFalta(ATIVO, new Set(), SEMANA.primeiro, SEMANA.ultimo);
  assert.deepEqual(r, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
});

test('sábado e domingo nunca são falta', () => {
  // 2026-09-26 é sábado e 2026-09-27 é domingo.
  const r = diasDeFalta(ATIVO, new Set(), '2026-09-21', '2026-09-27');
  assert.equal(r.includes('2026-09-26'), false, 'sábado não pode ser falta');
  assert.equal(r.includes('2026-09-27'), false, 'domingo não pode ser falta');
  assert.equal(r.length, 5, 'só os 5 dias úteis da semana');
});

test('quem compareceu não tem falta, mesmo com jornada incompleta', () => {
  // Entrada registrada e saída faltando: é divergência de registro, não ausência.
  const batidas = new Set(['f1|2026-09-22', 'f1|2026-09-24']);
  const r = diasDeFalta(ATIVO, batidas, SEMANA.primeiro, SEMANA.ultimo);
  assert.deepEqual(r, ['2026-09-21', '2026-09-23', '2026-09-25']);
});

test('antes da admissão não há falta: não havia vínculo', () => {
  const f = { id: 'f1', dataAdmissao: d('2026-09-23'), dataDesligamento: null };
  const r = diasDeFalta(f, new Set(), SEMANA.primeiro, SEMANA.ultimo);
  assert.deepEqual(r, ['2026-09-23', '2026-09-24', '2026-09-25'], 'dia da admissão conta');
});

test('a partir do desligamento não há falta: a pessoa já saiu da empresa', () => {
  // O dia do desligamento é excluído de propósito. Descontar falta do
  // functoolsário no ÚLTIMO dia de vínculo é a cobrança mais contestável que
  // existe — ele não está mais na empresa para registrar ponto nem para
  // recorrer. Na dúvida entre acusar e não acusar, a folha não deve acusar.
  const f = { id: 'f1', dataAdmissao: null, dataDesligamento: d('2026-09-23') };
  const r = diasDeFalta(f, new Set(), SEMANA.primeiro, SEMANA.ultimo);
  assert.deepEqual(r, ['2026-09-21', '2026-09-22']);
  assert.equal(r.includes('2026-09-23'), false, 'dia do desligamento não é falta');
  assert.equal(r.includes('2026-09-24'), false, 'dia seguinte já está fora');
});

test('admitido e desligado no mesmo dia não gera falta', () => {
  const f = { id: 'f1', dataAdmissao: d('2026-09-23'), dataDesligamento: d('2026-09-23') };
  assert.deepEqual(diasDeFalta(f, new Set(), SEMANA.primeiro, SEMANA.ultimo), []);
});

test('a batida de outro funcionário não limpa a falta deste', () => {
  const batidas = new Set(['outro|2026-09-22']);
  const r = diasDeFalta(ATIVO, batidas, SEMANA.primeiro, SEMANA.ultimo);
  assert.equal(r.length, 5, 'batida alheia não pode apagar falta');
});

test('quem compareceu em todos os dias não tem falta nenhuma', () => {
  // A chave do Set é `id|data`: montar com as datas soltas não casaria com nada.
  const todos = new Set(
    ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map((data) => `f1|${data}`),
  );
  assert.deepEqual(diasDeFalta(ATIVO, todos, SEMANA.primeiro, SEMANA.ultimo), []);
});

test('a data da batida é comparada no dia UTC, sem deslocamento de fuso', () => {
  // A linha de ponto guarda meia-noite UTC. Se a chave fosse montada com o
  // fuso da empresa, o dia viraria o anterior em São Paulo, a batida não
  // casaria com o dia apurado e a falta sairia duplicada.
  const batidas = new Set(['f1|2026-09-22']);
  const r = diasDeFalta(ATIVO, batidas, SEMANA.primeiro, SEMANA.ultimo);
  assert.equal(r.includes('2026-09-22'), false, 'a batida do dia 22 tem de ser reconhecida');
  assert.equal(r.length, 4);
});

test('somaDias atravessa virada de mês, ano e ano bissexto', () => {
  assert.equal(somaDias('2026-01-31', 1), '2026-02-01');
  assert.equal(somaDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somaDias('2026-03-01', -1), '2026-02-28');
  assert.equal(somaDias('2024-03-01', -1), '2024-02-29', '2024 é bissexto');
  assert.equal(somaDias('2026-09-21', -1), '2026-09-20');
});

test('diaDaSemana confere os dias da semana sem depender do fuso da máquina', () => {
  assert.equal(diaDaSemana('2026-09-21'), 1, 'segunda');
  assert.equal(diaDaSemana('2026-09-25'), 5, 'sexta');
  assert.equal(diaDaSemana('2026-09-26'), 6, 'sábado');
  assert.equal(diaDaSemana('2026-09-27'), 0, 'domingo');
});

test('diaDoPonto devolve meia-noite UTC, como o @db.Date do banco', () => {
  assert.equal(diaDoPonto('2026-09-22').toISOString(), '2026-09-22T00:00:00.000Z');
});

test('a ausência de admissão não bloqueia a apuração', () => {
  // Cadastro incompleto: sem data de admissão o sistema não pode inventar que a
  // pessoa já estava na empresa antes de hoje, e também não pode liberar falta
  // de todo o histórico. A apuração cobre o período pedido.
  const f = { id: 'f1', dataAdmissao: null, dataDesligamento: null };
  assert.equal(diasDeFalta(f, new Set(), SEMANA.primeiro, SEMANA.ultimo).length, 5);
});

test('a apuração respeita o fim pedido: não passa de "ate"', () => {
  // Pedir o fechamento até 25/09 não pode gerar falta em 28/09: o período
  // apurado tem de parar exatamente em `ate`. Era o bug em que `ate` só
  // alargava o INÍCIO e a rotina varria tudo até ontem.
  const r = diasDeFalta(ATIVO, new Set(), '2026-09-21', '2026-09-25');
  assert.equal(r.includes('2026-09-28'), false);
  assert.equal(r[r.length - 1], '2026-09-25', 'o último dia apurado é o próprio `ate`');
});

test('a apuração de um mês isolado não toca nos meses vizinhos', () => {
  const julho = diasDeFalta(ATIVO, new Set(), '2026-07-01', '2026-07-31');
  assert.equal(julho.length, 23, 'julho/2026 tem 23 dias úteis');
  assert.equal(julho[0], '2026-07-01');
  assert.equal(julho[julho.length - 1], '2026-07-31');
  assert.equal(julho.some((x) => x.startsWith('2026-08')), false, 'não pode vazar para agosto');
  assert.equal(julho.some((x) => x.startsWith('2026-06')), false, 'não pode vazar para junho');
});

test('23 dias úteis de julho é o mês inteiro de falta', () => {
  // É o cenário que a folha vai ler: 23/23 zera a remuneração, e o valor gerado
  // precisa ser o salário inteiro (2000), não um múltiplo dele.
  const julho = diasDeFalta(ATIVO, new Set(), '2026-07-01', '2026-07-31');
  assert.equal(julho.length, 23);
});

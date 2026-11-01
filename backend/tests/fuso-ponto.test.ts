/**
 * Testes do fuso horário aplicado ao registro de ponto.
 *
 * O bug que estes testes travam: `Ponto.data` é `@db.Date` e a marcação é
 * carimbada com o instante real. A que dia a batida pertence depende do fuso —
 * 23h30 em São Paulo é o dia 27, e o MESMO instante lido como UTC é o dia 28.
 * Sem fuso, o servidor usava o fuso da máquina e a marcação da noite caía no
 * dia errado, e o espelho mostrava um dia que não houve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataNoFuso, deslocamentoMinutos, instanteNaHoraLocal, normalizarFuso, FUSO_PADRAO,
} from '../src/lib/fuso.js';

const SP = 'America/Sao_Paulo';

test('a marcação da noite pertence ao dia que a empresa viveu', () => {
  // 23h30 em São Paulo. Em UTC é 02h30 do dia SEGUINTE — ler em UTC joga a
  // batida no dia errado, que é exatamente o defeito corrigido.
  const instante = new Date('2026-09-28T02:30:00Z');
  assert.equal(dataNoFuso(instante, SP), '2026-09-27');
  assert.equal(dataNoFuso(instante, 'UTC'), '2026-09-28');
});

test('marcação de inicio e de meio-dia ficam no mesmo dia', () => {
  assert.equal(dataNoFuso(new Date('2026-09-27T00:30:00Z'), SP), '2026-09-26');
  assert.equal(dataNoFuso(new Date('2026-09-27T13:05:00Z'), SP), '2026-09-27');
});

test('fuso ausente ou invalido nao derruba a marcacao', () => {
  // O registro tem de ser gravado: um fuso cadastral errado nao pode impedir
  // alguém de bater o ponto.
  assert.equal(normalizarFuso(null), FUSO_PADRAO);
  assert.equal(normalizarFuso(''), FUSO_PADRAO);
  assert.equal(normalizarFuso('Marte/Base'), FUSO_PADRAO);
  assert.equal(normalizarFuso('Europe/Lisbon'), 'Europe/Lisbon');
});

test('instanteNaHoraLocal monta a hora da empresa, nao a de UTC', () => {
  // 08:00 em São Paulo é 11:00 UTC. Usado no cálculo de atraso: comparar a
  // marcação com um "08:00" em UTC daria três horas de atraso a todo mundo.
  assert.equal(instanteNaHoraLocal('2026-09-27', '08:00', SP).toISOString(), '2026-09-27T11:00:00.000Z');
  assert.equal(instanteNaHoraLocal('2026-09-27', '08:00', 'UTC').toISOString(), '2026-09-27T08:00:00.000Z');
});

test('deslocamento do fuso', () => {
  assert.equal(deslocamentoMinutos(new Date('2026-09-27T12:00:00Z'), SP), -180);
  assert.equal(deslocamentoMinutos(new Date('2026-09-27T12:00:00Z'), 'UTC'), 0);
});

test('ida e volta: a hora montada volta igual, em qualquer fuso', () => {
  // A propriedade que garante que o cálculo de atraso não deriva: montar uma
  // hora local e formatá-la de novo tem que devolver a mesma hora.
  for (const [data, hora] of [['2026-09-27', '08:00'], ['2026-01-15', '18:00'], ['2026-06-30', '00:30']]) {
    for (const fuso of [SP, 'UTC', 'Europe/Lisbon', 'America/Manaus']) {
      const inst = instanteNaHoraLocal(data, hora, fuso);
      const formatado = new Intl.DateTimeFormat('en-GB', {
        timeZone: fuso, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(inst);
      assert.equal(formatado, hora, `${data} ${hora} em ${fuso}`);
      assert.equal(dataNoFuso(inst, fuso), data, `dia de ${data} em ${fuso}`);
    }
  }
});

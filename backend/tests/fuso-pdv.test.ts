import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataNoFuso, dataOperacionalDate } from '../src/lib/fuso.js';

test('data operacional acompanha o fuso da filial quando o instante UTC cruza a meia-noite local', () => {
  const instante = new Date('2026-10-06T01:30:00.000Z');

  assert.equal(dataNoFuso(instante, 'America/Sao_Paulo'), '2026-10-05');
  assert.equal(dataNoFuso(instante, 'Asia/Tokyo'), '2026-10-06');
  assert.equal(dataOperacionalDate(instante, 'America/Sao_Paulo').toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(dataOperacionalDate(instante, 'Asia/Tokyo').toISOString(), '2026-10-06T00:00:00.000Z');
});

test('fuso inválido usa o padrão operacional documentado', () => {
  const instante = new Date('2026-10-06T01:30:00.000Z');
  assert.equal(dataNoFuso(instante, 'Fuso/Que_Nao_Existe'), dataNoFuso(instante, 'America/Sao_Paulo'));
});

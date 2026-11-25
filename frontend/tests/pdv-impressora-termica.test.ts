import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codificarCp860, montarEscPos, impressaoDiretaSuportada } from '../lib/pdv/impressoraTermica';

test('impressora térmica: acentos do português na página 860', () => {
  assert.deepEqual(Array.from(codificarCp860('ção')), [0x87, 0x84, 0x6f]);
  assert.deepEqual(Array.from(codificarCp860('É')), [0x90]);
});

test('impressora térmica: espaço não separável e caracteres fora da tabela', () => {
  assert.deepEqual(Array.from(codificarCp860('R$ 1')), [0x52, 0x24, 0x20, 0x31]);
  assert.deepEqual(Array.from(codificarCp860('€')), [0x3f]);
});

test('impressora térmica: reset, página de código, texto, avanço e corte', () => {
  const bytes = Array.from(montarEscPos('OK'));
  assert.deepEqual(bytes.slice(0, 5), [0x1b, 0x40, 0x1b, 0x74, 3]);
  assert.deepEqual(bytes.slice(5, 8), [0x4f, 0x4b, 0x0a]);
  assert.deepEqual(bytes.slice(-4), [0x1d, 0x56, 0x42, 0x00]);
});

test('impressora térmica: sem Web Serial não há impressão direta', () => {
  assert.equal(impressaoDiretaSuportada(), false);
});

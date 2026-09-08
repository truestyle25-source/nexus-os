import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCnpj, normalizeCnpj, formatCnpj, generateRandomValidCnpj } from '../src/domain/cnpj.js';

test('normalizeCnpj remove pontuação', () => {
  assert.equal(normalizeCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizeCnpj('11222333000181'), '11222333000181');
});

test('isValidCnpj aceita CNPJ válido conhecido, com ou sem pontuação', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11222333000181'), true);
});

test('isValidCnpj rejeita CNPJ com dígito verificador errado', () => {
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
});

test('isValidCnpj rejeita CNPJ com todos os dígitos iguais', () => {
  assert.equal(isValidCnpj('11.111.111/1111-11'), false);
});

test('isValidCnpj rejeita entrada com tamanho errado', () => {
  assert.equal(isValidCnpj('123'), false);
});

test('formatCnpj formata 14 dígitos corretamente', () => {
  assert.equal(formatCnpj('11222333000181'), '11.222.333/0001-81');
});

test('generateRandomValidCnpj sempre gera um CNPJ que passa na própria validação', () => {
  for (let i = 0; i < 20; i++) {
    const cnpj = generateRandomValidCnpj();
    assert.equal(isValidCnpj(cnpj), true, `CNPJ gerado inválido: ${cnpj}`);
  }
});

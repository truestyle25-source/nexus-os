import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/hash.js';

test('hashPassword gera hashes diferentes para a mesma senha (salt aleatório)', () => {
  const h1 = hashPassword('MinhaSenh@123');
  const h2 = hashPassword('MinhaSenh@123');
  assert.notEqual(h1, h2);
});

test('verifyPassword aceita a senha correta', () => {
  const hash = hashPassword('MinhaSenh@123');
  assert.equal(verifyPassword('MinhaSenh@123', hash), true);
});

test('verifyPassword rejeita senha incorreta', () => {
  const hash = hashPassword('MinhaSenh@123');
  assert.equal(verifyPassword('SenhaErrada', hash), false);
});

test('hashPassword rejeita senha muito curta', () => {
  assert.throws(() => hashPassword('123'));
});

test('verifyPassword rejeita hash malformado sem lançar exceção', () => {
  assert.equal(verifyPassword('qualquer', 'hash-invalido-sem-separador'), false);
});

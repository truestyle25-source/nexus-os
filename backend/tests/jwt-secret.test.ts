/**
 * TESTE UNITÁRIO — Validação de JWT_SECRET no boot do servidor
 *
 * Garante que o servidor se recusa a iniciar quando:
 *   1. JWT_SECRET não está definido
 *   2. JWT_SECRET tem menos de 32 caracteres
 *
 * E permite inicialização quando JWT_SECRET tem 32+ caracteres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarJwtSecret } from '../src/server.js';

const SECRET_31 = 'a'.repeat(31);
const SECRET_32 = 'b'.repeat(32);
const SECRET_64 = 'c'.repeat(64);

function withEnv(value: string | undefined, fn: () => void | Promise<void>): void {
  const original = process.env.JWT_SECRET;
  if (value === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = value;
  }
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  }
}

test('jwt-secret: lança erro quando JWT_SECRET não está definido', () => {
  withEnv(undefined, () => {
    assert.throws(() => validarJwtSecret(), /JWT_SECRET não definido/);
  });
});

test('jwt-secret: lança erro quando JWT_SECRET está vazio', () => {
  withEnv('', () => {
    assert.throws(() => validarJwtSecret(), /JWT_SECRET não definido/);
  });
});

test('jwt-secret: lança erro quando JWT_SECRET tem 31 caracteres', () => {
  withEnv(SECRET_31, () => {
    assert.throws(() => validarJwtSecret(), /menos de 32 caracteres/);
  });
});

test('jwt-secret: lança erro quando JWT_SECRET tem 1 caractere', () => {
  withEnv('x', () => {
    assert.throws(() => validarJwtSecret(), /menos de 32 caracteres/);
  });
});

test('jwt-secret: não lança erro quando JWT_SECRET tem exatamente 32 caracteres', () => {
  withEnv(SECRET_32, () => {
    assert.doesNotThrow(() => validarJwtSecret());
  });
});

test('jwt-secret: não lança erro quando JWT_SECRET tem 64 caracteres', () => {
  withEnv(SECRET_64, () => {
    assert.doesNotThrow(() => validarJwtSecret());
  });
});

test('jwt-secret: mensagem de erro menciona impossibilidade de iniciar', () => {
  withEnv(undefined, () => {
    try {
      validarJwtSecret();
      assert.fail('Deveria ter lançado erro');
    } catch (error) {
      const msg = (error as Error).message;
      assert.ok(msg.includes('não pode iniciar'), `mensagem deveria mencionar impossibilidade de iniciar: ${msg}`);
    }
  });
});

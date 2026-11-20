/**
 * Cifragem de credenciais de integração: compatibilidade v1 -> v2 e
 * independência entre CREDENTIALS_ENCRYPTION_KEY e JWT_SECRET.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, precisaRecifrar, recifrar } from '../src/lib/secrets.js';

const JWT_A = 'jwt_secret_teste_A_0123456789abcdefghijkl';
const JWT_B = 'jwt_secret_teste_B_9876543210zyxwvutsrqpo';
const CHAVE_HEX = randomBytes(32).toString('hex');
const CHAVE_B64 = randomBytes(32).toString('base64');

function comEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { antes[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(antes)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
}

test('sem CREDENTIALS_ENCRYPTION_KEY: mantém o formato legado (v1)', () => {
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: undefined }, () => {
    const c = encryptSecret('token-ml');
    assert.ok(!c.startsWith('v2.'));
    assert.equal(c.split('.').length, 3);
    assert.equal(decryptSecret(c), 'token-ml');
    assert.equal(precisaRecifrar(c), false);
  });
});

test('com a chave: grava em v2 e continua lendo v1', () => {
  const v1 = comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: undefined }, () => encryptSecret('refresh-antigo'));
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: CHAVE_HEX }, () => {
    const v2 = encryptSecret('novo-token');
    assert.ok(v2.startsWith('v2.'));
    assert.equal(decryptSecret(v2), 'novo-token');
    assert.equal(decryptSecret(v1), 'refresh-antigo');
    assert.equal(precisaRecifrar(v1), true);
    assert.equal(precisaRecifrar(v2), false);
  });
});

test('recifrar converte v1 em v2 preservando o valor', () => {
  const v1 = comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: undefined }, () => encryptSecret('chave-pix@exemplo'));
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: CHAVE_B64 }, () => {
    const v2 = recifrar(v1);
    assert.ok(v2.startsWith('v2.'));
    assert.equal(decryptSecret(v2), 'chave-pix@exemplo');
  });
});

test('v2 é independente do JWT_SECRET: trocar o JWT não quebra as integrações', () => {
  const v2 = comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: CHAVE_HEX }, () => encryptSecret('access-shopee'));
  comEnv({ JWT_SECRET: JWT_B, CREDENTIALS_ENCRYPTION_KEY: CHAVE_HEX }, () => {
    assert.equal(decryptSecret(v2), 'access-shopee');
  });
});

test('vazar só o JWT_SECRET não permite decifrar valores v2', () => {
  const v2 = comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: CHAVE_HEX }, () => encryptSecret('segredo'));
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('hex') }, () => {
    assert.throws(() => decryptSecret(v2));
  });
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: undefined }, () => {
    assert.throws(() => decryptSecret(v2), /CREDENTIALS_ENCRYPTION_KEY/);
  });
});

test('valor adulterado é rejeitado (GCM autenticado)', () => {
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: CHAVE_HEX }, () => {
    const c = encryptSecret('original');
    const partes = c.split('.');
    partes[3] = Buffer.from('adulterado').toString('base64url');
    assert.throws(() => decryptSecret(partes.join('.')));
  });
});

test('chave com tamanho errado é recusada', () => {
  comEnv({ JWT_SECRET: JWT_A, CREDENTIALS_ENCRYPTION_KEY: 'curta-demais' }, () => {
    assert.throws(() => encryptSecret('x'), /32 bytes/);
  });
});

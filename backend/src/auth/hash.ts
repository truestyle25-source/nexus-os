import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senha usando scrypt (nativo do Node, sem dependências externas).
 * Formato armazenado: "<salt-hex>:<hash-hex>"
 *
 * scrypt é uma função de derivação de chave resistente a ataques por
 * hardware dedicado (ASIC/GPU), recomendada pela OWASP como alternativa
 * ao bcrypt quando não se quer depender de uma lib nativa compilada.
 */

const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N — custo de CPU/memória (2^14)

function normalizeSecret(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hashPassword(plainPassword: string): string {
  const normalized = normalizeSecret(plainPassword);
  if (!normalized || normalized.length < 8) {
    throw new Error('Senha deve ter no mínimo 8 caracteres');
  }
  const salt = randomBytes(16);
  const derivedKey = scryptSync(normalized, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  const normalizedPassword = normalizeSecret(plainPassword);
  const normalizedHash = normalizeSecret(storedHash);
  if (!normalizedPassword || !normalizedHash) return false;

  const [saltHex, hashHex] = normalizedHash.split(':');
  if (!saltHex || !hashHex || !/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(hashHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0 || salt.length === 0) return false;

  const actual = scryptSync(normalizedPassword, salt, expected.length, { N: SCRYPT_COST });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashRefreshToken(token: string): string {
  const normalized = normalizeSecret(token);
  if (!normalized) {
    throw new Error('Refresh token inválido');
  }

  const salt = randomBytes(16);
  const derived = scryptSync(normalized, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyRefreshToken(token: string, storedHash: string): boolean {
  const normalizedToken = normalizeSecret(token);
  const normalizedHash = normalizeSecret(storedHash);
  if (!normalizedToken || !normalizedHash) return false;

  const [saltHex, hashHex] = normalizedHash.split(':');
  if (!saltHex || !hashHex || !/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(hashHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0 || salt.length === 0) return false;

  const actual = scryptSync(normalizedToken, salt, expected.length, { N: SCRYPT_COST });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Implementação mínima de JWT (HS256) usando apenas 'node:crypto'.
 * A validação foi reforçada para verificar header, algoritmo, tipo,
 * expiração e claims obrigatórios antes de aceitar qualquer token.
 */

export interface JwtPayload {
  sub: string;
  companyId: string;
  roleId: string;
  type: 'access' | 'refresh';
  jti?: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function assertValidClaims(payload: Partial<JwtPayload>, expectedType?: 'access' | 'refresh'): asserts payload is JwtPayload {
  if (!payload || typeof payload !== 'object') {
    throw new JwtError('Payload inválido');
  }
  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
    throw new JwtError('Claim sub inválida');
  }
  if (typeof payload.companyId !== 'string' || payload.companyId.trim().length === 0) {
    throw new JwtError('Claim companyId inválida');
  }
  if (typeof payload.roleId !== 'string' || payload.roleId.trim().length === 0) {
    throw new JwtError('Claim roleId inválida');
  }
  if (payload.type !== 'access' && payload.type !== 'refresh') {
    throw new JwtError('Tipo de token inválido');
  }
  if (expectedType && payload.type !== expectedType) {
    throw new JwtError(`Tipo de token inesperado: esperado ${expectedType}`);
  }
  if (typeof payload.exp !== 'number' || Number.isNaN(payload.exp)) {
    throw new JwtError('Claim exp inválida');
  }
  if (typeof payload.iat !== 'number' || Number.isNaN(payload.iat)) {
    throw new JwtError('Claim iat inválida');
  }
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    jti: payload.jti ?? randomUUID(),
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const encodedSignature = base64url(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

export class JwtError extends Error {}

export function verifyJwt(token: string, secret: string, expectedType?: 'access' | 'refresh'): JwtPayload {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new JwtError('Token ausente');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('Token malformado');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64urlDecode(encodedHeader).toString('utf8'));
  } catch {
    throw new JwtError('Header do token inválido');
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new JwtError('Algoritmo do token inválido');
  }

  const expectedSignature = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const actualSignature = base64urlDecode(encodedSignature);

  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw new JwtError('Assinatura inválida');
  }

  let payload: Partial<JwtPayload>;
  try {
    payload = JSON.parse(base64urlDecode(encodedPayload).toString('utf8'));
  } catch {
    throw new JwtError('Payload do token inválido');
  }

  assertValidClaims(payload, expectedType);

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new JwtError('Token expirado');
  if (payload.iat > now + 5) throw new JwtError('Token emitido no futuro');

  return payload as JwtPayload;
}

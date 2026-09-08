import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt, JwtError } from '../src/auth/jwt.js';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-000';

test('signJwt + verifyJwt: token válido é aceito e payload é preservado', () => {
  const token = signJwt({ sub: 'user-1', companyId: 'company-1', roleId: 'role-1', type: 'access' }, SECRET, 60);
  const payload = verifyJwt(token, SECRET);
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.companyId, 'company-1');
  assert.equal(payload.type, 'access');
});

test('verifyJwt rejeita token expirado', () => {
  const token = signJwt({ sub: 'user-1', companyId: 'c1', roleId: 'r1', type: 'access' }, SECRET, -1);
  assert.throws(() => verifyJwt(token, SECRET), JwtError);
});

test('verifyJwt rejeita assinatura adulterada', () => {
  const token = signJwt({ sub: 'user-1', companyId: 'c1', roleId: 'r1', type: 'access' }, SECRET, 60);
  const [h, p] = token.split('.');
  const tampered = `${h}.${p}.assinatura-falsa`;
  assert.throws(() => verifyJwt(tampered, SECRET), JwtError);
});

test('verifyJwt rejeita token assinado com outro segredo', () => {
  const token = signJwt({ sub: 'user-1', companyId: 'c1', roleId: 'r1', type: 'access' }, SECRET, 60);
  assert.throws(() => verifyJwt(token, 'outro-segredo-completamente-diferente-0000'), JwtError);
});

test('verifyJwt rejeita token malformado', () => {
  assert.throws(() => verifyJwt('nao-e-um-jwt', SECRET), JwtError);
});

test('payload adulterado no meio do token é detectado (payload de outro usuário injetado)', () => {
  const token = signJwt({ sub: 'user-1', companyId: 'c1', roleId: 'r1', type: 'access' }, SECRET, 60);
  const [h, , s] = token.split('.');
  const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin', companyId: 'c1', roleId: 'admin-role', type: 'access', iat: 0, exp: 9999999999 }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tampered = `${h}.${fakePayload}.${s}`;
  assert.throws(() => verifyJwt(tampered, SECRET), JwtError);
});

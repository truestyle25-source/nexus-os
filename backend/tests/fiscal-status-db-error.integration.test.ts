import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { registerAuthentication } from '../src/middlewares/auth.js';
import { fiscalRoutes } from '../src/modules/fiscal/fiscal.routes.js';

const isExplicitUnavailableLoopback = (() => {
  if (process.env.FISCAL_TEST_DATABASE_UNAVAILABLE !== 'yes' || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' &&
      url.port === '1' && url.pathname === '/fiscal_unavailable_test';
  } catch {
    return false;
  }
})();

test('GET /fiscal/status returns safe HTTP 500 when PostgreSQL is unavailable', {
  skip: !isExplicitUnavailableLoopback ? 'Requer URL explícita de loopback descartável na porta fechada 1.' : false,
}, async () => {
  const app = Fastify();
  await app.register(jwt, { secret: 'fiscal-db-error-test-secret-minimum-32' });
  await app.register(registerAuthentication);
  await app.register(fiscalRoutes);
  await app.ready();

  try {
    const token = app.jwt.sign({ id: 'test-user', empresaId: 'test-company', email: 'test@test.invalid' });
    const response = await app.inject({
      method: 'GET', url: '/fiscal/status',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.includes('ECONNREFUSED'), false);
    assert.equal(response.body.includes('DATABASE_URL'), false);
    assert.equal(response.body.includes('PrismaClient'), false);
  } finally {
    await app.close();
  }
});

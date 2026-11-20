/**
 * CORS como o NAVEGADOR enxerga: preflight (OPTIONS) para cada método usado
 * pelo frontend. Os demais testes chamam a API direto e não passam por isto —
 * foi assim que a mudança de padrão do @fastify/cors 11 (só GET/HEAD/POST)
 * chegou à produção bloqueando edições e exclusões feitas pela tela.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { opcoesCors, origensPermitidas } from '../src/lib/cors.js';

const FRONT = 'https://nexus-os-one-teal.vercel.app';

async function app(valor: string) {
  const a = Fastify({ logger: false });
  await a.register(cors, opcoesCors(valor));
  a.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], url: '/produtos/:id', handler: async () => ({ ok: true }) });
  return a;
}

const preflight = (a: Awaited<ReturnType<typeof app>>, origem: string, metodo: string) =>
  a.inject({
    method: 'OPTIONS', url: '/produtos/1',
    headers: { origin: origem, 'access-control-request-method': metodo, 'access-control-request-headers': 'content-type,authorization' },
  });

test('preflight libera todos os métodos usados pelo frontend', async () => {
  const a = await app(FRONT);
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await preflight(a, FRONT, m);
    assert.equal(r.headers['access-control-allow-origin'], FRONT, m);
    const permitidos = String(r.headers['access-control-allow-methods']).split(',').map((s) => s.trim());
    assert.ok(permitidos.includes(m), `${m} ausente em: ${permitidos}`);
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
  }
  await a.close();
});

test('origem não configurada não recebe allow-origin', async () => {
  const a = await app(FRONT);
  const r = await preflight(a, 'https://atacante.example', 'DELETE');
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  await a.close();
});

test('FRONTEND_URLS com barra final, espaços e repetição é normalizada', async () => {
  assert.deepEqual(origensPermitidas(` ${FRONT}/ , http://localhost:3000/,${FRONT}`), [FRONT, 'http://localhost:3000']);
  const a = await app(`${FRONT}/`);
  const r = await preflight(a, FRONT, 'PUT');
  assert.equal(r.headers['access-control-allow-origin'], FRONT);
  await a.close();
});

test('sem FRONTEND_URLS cai em http://localhost:3000', () => {
  assert.deepEqual(origensPermitidas(undefined), ['http://localhost:3000']);
  assert.deepEqual(origensPermitidas(''), ['http://localhost:3000']);
});

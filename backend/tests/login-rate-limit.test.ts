/**
 * TESTE UNITÁRIO — Rate limiter persistente de login (`createLoginRateLimiter`)
 *
 * Garante que:
 *  1. Tentativas abaixo do limite são permitidas.
 *  2. O limite é aplicado por IP (contador compartilhado pelo IP).
 *  3. O limite é aplicado por email (contador compartilhado pelo email).
 *  4. IPs diferentes têm contadores independentes (não há bloqueio coletivo atrás de proxy).
 *  5. Emails diferentes têm contadores independentes.
 *  6. Tentativas fora da janela de tempo não contam.
 *  7. O cabeçalho `Retry-After` é definido quando o limite é atingido.
 *  8. O limite persiste (não zera) entre chamadas — simula banco de dados.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginRateLimiter } from '../src/middlewares/rateLimiter.js';

type LoginAttemptRow = {
  id: string;
  ip: string;
  email: string | null;
  sucesso: boolean;
  createdAt: Date;
};

function criarPrismaMock() {
  const rows: LoginAttemptRow[] = [];
  let contadorId = 0;

  return {
    loginAttempt: {
      async count({ where }: { where: any }): Promise<number> {
        return rows.filter((r) => {
          const ipMatch = where.ip === undefined || r.ip === where.ip;
          const emailMatch = where.email === undefined || r.email === where.email;
          const sucessoMatch = where.sucesso === undefined || r.sucesso === where.sucesso;
          let createdAtMatch = true;
          if (where.createdAt?.gte) {
            createdAtMatch = r.createdAt.getTime() >= where.createdAt.gte.getTime();
          }
          return ipMatch && emailMatch && sucessoMatch && createdAtMatch;
        }).length;
      },
      async findFirst({ where, orderBy, select }: { where: any; orderBy?: any; select?: any }): Promise<LoginAttemptRow | null> {
        const candidatos = rows.filter((r) => {
          const ipMatch = where.ip === undefined || r.ip === where.ip;
          const emailMatch = where.email === undefined || r.email === where.email;
          const sucessoMatch = where.sucesso === undefined || r.sucesso === where.sucesso;
          let createdAtMatch = true;
          if (where.createdAt?.gte) {
            createdAtMatch = r.createdAt.getTime() >= where.createdAt.gte.getTime();
          }
          return ipMatch && emailMatch && sucessoMatch && createdAtMatch;
        });
        if (candidatos.length === 0) return null;
        if (orderBy?.createdAt === 'asc') {
          candidatos.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        const row = candidatos[0];
        if (select?.createdAt) {
          return { ...row, createdAt: row.createdAt };
        }
        return row;
      },
      async create({ data }: { data: any }): Promise<LoginAttemptRow> {
        const row: LoginAttemptRow = {
          id: `attempt-${++contadorId}`,
          ip: data.ip,
          email: data.email ?? null,
          sucesso: data.sucesso ?? false,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        };
        rows.push(row);
        return row;
      },
    },
  } as any;
}

function criarReq(ip: string, email?: string) {
  return { ip, body: email ? { email } : {} } as any;
}

function criarReply() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: any = null;
  return {
    header(name: string, value: string) { headers[name] = value; return this; },
    status(code: number) { statusCode = code; return this; },
    send(data: any) { body = data; return this; },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; },
  } as any;
}

// --- Testes ---------------------------------------------------------------

test('login-rate-limit: permite tentativas abaixo do limite', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(3, 60_000, prisma);

  const req = criarReq('1.2.3.4', 'usuario@example.com');
  const reply = criarReply();

  await limiter(req, reply);
  assert.strictEqual(reply.statusCode, 200);
  assert.strictEqual(reply.body, null);
});

test('login-rate-limit: bloqueia quando o limite por (ip, email) é atingido', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(2, 60_000, prisma);

  const ip = '5.6.7.8';
  const email = 'mesmo@example.com';
  await limiter(criarReq(ip, email), criarReply());
  await limiter(criarReq(ip, email), criarReply());

  const reply = criarReply();
  await limiter(criarReq(ip, email), reply);

  assert.strictEqual(reply.statusCode, 429);
  assert.ok(reply.headers['Retry-After'], 'Retry-After deve estar definido');
  assert.ok(String(reply.body.error).includes('Muitas tentativas de login'));
});

test('login-rate-limit: bloqueia quando o limite por email é atingido (mesmo IP diferente)', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(2, 60_000, prisma);

  const email = 'alvo@example.com';
  await limiter(criarReq('10.0.0.1', email), criarReply());
  await limiter(criarReq('10.0.0.2', email), criarReply());

  const reply = criarReply();
  await limiter(criarReq('10.0.0.3', email), reply);

  assert.strictEqual(reply.statusCode, 429);
});

test('login-rate-limit: IPs diferentes têm contadores independentes', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(2, 60_000, prisma);

  await limiter(criarReq('20.0.0.1', 'a@example.com'), criarReply());
  await limiter(criarReq('20.0.0.1', 'a@example.com'), criarReply());

  const reply = criarReply();
  await limiter(criarReq('20.0.0.2', 'b@example.com'), reply);
  assert.strictEqual(reply.statusCode, 200, 'IP diferente não deve ser bloqueado pelo limite do IP A');
});

test('login-rate-limit: emails diferentes têm contadores independentes', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(2, 60_000, prisma);

  await limiter(criarReq('30.0.0.1', 'a@example.com'), criarReply());
  await limiter(criarReq('30.0.0.1', 'a@example.com'), criarReply());

  const reply = criarReply();
  await limiter(criarReq('30.0.0.1', 'b@example.com'), reply);
  assert.strictEqual(reply.statusCode, 200, 'Email diferente não deve ser bloqueado pelo limite do email A');
});

test('login-rate-limit: tentativas fora da janela de tempo não contam', async () => {
  const prisma = criarPrismaMock();
  const windowMs = 60_000;
  const limiter = createLoginRateLimiter(2, windowMs, prisma);

  const ip = '40.0.0.1';
  const email = 'velho@example.com';
  const antiga = new Date(Date.now() - windowMs - 1000);

  await prisma.loginAttempt.create({ data: { ip, email, sucesso: false, createdAt: antiga } });
  await prisma.loginAttempt.create({ data: { ip, email, sucesso: false, createdAt: antiga } });

  const reply = criarReply();
  await limiter(criarReq(ip, email), reply);
  assert.strictEqual(reply.statusCode, 200, 'Tentativas fora da janela não devem contar');
});

test('login-rate-limit: Retry-After é definido quando bloqueado', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(1, 60_000, prisma);

  await limiter(criarReq('50.0.0.1', 'mesmo@example.com'), criarReply());

  const reply = criarReply();
  await limiter(criarReq('50.0.0.1', 'mesmo@example.com'), reply);

  assert.strictEqual(reply.statusCode, 429);
  assert.ok(reply.headers['Retry-After'], 'Retry-After header deve estar presente');
  const retryAfter = parseInt(reply.headers['Retry-After'], 10);
  assert.ok(retryAfter >= 1, `Retry-After deve ser >= 1, foi ${retryAfter}`);
  assert.ok(retryAfter <= 60, `Retry-After deve ser <= 60, foi ${retryAfter}`);
});

test('login-rate-limit: sem email no corpo ainda aplica limite por IP', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(1, 60_000, prisma);

  const ip = '60.0.0.1';
  await limiter(criarReq(ip), criarReply());

  const reply = criarReply();
  await limiter(criarReq(ip), reply);

  assert.strictEqual(reply.statusCode, 429);
  assert.ok(String(reply.body.error).includes('Muitas tentativas de login'));
});

test('login-rate-limit: tentativa bem-sucedida não consome limite de falha', async () => {
  const prisma = criarPrismaMock();
  const limiter = createLoginRateLimiter(2, 60_000, prisma);

  const { registrarLoginSucesso } = await import('../src/middlewares/rateLimiter.js');

  const ip = '70.0.0.1';
  const email = 'sucesso@example.com';

  await limiter(criarReq(ip, email), criarReply());
  await registrarLoginSucesso(ip, email, prisma);

  const reply = criarReply();
  await limiter(criarReq(ip, email), reply);
  assert.strictEqual(reply.statusCode, 200, 'Tentativa bem-sucedida não deve contar como falha');
});
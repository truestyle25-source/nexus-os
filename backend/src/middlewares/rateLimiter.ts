import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

interface Bucket { count: number; resetAt: number; }

/**
 * Rate limiter em memória (mantido para rotas que não são login).
 * Usa `req.ip` como chave. Com `trustProxy: true` do Fastify, `req.ip` já
 * reflete o IP real do cliente extraído de `X-Forwarded-For` atrás de proxy.
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (bucket.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfter)).status(429).send({ error: 'Muitas tentativas. Tente novamente em instantes.' });
      return;
    }
    bucket.count += 1;
  };
}

/**
 * Rate limiter persistente para tentativas de login.
 * Armazena cada tentativa no banco de dados (tabela `LoginAttempt`), de modo
 * que o contador sobreviva a reinícios do servidor e seja compartilhado por
 * todas as instâncias atrás de um load balancer.
 *
 * A chave de rate limit é composta por IP + email, de modo que:
 *  - Um IP não pode bloquear tentativas de outro email (importante atrás de
 *    proxy onde vários usuários compartilham o mesmo IP).
 *  - Um email não pode ser atacado de vários IPs simultaneamente sem que cada
 *    IP tenha seu próprio contador.
 *
 * Com `trustProxy: true`, `req.ip` já contém o IP real do cliente.
 */
export function createLoginRateLimiter(
  maxRequests: number,
  windowMs: number,
  prismaClient: typeof prisma = prisma,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const ip = req.ip || 'unknown';
    const body = req.body as { email?: string } | undefined;
    const email = body?.email ? String(body.email).toLowerCase().trim() : null;
    const now = Date.now();
    const windowStart = new Date(now - windowMs);

    const baseWhere: any = {
      sucesso: false,
      createdAt: { gte: windowStart },
    };

    // 1. Limite por combinação (ip, email) — evita que um IP esgote o limite
    //    de todos os emails atrás de um mesmo proxy (Vercel).
    if (email) {
      const attemptsIpEmail = await prismaClient.loginAttempt.count({
        where: { ...baseWhere, ip, email },
      });
      if (attemptsIpEmail >= maxRequests) {
        const oldest = await prismaClient.loginAttempt.findFirst({
          where: { ...baseWhere, ip, email },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        const retryAfter = oldest
          ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + windowMs - now) / 1000))
          : Math.max(1, Math.ceil(windowMs / 1000));
        reply.header('Retry-After', String(retryAfter));
        reply.status(429).send({ error: 'Muitas tentativas de login. Tente novamente em instantes.' });
        return;
      }
    }

    // 2. Limite por email (independentemente do IP) — evita brute force contra
    //    um email específico vindo de muitos IPs diferentes.
    if (email) {
      const attemptsEmail = await prismaClient.loginAttempt.count({
        where: { ...baseWhere, email },
      });
      if (attemptsEmail >= maxRequests) {
        const oldest = await prismaClient.loginAttempt.findFirst({
          where: { ...baseWhere, email },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        const retryAfter = oldest
          ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + windowMs - now) / 1000))
          : Math.max(1, Math.ceil(windowMs / 1000));
        reply.header('Retry-After', String(retryAfter));
        reply.status(429).send({ error: 'Muitas tentativas de login. Tente novamente em instantes.' });
        return;
      }
    }

    // 3. Sem email: limita apenas por IP (caso raro, body malformado).
    if (!email) {
      const attemptsIp = await prismaClient.loginAttempt.count({
        where: { ...baseWhere, ip },
      });
      if (attemptsIp >= maxRequests) {
        const oldest = await prismaClient.loginAttempt.findFirst({
          where: { ...baseWhere, ip },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        const retryAfter = oldest
          ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + windowMs - now) / 1000))
          : Math.max(1, Math.ceil(windowMs / 1000));
        reply.header('Retry-After', String(retryAfter));
        reply.status(429).send({ error: 'Muitas tentativas de login. Tente novamente em instantes.' });
        return;
      }
    }

    // Registra a tentativa (será marcada como sucesso ou falha pelo handler da rota)
    await prismaClient.loginAttempt.create({
      data: {
        ip,
        email: email ?? undefined,
        sucesso: false,
      },
    });
  };
}

/**
 * Marca uma tentativa de login como bem-sucedida no banco de dados.
 * Deve ser chamado após um login bem-sucedido para registrar a tentativa
 * como `sucesso: true` (útil para auditoria e limpeza futura).
 */
export async function registrarLoginSucesso(
  ip: string,
  email: string | null | undefined,
  prismaClient: typeof prisma = prisma,
): Promise<void> {
  if (!email) return;
  await prismaClient.loginAttempt.create({
    data: {
      ip,
      email: email.toLowerCase().trim(),
      sucesso: true,
    },
  });
}

/**
 * Limpa tentativas de login antigas (mais velhas que `olderThanMs`).
 * Útil para rodar periodicamente e evitar crescimento indefinido da tabela.
 */
export async function limparLoginAttemptsAntigos(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
}


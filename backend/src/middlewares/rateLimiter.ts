import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { comoSistema } from '../lib/tenant-context.js';
import { ipDoCliente } from '../lib/client-ip.js';
import { logDe } from '../lib/logger.js';

const log = logDe('rate-limit');

/**
 * Incrementa, de forma ATÔMICA, o contador da janela fixa de `chave` e devolve
 * o valor depois do incremento. Um único comando SQL (INSERT ... ON CONFLICT),
 * então duas instâncias que contam ao mesmo tempo nunca perdem incremento.
 */
export async function incrementarJanela(chave: string, windowMs: number, agora = Date.now()): Promise<{ contador: number; fimJanela: number }> {
  const inicio = Math.floor(agora / windowMs) * windowMs;
  const fimJanela = inicio + windowMs;
  const linhas = await comoSistema('rate-limit:contar', () => prisma.$queryRaw<{ contador: number }[]>`
    INSERT INTO "RateLimitJanela" ("chave", "janelaInicio", "contador", "expiraEm")
    VALUES (${chave}, ${new Date(inicio)}, 1, ${new Date(fimJanela)})
    ON CONFLICT ("chave", "janelaInicio")
    DO UPDATE SET "contador" = "RateLimitJanela"."contador" + 1
    RETURNING "contador"`);
  // Limpeza oportunista das janelas vencidas (~1 a cada 200 chamadas), sem bloquear a requisição.
  if (Math.random() < 0.005) {
    void comoSistema('rate-limit:limpar', () => prisma.rateLimitJanela.deleteMany({ where: { expiraEm: { lt: new Date(agora) } } }))
      .catch((err) => log.warn({ err }, 'falha ao limpar janelas vencidas de rate limit'));
  }
  return { contador: Number(linhas[0]?.contador ?? 1), fimJanela };
}

/**
 * Rate limiter distribuído (janela fixa), persistido no banco (`RateLimitJanela`).
 *
 * - Compartilhado por TODAS as instâncias do backend e preservado em reinícios
 *   (antes era um `Map` em memória por processo).
 * - Chave: nome do limite + usuário autenticado (quando o limiter roda depois de
 *   `authenticate`) ou IP do cliente (`ipDoCliente`, que respeita
 *   `TRUST_PROXY_HOPS`/`CLIENT_IP_HEADER` contra IP forjado).
 * - `chaveExtra(req)` permite limitar por outro identificador (ex.: chave de API).
 * - Se o banco falhar, a requisição SEGUE (fail-open) e o erro vai para o log:
 *   indisponibilidade do contador não pode derrubar o sistema inteiro.
 */
export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
  opcoes: { nome?: string; chaveExtra?: (req: FastifyRequest) => string | null | undefined } = {},
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const nome = opcoes.nome ?? `${req.method}:${req.routeOptions?.url ?? req.url.split('?')[0]}`;
    const usuarioId = (req as any).usuarioValidado?.id ?? (req as any).user?.id;
    const sujeito = opcoes.chaveExtra?.(req) ?? (usuarioId ? `u:${usuarioId}` : `ip:${ipDoCliente(req)}`);
    const chave = `${nome}|${sujeito}`.slice(0, 300);
    let resultado: { contador: number; fimJanela: number };
    try {
      resultado = await incrementarJanela(chave, windowMs);
    } catch (err) {
      req.log.warn({ err, limite: nome }, 'rate limit indisponível (banco); requisição liberada');
      return;
    }
    const restante = Math.max(0, maxRequests - resultado.contador);
    reply.header('X-RateLimit-Limit', String(maxRequests));
    reply.header('X-RateLimit-Remaining', String(restante));
    if (resultado.contador > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((resultado.fimJanela - Date.now()) / 1000));
      req.log.info({ limite: nome, sujeito: sujeito.startsWith('u:') ? 'usuario' : 'ip' }, 'rate limit excedido');
      reply.header('Retry-After', String(retryAfter)).status(429).send({ error: 'Muitas tentativas. Tente novamente em instantes.' });
    }
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
  // LoginAttempt não pertence a uma empresa: acesso em escopo de sistema (RLS).
  return (req: FastifyRequest, reply: FastifyReply): Promise<void> =>
    comoSistema('auth:rate-limit', () => verificarLimiteLogin(req, reply, maxRequests, windowMs, prismaClient));
}

async function verificarLimiteLogin(
  req: FastifyRequest,
  reply: FastifyReply,
  maxRequests: number,
  windowMs: number,
  prismaClient: typeof prisma,
): Promise<void> {
  {
    const ip = ipDoCliente(req);
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
  }
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
  await comoSistema('auth:registrar-login', () => prismaClient.loginAttempt.create({
    data: {
      ip,
      email: email.toLowerCase().trim(),
      sucesso: true,
    },
  }));
}

/**
 * Limpa tentativas de login antigas (mais velhas que `olderThanMs`).
 * Útil para rodar periodicamente e evitar crescimento indefinido da tabela.
 */
export async function limparLoginAttemptsAntigos(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanMs);
  await comoSistema('auth:limpar-tentativas', () => prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  }));
}


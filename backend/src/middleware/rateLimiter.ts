import type { Request, Response, NextFunction } from 'express';

/**
 * Rate limiter simples em memória, por IP, para as rotas de login/registro.
 * Em produção com múltiplas instâncias, trocar por um store compartilhado
 * (ex: Redis) — a interface abaixo já é isolada para permitir essa troca
 * sem alterar as rotas.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em instantes.' });
    }

    bucket.count += 1;
    next();
  };
}

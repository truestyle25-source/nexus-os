import type { FastifyReply, FastifyRequest } from 'fastify';
interface Bucket { count: number; resetAt: number }
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.ip || 'unknown'; const now = Date.now(); const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return; }
    if (bucket.count >= maxRequests) { const retry = Math.ceil((bucket.resetAt - now) / 1000); reply.header('Retry-After', String(retry)); return reply.status(429).send({ error: 'Muitas tentativas. Tente novamente em instantes.' }); }
    bucket.count += 1;
  };
}

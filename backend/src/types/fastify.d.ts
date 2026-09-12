import type { FastifyReply, FastifyRequest } from 'fastify';

// Formato do payload assinado no JWT (ver auth.routes.ts: app.jwt.sign(...)).
export interface AuthUserPayload {
  id: string;
  empresaId: string;
  email: string;
  jti: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUserPayload;
    // request.user, depois de jwtVerify(), inclui iat/exp além do payload.
    user: AuthUserPayload & { iat: number; exp: number };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    // Decorado em registerAuthentication() (src/middlewares/auth.ts).
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

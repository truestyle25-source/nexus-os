import type { Request, Response, NextFunction } from 'express';
import { verifyJwt, JwtError } from '../auth/jwt.js';

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    companyId: string;
    roleId: string;
  };
}

export function authMiddleware(jwtSecret: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de acesso ausente' });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.length === 0) {
      return res.status(401).json({ error: 'Token de acesso inválido' });
    }
    try {
      const payload = verifyJwt(token, jwtSecret, 'access');
      req.auth = { userId: payload.sub, companyId: payload.companyId, roleId: payload.roleId };
      next();
    } catch (err) {
      if (err instanceof JwtError) {
        return res.status(401).json({ error: err.message });
      }
      next(err);
    }
  };
}

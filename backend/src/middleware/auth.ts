import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request { user?: any; }

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token nao fornecido' });
  const [, token] = authHeader.split(' ');
  if (!token) return res.status(401).json({ error: 'Token mal formatado' });
  try {
    const secret = process.env.JWT_SECRET || 'nexus-os-secret-key';
    const decoded = jwt.verify(token, secret) as any;
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
};

export const auth = authMiddleware;
export const authenticate = authMiddleware;
export const verifyAuth = authMiddleware;
export default authMiddleware;

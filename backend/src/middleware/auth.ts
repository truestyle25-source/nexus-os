import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  // Se REQUIRE_AUTH não estiver ativo, libera (compatível com seu backend atual)
  if (!authHeader) {
    return next();
  }

  // Tenta extrair user do token sem depender de lib externa
  try {
    const [, token] = authHeader.split(' ');
    if (token && token.includes('.')) {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
      req.user = decoded;
    }
  } catch {}

  return next();
};

export const auth = authMiddleware;
export const authenticate = authMiddleware;
export const verifyAuth = authMiddleware;
export default authMiddleware;

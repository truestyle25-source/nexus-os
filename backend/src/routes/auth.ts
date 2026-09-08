import { Router } from 'express';
import type { Request, Response } from 'express';
import { AuthService, AuthError } from '../services/authService.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';

export function buildAuthRoutes(authService: AuthService): Router {
  const router = Router();
  const loginLimiter = createRateLimiter(10, 60_000);   // 10 tentativas/minuto/IP
  const registerLimiter = createRateLimiter(5, 60_000);  // 5 cadastros/minuto/IP

  router.post('/register', registerLimiter, async (req: Request, res: Response) => {
    try {
      const { companyName, cnpj, responsibleName, email, password, confirmPassword } = req.body ?? {};
      if (!companyName || !cnpj || !responsibleName || !email || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos' });
      }
      const result = await authService.registerCompany({
        companyName, cnpj, responsibleName, email, password, confirmPassword,
        ip: req.ip ?? null,
      });
      return res.status(201).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(422).json({ error: err.message, code: err.code });
      }
      console.error('[auth/register]', err);
      return res.status(500).json({ error: 'Erro interno ao criar conta' });
    }
  });

  router.post('/login', loginLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password, companyCnpj } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
      }
      const result = await authService.login({ email, password, companyCnpj, ip: req.ip ?? null });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        const statusCode = err.code === 'MULTIPLE_COMPANIES' ? 409 : 401;
        return res.status(statusCode).json({ error: err.message, code: err.code });
      }
      console.error('[auth/login]', err);
      return res.status(500).json({ error: 'Erro interno ao autenticar' });
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token obrigatório' });
      }
      const result = await authService.refreshToken(refreshToken, {
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: err.message, code: err.code });
      }
      console.error('[auth/refresh]', err);
      return res.status(500).json({ error: 'Erro interno ao renovar sessão' });
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body ?? {};
      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token obrigatório' });
      }
      await authService.logout(refreshToken);
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof AuthError) {
        return res.status(401).json({ error: err.message, code: err.code });
      }
      console.error('[auth/logout]', err);
      return res.status(500).json({ error: 'Erro interno ao encerrar sessão' });
    }
  });

  return router;
}

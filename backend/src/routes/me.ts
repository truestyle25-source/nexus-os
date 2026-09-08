import { Router } from 'express';
import type { Response } from 'express';
import type { UserRepository, RoleRepository } from '../repositories/interfaces.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/permissions.js';

export function buildMeRoutes(jwtSecret: string, users: UserRepository, roles: RoleRepository): Router {
  const router = Router();

  router.get('/', authMiddleware(jwtSecret), async (req: AuthenticatedRequest, res: Response) => {
    const user = await users.findById(req.auth!.userId);
    const role = await roles.findById(req.auth!.roleId);
    if (!user || !role) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (user.companyId !== req.auth!.companyId || role.companyId !== req.auth!.companyId) {
      return res.status(403).json({ error: 'Sessão inválida para esta empresa' });
    }

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: { id: role.id, name: role.name, permissions: [...role.permissions] },
    });
  });

  // Exemplo de rota que exige permissão granular específica —
  // os módulos de negócio (RH, financeiro, etc.) das próximas fases
  // vão seguir exatamente este mesmo padrão de proteção.
  router.get(
    '/auditoria-exemplo',
    authMiddleware(jwtSecret),
    requirePermissionMiddleware(roles, 'auditoria', 'visualizar'),
    (_req: AuthenticatedRequest, res: Response) => {
      res.json({ ok: true, message: 'Você tem permissão para visualizar auditoria.' });
    }
  );

  return router;
}

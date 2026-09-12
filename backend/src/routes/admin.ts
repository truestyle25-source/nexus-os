import { Router } from 'express';
import type { Response } from 'express';
import { hashPassword } from '../auth/hash.js';
import type { AuditRepository, RoleRepository, UserRepository } from '../repositories/interfaces.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/permissions.js';

export function buildAdminRoutes(
  jwtSecret: string,
  users: UserRepository,
  roles: RoleRepository,
  audit: AuditRepository,
): Router {
  const router = Router();
  const authenticated = authMiddleware(jwtSecret);
  const canViewSettings = requirePermissionMiddleware(roles, 'configuracoes', 'visualizar');
  const canCreateSettings = requirePermissionMiddleware(roles, 'configuracoes', 'criar');

  router.get('/users', authenticated, canViewSettings, async (req: AuthenticatedRequest, res: Response) => {
    const companyUsers = await users.listByCompany(req.auth!.companyId);
    return res.json(companyUsers.map(({ passwordHash: _passwordHash, ...user }) => user));
  });

  router.get('/roles', authenticated, canViewSettings, async (req: AuthenticatedRequest, res: Response) => {
    const companyRoles = await roles.listByCompany(req.auth!.companyId);
    return res.json(companyRoles.map((role) => ({ ...role, permissions: [...role.permissions] })));
  });

  router.get('/audit', authenticated, canViewSettings, async (req: AuthenticatedRequest, res: Response) => {
    const requestedLimit = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50;
    return res.json(await audit.listByCompany(req.auth!.companyId, limit));
  });

  router.post('/users', authenticated, canCreateSettings, async (req: AuthenticatedRequest, res: Response) => {
    const { name, email, password, roleId, sectorId = null } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 8 || typeof roleId !== 'string') {
      return res.status(400).json({ error: 'Nome, e-mail, senha, e papel válido são obrigatórios' });
    }
    const role = await roles.findById(roleId);
    if (!role || role.companyId !== req.auth!.companyId) return res.status(422).json({ error: 'Papel inválido para esta empresa' });
    const normalizedEmail = email.trim().toLowerCase();
    if ((await users.findByEmailAcrossCompanies(normalizedEmail)).length > 0) return res.status(409).json({ error: 'Este e-mail já está em uso' });
    const user = await users.create({ companyId: req.auth!.companyId, sectorId, roleId, name: name.trim(), email: normalizedEmail, passwordHash: hashPassword(password), status: 'active' });
    await audit.record({ companyId: req.auth!.companyId, userId: req.auth!.userId, action: 'create', entity: 'users', entityId: user.id, oldValue: null, newValue: { name: user.name, email: user.email, roleId: user.roleId }, origin: 'manual', ip: req.ip ?? null });
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return res.status(201).json(safeUser);
  });

  return router;
}
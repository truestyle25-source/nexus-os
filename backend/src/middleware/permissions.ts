import type { Response, NextFunction } from 'express';
import type { RoleRepository } from '../repositories/interfaces.js';
import type { ModuleName, PermissionAction } from '../domain/types.js';
import { hasPermission } from '../domain/permissions.js';
import type { AuthenticatedRequest } from './auth.js';

export function requirePermissionMiddleware(roles: RoleRepository, moduleName: ModuleName, action: PermissionAction) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    const role = await roles.findById(req.auth.roleId);
    if (!role) {
      return res.status(403).json({ error: 'Papel de usuário não encontrado' });
    }
    if (role.companyId !== req.auth.companyId) {
      return res.status(403).json({ error: 'Papel de usuário não pertence à empresa autenticada' });
    }
    if (!hasPermission(role, moduleName, action)) {
      return res.status(403).json({ error: `Sem permissão para ${action} em ${moduleName}` });
    }
    next();
  };
}

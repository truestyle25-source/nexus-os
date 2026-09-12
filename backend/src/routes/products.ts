import { Router } from 'express';
import type { Response } from 'express';
import type { AuditRepository, ProductRepository, RoleRepository } from '../repositories/interfaces.js';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/permissions.js';

export function buildProductRoutes(jwtSecret: string, products: ProductRepository, roles: RoleRepository, audit: AuditRepository): Router {
  const router = Router();
  const authenticated = authMiddleware(jwtSecret);
  const canView = requirePermissionMiddleware(roles, 'produtos', 'visualizar');
  const canCreate = requirePermissionMiddleware(roles, 'produtos', 'criar');
  const canMoveStock = requirePermissionMiddleware(roles, 'estoque', 'editar');

  router.get('/', authenticated, canView, async (req: AuthenticatedRequest, res: Response) => {
    return res.json(await products.listByCompany(req.auth!.companyId));
  });

  router.post('/', authenticated, canCreate, async (req: AuthenticatedRequest, res: Response) => {
    const { name, sku, barcode = null, cost = 0, salePrice = 0, unit = 'un', minimumStock = 0, maximumStock = null } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || typeof sku !== 'string' || sku.trim().length < 1) {
      return res.status(400).json({ error: 'Nome e SKU são obrigatórios' });
    }
    if (![cost, salePrice, minimumStock].every((value) => typeof value === 'number' && value >= 0) || (maximumStock !== null && (typeof maximumStock !== 'number' || maximumStock < 0))) {
      return res.status(400).json({ error: 'Custos e limites de estoque devem ser números não negativos' });
    }
    try {
      const product = await products.create({ companyId: req.auth!.companyId, name: name.trim(), sku: sku.trim(), barcode, cost, salePrice, unit, currentStock: 0, minimumStock, maximumStock, status: 'active' });
      await audit.record({ companyId: req.auth!.companyId, userId: req.auth!.userId, action: 'create', entity: 'products', entityId: product.id, oldValue: null, newValue: product, origin: 'manual', ip: req.ip ?? null });
      return res.status(201).json(product);
    } catch (error) {
      if (error instanceof Error && error.message.includes('SKU')) return res.status(409).json({ error: error.message });
      throw error;
    }
  });

  router.post('/:id/movements', authenticated, canMoveStock, async (req: AuthenticatedRequest, res: Response) => {
    const { quantity, type, reason = null } = req.body ?? {};
    const validTypes = ['entry', 'exit', 'adjustment', 'loss', 'return'];
    if (typeof quantity !== 'number' || quantity <= 0 || !validTypes.includes(type)) return res.status(400).json({ error: 'Quantidade positiva e tipo de movimentação válido são obrigatórios' });
    const signedQuantity = ['exit', 'loss'].includes(type) ? -quantity : quantity;
    try {
      const movement = await products.recordMovement({ companyId: req.auth!.companyId, productId: req.params.id, userId: req.auth!.userId, quantity: signedQuantity, type, reason, origin: 'manual' });
      await audit.record({ companyId: req.auth!.companyId, userId: req.auth!.userId, action: 'create', entity: 'inventory_movements', entityId: movement.id, oldValue: null, newValue: movement, origin: 'manual', ip: req.ip ?? null });
      return res.status(201).json(movement);
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : 'Movimentação inválida' });
    }
  });

  return router;
}
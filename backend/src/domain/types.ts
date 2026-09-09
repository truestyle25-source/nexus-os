export type PermissionAction = 'visualizar' | 'criar' | 'editar' | 'excluir' | 'exportar';

export const MODULES = [
  'dashboard', 'produtos', 'estoque', 'compras', 'fornecedores', 'clientes',
  'vendas', 'pdv', 'financeiro', 'dre', 'roi', 'ticket_medio', 'metas', 'rh',
  'ponto', 'auditoria', 'relatorios', 'alertas', 'integracoes', 'ia', 'configuracoes',
] as const;
export type ModuleName = typeof MODULES[number];

export interface Company {
  id: string;
  name: string;
  cnpj: string; // sempre normalizado: só dígitos
  status: 'trial' | 'active' | 'suspended' | 'cancelled';
  trialEndsAt: string;
  createdAt: string;
}

export interface Role {
  id: string;
  companyId: string;
  name: string;
  isSystem: boolean;
  permissions: Set<`${ModuleName}:${PermissionAction}`>;
}

export interface User {
  id: string;
  companyId: string;
  sectorId: string | null;
  roleId: string;
  name: string;
  email: string; // normalizado para minúsculas
  passwordHash: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  refreshHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  companyId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  origin: 'manual' | 'importado' | 'api' | 'automatico';
  ip: string | null;
  createdAt: string;
}

export interface Product {
  id: string;
  companyId: string;
  name: string;
  sku: string;
  barcode: string | null;
  cost: number;
  salePrice: number;
  unit: string;
  currentStock: number;
  minimumStock: number;
  maximumStock: number | null;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export type InventoryMovementType = 'entry' | 'exit' | 'adjustment' | 'loss' | 'return';

export interface InventoryMovement {
  id: string;
  companyId: string;
  productId: string;
  userId: string | null;
  quantity: number;
  type: InventoryMovementType;
  reason: string | null;
  origin: string;
  createdAt: string;
}

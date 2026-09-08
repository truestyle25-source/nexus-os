import type { ModuleName, PermissionAction, Role } from './types.js';

/**
 * Checa se um papel (role) tem permissão pra executar uma ação
 * em um módulo específico. Ex: hasPermission(role, 'vendas', 'excluir').
 *
 * Regra do NEXUS OS: permissão é sempre granular por módulo+ação,
 * nunca "tudo ou nada" por perfil.
 */
export function hasPermission(role: Role, moduleName: ModuleName, action: PermissionAction): boolean {
  return role.permissions.has(`${moduleName}:${action}`);
}

/**
 * Lança erro se a permissão não existir — uso em middlewares/serviços
 * que precisam interromper a operação (fail-closed: por padrão, nega).
 */
export class PermissionDeniedError extends Error {
  constructor(moduleName: ModuleName, action: PermissionAction) {
    super(`Acesso negado: sem permissão para ${action} em ${moduleName}`);
    this.name = 'PermissionDeniedError';
  }
}

export function requirePermission(role: Role, moduleName: ModuleName, action: PermissionAction): void {
  if (!hasPermission(role, moduleName, action)) {
    throw new PermissionDeniedError(moduleName, action);
  }
}

/**
 * Papéis padrão criados automaticamente para toda empresa nova.
 * O admin tem tudo; os demais seguem o princípio de menor privilégio.
 */
export function buildDefaultRolePermissions(): Record<string, Array<`${ModuleName}:${PermissionAction}`>> {
  const allModules: ModuleName[] = [
    'dashboard', 'produtos', 'estoque', 'compras', 'fornecedores', 'clientes',
    'vendas', 'pdv', 'financeiro', 'dre', 'roi', 'ticket_medio', 'metas', 'rh',
    'ponto', 'auditoria', 'relatorios', 'alertas', 'integracoes', 'ia', 'configuracoes',
  ];
  const allActions: PermissionAction[] = ['visualizar', 'criar', 'editar', 'excluir', 'exportar'];

  const admin = allModules.flatMap((m) => allActions.map((a) => `${m}:${a}` as const));

  const gestor = allModules
    .filter((m) => m !== 'configuracoes' && m !== 'integracoes')
    .flatMap((m) => allActions.filter((a) => a !== 'excluir').map((a) => `${m}:${a}` as const));

  const rh: Array<`${ModuleName}:${PermissionAction}`> = [
    'rh:visualizar', 'rh:criar', 'rh:editar', 'rh:exportar',
    'ponto:visualizar', 'ponto:editar',
    'dashboard:visualizar',
  ];

  const financeiro: Array<`${ModuleName}:${PermissionAction}`> = [
    'financeiro:visualizar', 'financeiro:criar', 'financeiro:editar', 'financeiro:exportar',
    'dre:visualizar', 'roi:visualizar', 'ticket_medio:visualizar',
    'dashboard:visualizar',
  ];

  const estoque: Array<`${ModuleName}:${PermissionAction}`> = [
    'estoque:visualizar', 'estoque:criar', 'estoque:editar',
    'produtos:visualizar', 'compras:visualizar', 'compras:criar',
    'fornecedores:visualizar',
    'dashboard:visualizar',
  ];

  const operador: Array<`${ModuleName}:${PermissionAction}`> = [
    'vendas:visualizar', 'vendas:criar',
    'pdv:visualizar', 'pdv:criar',
    'clientes:visualizar',
    'dashboard:visualizar',
  ];

  const funcionario: Array<`${ModuleName}:${PermissionAction}`> = [
    'dashboard:visualizar',
    'ponto:visualizar',
  ];

  return { admin, gestor, rh, financeiro, estoque, operador, funcionario };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, requirePermission, PermissionDeniedError, buildDefaultRolePermissions } from '../src/domain/permissions.js';
import type { Role } from '../src/domain/types.js';

function makeRole(perms: string[]): Role {
  return { id: 'r1', companyId: 'c1', name: 'teste', isSystem: false, permissions: new Set(perms as any) };
}

test('hasPermission retorna true quando a permissão exata existe', () => {
  const role = makeRole(['vendas:criar', 'vendas:visualizar']);
  assert.equal(hasPermission(role, 'vendas', 'criar'), true);
});

test('hasPermission retorna false quando a permissão não existe (fail-closed)', () => {
  const role = makeRole(['vendas:visualizar']);
  assert.equal(hasPermission(role, 'vendas', 'excluir'), false);
});

test('requirePermission lança PermissionDeniedError quando não autorizado', () => {
  const role = makeRole(['estoque:visualizar']);
  assert.throws(() => requirePermission(role, 'estoque', 'excluir'), PermissionDeniedError);
});

test('requirePermission não lança quando autorizado', () => {
  const role = makeRole(['estoque:visualizar']);
  assert.doesNotThrow(() => requirePermission(role, 'estoque', 'visualizar'));
});

test('cenário do prompt: usuário vê vendas mas não pode excluir', () => {
  const role = makeRole(['vendas:visualizar', 'vendas:criar', 'vendas:editar']);
  assert.equal(hasPermission(role, 'vendas', 'visualizar'), true);
  assert.equal(hasPermission(role, 'vendas', 'excluir'), false);
});

test('cenário do prompt: usuário vê estoque mas não vê custos (financeiro)', () => {
  const role = makeRole(['estoque:visualizar']);
  assert.equal(hasPermission(role, 'estoque', 'visualizar'), true);
  assert.equal(hasPermission(role, 'financeiro', 'visualizar'), false);
});

test('buildDefaultRolePermissions: admin tem todas as ações em todos os módulos', () => {
  const perms = buildDefaultRolePermissions();
  const adminRole = makeRole(perms.admin);
  assert.equal(hasPermission(adminRole, 'rh', 'excluir'), true);
  assert.equal(hasPermission(adminRole, 'configuracoes', 'editar'), true);
  assert.equal(hasPermission(adminRole, 'ia', 'visualizar'), true);
});

test('buildDefaultRolePermissions: funcionario tem acesso bem restrito', () => {
  const perms = buildDefaultRolePermissions();
  const funcRole = makeRole(perms.funcionario);
  assert.equal(hasPermission(funcRole, 'dashboard', 'visualizar'), true);
  assert.equal(hasPermission(funcRole, 'financeiro', 'visualizar'), false);
  assert.equal(hasPermission(funcRole, 'rh', 'excluir'), false);
});

test('buildDefaultRolePermissions: rh não acessa financeiro', () => {
  const perms = buildDefaultRolePermissions();
  const rhRole = makeRole(perms.rh);
  assert.equal(hasPermission(rhRole, 'rh', 'criar'), true);
  assert.equal(hasPermission(rhRole, 'financeiro', 'visualizar'), false);
});

test('buildDefaultRolePermissions: gestor não pode excluir e não acessa configurações', () => {
  const perms = buildDefaultRolePermissions();
  const gestorRole = makeRole(perms.gestor);
  assert.equal(hasPermission(gestorRole, 'vendas', 'visualizar'), true);
  assert.equal(hasPermission(gestorRole, 'vendas', 'excluir'), false);
  assert.equal(hasPermission(gestorRole, 'configuracoes', 'visualizar'), false);
});

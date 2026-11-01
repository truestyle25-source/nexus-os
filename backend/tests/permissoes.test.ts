import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULOS, ACOES, todasPermissoes } from '../src/lib/permissoes-catalogo.js';

// Substitui tests/permissions.test.ts (removido nesta rodada), que testava
// src/domain/permissions.ts e src/domain/types.ts — um desenho de
// permissões por Role/Set<string> ('modulo:acao') que NUNCA foi importado
// por nenhuma rota de produção. O sistema real usado por toda a aplicação
// é src/lib/permissoes.ts (catálogo MODULOS/ACOES) + o middleware em
// src/middlewares/auth.ts (permissaoMiddleware), que consulta a tabela
// Permissao por usuário — é isso que este arquivo testa.
//
// permissaoMiddleware e temPermissao em si dependem do Prisma Client
// (consulta ao banco) e não são testados aqui — testar essa parte exigiria
// um banco real ou mocks do Prisma, o que fica para um teste de integração
// futuro (ver DEBITO-TECNICO.md).

test('todasPermissoes gera exatamente um item por combinação módulo × ação', () => {
  const permissoes = todasPermissoes();
  assert.equal(permissoes.length, MODULOS.length * ACOES.length);
});

test('todasPermissoes inclui vendas.criar e vendas.excluir (cenário do prompt: granularidade por ação)', () => {
  const permissoes = todasPermissoes();
  assert.ok(permissoes.some((p) => p.modulo === 'vendas' && p.acao === 'criar'));
  assert.ok(permissoes.some((p) => p.modulo === 'vendas' && p.acao === 'excluir'));
});

test('MODULOS inclui os módulos centrais do prompt mestre', () => {
  for (const modulo of ['vendas', 'estoque', 'financeiro', 'rh', 'custos', 'ia', 'clientes', 'fornecedores', 'integracoes', 'api_publica']) {
    assert.ok((MODULOS as readonly string[]).includes(modulo), `MODULOS deveria incluir "${modulo}"`);
  }
});

test('nenhum módulo aparece duplicado no catálogo', () => {
  const unicos = new Set(MODULOS);
  assert.equal(unicos.size, MODULOS.length);
});

test('nenhuma ação aparece duplicada no catálogo', () => {
  const unicas = new Set(ACOES);
  assert.equal(unicas.size, ACOES.length);
});

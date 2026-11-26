// Catálogo central de módulos e ações do NEXUS OS (Seção 6 do prompt mestre).
//
// Separado de lib/permissoes.ts (que reexporta tudo daqui) para que este
// arquivo tenha ZERO dependência de Prisma/banco — o mesmo padrão que
// domain/cnpj.ts, auth/jwt.ts e lib/auth.ts já seguem, exatamente para
// que dê pra testar com node:test sem precisar de banco nem de
// @prisma/client instalado. Ver tests/permissoes.test.ts.
//
// Toda rota que usa permissaoMiddleware(modulo, acao) deve importar os tipos
// Modulo/Acao daqui (ou de lib/permissoes.ts) em vez de usar strings soltas.
// Isso existe para que um erro de digitação num módulo futuro (ex.: 'vendas'
// vs 'venda') vire um erro de compilação em vez de uma permissão que nunca
// funciona em produção.
//
// Ao adicionar um módulo novo, inclua-o em MODULOS aqui ANTES de escrever
// as rotas do módulo.
export const MODULOS = [
  'empresa',
  'usuarios',
  'produtos',
  'custos',
  'estoque',
  'compras',
  'fornecedores',
  'clientes',
  'vendas',
  'pdv',
  'financeiro',
  'dre',
  'roi',
  'metas',
  'rh',
  'ponto',
  'dashboard',
  'auditoria',
  'alertas',
  'notificacoes',
  'automacao',
  'pesquisa',
  'integracoes',
  'api_publica',
  'importacao',
  'relatorios',
  'ia',
  'assinatura',
  'fiscal',
] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACOES = ['visualizar', 'criar', 'editar', 'excluir', 'cancelar', 'administrar'] as const;
export type Acao = (typeof ACOES)[number];

/**
 * Permissões especiais: só fazem sentido em UM módulo (não entram na matriz
 * módulo × ação). São as alçadas do caixa usadas pelo PDV e pelas vendas.
 */
export const PERMISSOES_ESPECIAIS = [
  { modulo: 'pdv', acao: 'supervisor', rotulo: 'Supervisor', descricao: 'Autoriza sangria, cancelamento de item e cancelamento de venda paga.' },
  { modulo: 'vendas', acao: 'desconto_supervisor', rotulo: 'Desconto até 30%', descricao: 'Pode conceder ou autorizar descontos de até 30%.' },
  { modulo: 'vendas', acao: 'desconto_gerente', rotulo: 'Desconto acima de 30%', descricao: 'Pode conceder ou autorizar descontos maiores (alçada de gerente).' },
] as const;

export function ehPermissaoEspecial(modulo: string, acao: string): boolean {
  return PERMISSOES_ESPECIAIS.some((p) => p.modulo === modulo && p.acao === acao);
}

/**
 * Permissões concedidas integralmente ao usuário fundador no momento do
 * cadastro da empresa (/auth/register-company). É uma decisão de produto,
 * não uma limitação técnica: o fundador nasce com acesso total e pode
 * restringir usuários adicionais depois via PUT /usuarios/:id/permissoes.
 */
export function todasPermissoes(): Array<{ modulo: Modulo; acao: Acao }> {
  return MODULOS.flatMap((modulo) => ACOES.map((acao) => ({ modulo, acao })));
}

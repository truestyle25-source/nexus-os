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

/**
 * CARGOS — o que cada cargo pode fazer (tabela aprovada pelo dono em 26/11/2026).
 * Na tela a pessoa só escolhe o nome do cargo; as permissões abaixo são
 * gravadas por trás. Qualquer módulo que não aparece aqui fica BLOQUEADO
 * para o cargo (o menu esconde e o servidor recusa).
 */
export const CARGOS = ['OPERADOR', 'SUPERVISOR', 'FINANCEIRO', 'GESTOR'] as const;
export type Cargo = (typeof CARGOS)[number];
export const ROTULO_CARGO: Record<Cargo, string> = {
  OPERADOR: 'Operador',
  SUPERVISOR: 'Supervisor',
  FINANCEIRO: 'Financeiro / RH',
  GESTOR: 'Gestor',
};

type Regra = Record<string, string[]>;
const V = ['visualizar'];
const TOTAL = [...ACOES];

const BASE: Regra = { dashboard: V, alertas: V, notificacoes: V, ia: V, pesquisa: V };

const OPERADOR: Regra = {
  ...BASE,
  pdv: ['visualizar', 'criar', 'editar'], // vender, abrir/fechar o próprio caixa; desconto até 10%
  clientes: ['visualizar', 'criar'],
  produtos: V,
  estoque: V,
};

const SUPERVISOR: Regra = {
  ...OPERADOR,
  pdv: ['visualizar', 'criar', 'editar', 'supervisor'],
  vendas: ['visualizar', 'editar', 'cancelar', 'desconto_supervisor'],
  clientes: ['visualizar', 'criar', 'editar'],
  produtos: ['visualizar', 'editar'],
  estoque: ['visualizar', 'criar', 'editar'],
  compras: ['visualizar', 'criar'],
  fornecedores: V,
  relatorios: V,
  metas: V,
};

const FINANCEIRO: Regra = {
  ...BASE,
  pdv: V, // só relatórios de caixa
  vendas: V,
  clientes: V,
  produtos: V,
  estoque: V,
  custos: ['visualizar', 'editar'],
  compras: ['visualizar', 'criar', 'editar', 'administrar'], // administrar = aprovar
  fornecedores: ['visualizar', 'criar', 'editar'],
  financeiro: TOTAL,
  dre: V,
  roi: V,
  fiscal: ['visualizar', 'criar', 'editar'],
  relatorios: V,
  metas: V,
  rh: TOTAL, // salários, cadastro, Radar organizacional
  ponto: TOTAL,
  importacao: ['visualizar', 'criar'],
  auditoria: V,
  assinatura: V,
};

/** Lista de permissões (módulo/ação) de um cargo. Gestor = tudo. */
export function permissoesDoCargo(cargo: Cargo): Array<{ modulo: string; acao: string }> {
  if (cargo === 'GESTOR') {
    return [...todasPermissoes(), ...PERMISSOES_ESPECIAIS.map((p) => ({ modulo: p.modulo, acao: p.acao }))];
  }
  const regra = cargo === 'OPERADOR' ? OPERADOR : cargo === 'SUPERVISOR' ? SUPERVISOR : FINANCEIRO;
  return Object.entries(regra).flatMap(([modulo, acoes]) => acoes.map((acao) => ({ modulo, acao })));
}

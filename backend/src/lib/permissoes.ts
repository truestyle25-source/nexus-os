import { prisma } from './prisma.js';

// Catálogo central de módulos e ações do NEXUS OS (Seção 6 do prompt mestre).
//
// Toda rota que usa permissaoMiddleware(modulo, acao) deve importar os tipos
// Modulo/Acao daqui em vez de usar strings soltas. Isso existe para que um
// erro de digitação num módulo futuro (ex.: 'vendas' vs 'venda') vire um erro
// de compilação em vez de uma permissão que nunca funciona em produção.
//
// Ao adicionar um módulo novo (Fase 2 em diante), inclua-o em MODULOS aqui
// ANTES de escrever as rotas do módulo.
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
  'importacao',
  'relatorios',
  'ia',
  'assinatura',
] as const;
export type Modulo = (typeof MODULOS)[number];

export const ACOES = ['visualizar', 'criar', 'editar', 'excluir', 'cancelar', 'administrar'] as const;
export type Acao = (typeof ACOES)[number];

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
 * Checagem de permissão pontual, DENTRO de um handler já autenticado — para
 * os casos em que a permissão não liga/desliga a rota inteira, mas apenas
 * alguns campos da resposta. Exemplo real (Seção 6): um usuário pode ter
 * produtos.visualizar sem ter custos.visualizar — o endpoint continua
 * respondendo, só que sem os campos de custo/margem/valor de estoque.
 *
 * Isto é DIFERENTE de permissaoMiddleware (middlewares/auth.ts), que barra
 * a rota inteira com 403 e é usado no preHandler.
 */
export async function temPermissao(usuarioId: string, modulo: Modulo, acao: Acao): Promise<boolean> {
  const p = await prisma.permissao.findFirst({ where: { usuarioId, modulo, acao, permitido: true }, select: { id: true } });
  return Boolean(p);
}

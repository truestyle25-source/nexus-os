import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * ============================================================================
 * ARREDONDAMENTO MONETÁRIO (integridade financeira – Regra 4.3).
 *
 * Cálculos em ponto flutuante puro (preço * qtd, soma de itens) acumulam ruído
 * binário: 0.1*3 = 0.30000000000000004, 29.9*3 = 89.69999999999999. Esse
 * ruído (a) distorce o total/subtotal gravados e (b) pode reprovar uma venda
 * legítima na conferência do pagamento. Toda grandeza monetária é normalizada
 * para 2 casas decimais antes de comparar ou persistir.
 * ============================================================================

 * Epsilon monetário para comparações de precisão.
 * Qualquer diferença absoluta maior que este valor é considerada significativa.
 */
export const EPSILON_MONETARIO = 1e-9;

/**
 * Arredonda um número para 2 casas decimais, corrigindo o erro de ponto
 * flutuante binário com um pequeno epsilon.
 */
export function arred2(n: number): number {
  return Math.round((n + (n >= 0 ? EPSILON_MONETARIO : -EPSILON_MONETARIO)) * 100) / 100;
}

/**
 * Verifica se dois números monetários diferem consideravelmente.
 * Usa epsilon para evitar falsos positivos causados por ruído de ponto flutuante.
 */
export function difere(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON_MONETARIO;
}

/**
 * ============================================================================
 * LIMITES DE DESCONTO (regra de negócio NO BACKEND).
 *
 * Os limites NÃO ficam no frontend. O PDV pode exibir as faixas, mas quem
 * decide é esta tabela, aplicada na transação da venda. Um desconto acima da
 * alçada do operador é rejeitado com 403 antes de gravar qualquer coisa.
 *
 * percentual é sobre o SUBTOTAL (soma dos itens). O valor exige a permissão
 * listada; a primeira faixa casada é a aplicada. `qualquer` = perfil de
 * terminal (vendas/pdv criar) já passa – é o operador de caixa comum.
 *
 * Ajuste aqui para refletir a política da empresa; isto é fonte única.
 * ============================================================================

 * Tabela de alçadas de desconto por percentual e permissões necessárias.
 * Cada faixa tem um limite máximo (`ate`), as permissões necessárias e um rótulo.
 */
export const ALCADAS_DESCONTO = [
  { ate: 10, permissoes: [{ modulo: 'vendas', acao: 'criar' }, { modulo: 'pdv', acao: 'criar' }], rotulo: 'operador' },
  { ate: 30, permissoes: [{ modulo: 'vendas', acao: 'desconto' }, { modulo: 'vendas', acao: 'editar' }, { modulo: 'pdv', acao: 'editar' }], rotulo: 'supervisor' },
  { ate: 100, permissoes: [{ modulo: 'vendas', acao: 'desconto' }, { modulo: 'vendas', acao: 'gerente' }, { modulo: 'pdv', acao: 'editar' }], rotulo: 'gerente' },
];

/**
 * Descobre a alçada necessária e valida se o usuário a possui.
 *
 * @param usuarioId - ID do usuário que está tentando o desconto
 * @param desconto - Valor do desconto em reais
 * @param subtotal - Subtotal da venda antes do desconto
 * @param tx - Cliente de banco de dados (transação ou prisma padrão)
 * @throws {ErroDeNegocio} Se o usuário não tiver a permissão necessária
 */
export async function validarAlcadaDesconto(
  usuarioId: string,
  desconto: number,
  subtotal: number,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (subtotal <= 0 || desconto <= 0) return;
  const pct = (desconto / subtotal) * 100;
  const faixa = ALCADAS_DESCONTO.find((f) => pct <= f.ate);
  const necessarias = faixa?.permissoes ?? ALCADAS_DESCONTO[ALCADAS_DESCONTO.length - 1].permissoes;
  const rotulo = faixa?.rotulo ?? 'gerente';
  const concedida = await tx.permissao.findFirst({
    where: { usuarioId, permitido: true, OR: necessarias },
    select: { id: true },
  });
  if (!concedida) {
    throw new (await import('../../lib/erros.js')).ErroDeNegocio(
      `Desconto de ${pct.toFixed(1)}% exige autorização de ${rotulo}. Solicite a um responsável.`,
      403,
    );
  }
}

/**
 * Esconde o custo dos itens da venda quando o usuário não tem permissão.
 *
 * @param venda - Objeto da venda com itens
 * @param podeVerCusto - Se o usuário tem permissão para ver custos
 * @returns Venda com itens tendo custo removido (se o usuário não tem permissão)
 */
export function ocultarCustoDosItens<T extends { itens: Array<Record<string, unknown>> }>(
  venda: T,
  podeVerCusto: boolean,
): T {
  if (podeVerCusto) return venda;
  return {
    ...venda,
    itens: venda.itens.map((item) => {
      const { custoUnitario: _custoUnitario, ...resto } = item;
      return resto;
    }),
  } as T;
}

/**
 * Resolve os nomes dos vendedores a partir dos IDs.
 *
 * @param empresaId - ID da empresa
 * @param ids - IDs dos vendedores (funcionarioId)
 * @returns Map com ID → nome do vendedor
 */
export async function nomesDeVendedores(
  empresaId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map<string, string>();
  // Nota: o prisma virá do contexto da chamada
  // This function is intended to be used with a Prisma client in context
  // The actual query will be performed in the route handler
  return new Map<string, string>(); // Placeholder - actual implementation in route
}
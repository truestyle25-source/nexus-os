/**
 * Ferramentas gerais (Fase 01). Somente leitura, sempre filtradas pela empresa do contexto.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import type { Ferramenta } from '../tipos.js';

/** Período padrão: últimos N dias até agora. */
export function periodo(dias: number) {
  const ate = new Date();
  const de = new Date(ate.getTime() - dias * 86400_000);
  return { de, ate, descricao: `${de.toISOString().slice(0, 10)} a ${ate.toISOString().slice(0, 10)}` };
}

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;
export { arred };

export const visaoGeralEmpresa: Ferramenta<{ dias: number }> = {
  nome: 'visao_geral_empresa',
  descricao: 'Resumo da empresa: filiais ativas, produtos ativos, clientes e vendas finalizadas (quantidade e faturamento) no período.',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Período em dias até hoje (1 a 365). Padrão 30.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
  permissao: { modulo: 'dashboard', acao: 'visualizar' },
  async executar(ctx, { dias }) {
    const p = periodo(dias);
    const [filiais, produtos, clientes, vendas] = await Promise.all([
      prisma.filial.count({ where: { empresaId: ctx.empresaId, status: 'ATIVO' } }),
      prisma.produto.count({ where: { empresaId: ctx.empresaId, status: 'ATIVO' } }),
      prisma.cliente.count({ where: { empresaId: ctx.empresaId } }),
      prisma.venda.aggregate({ where: { empresaId: ctx.empresaId, status: 'FINALIZADA', createdAt: { gte: p.de, lte: p.ate } }, _count: { _all: true }, _sum: { total: true } }),
    ]);
    const faturamento = arred(Number(vendas._sum.total ?? 0));
    return { periodo: p.descricao, filiaisAtivas: filiais, produtosAtivos: produtos, clientes, vendasFinalizadas: vendas._count._all, faturamento, ticketMedio: vendas._count._all ? arred(faturamento / vendas._count._all) : 0 };
  },
};

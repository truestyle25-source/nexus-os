/**
 * Ferramentas do Agente Comercial (Fase 03) — SOMENTE LEITURA.
 * Base: vendas FINALIZADAS (canceladas/devolvidas/estornadas contadas à parte). Data da venda =
 * dataOperacional (dia de operação da filial) ou, na falta, createdAt. Margem exige a permissão
 * de custos (ferramenta separada).
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';
import { arred, periodo } from './geral.js';

const N = (v: unknown) => Number(v ?? 0);
const PERM = { modulo: 'vendas' as const, acao: 'visualizar' as const };
const pct = (atual: number, anterior: number) => (anterior ? arred(((atual - anterior) / anterior) * 100, 1) : null);

function janela(dias: number, deslocamento = 0) {
  const ate = new Date(Date.now() - deslocamento * 86400_000);
  const de = new Date(ate.getTime() - dias * 86400_000);
  return { de, ate, descricao: `${de.toISOString().slice(0, 10)} a ${ate.toISOString().slice(0, 10)}` };
}
const whereVendas = (ctx: ContextoIA, j: { de: Date; ate: Date }, filialId?: string) => ({ empresaId: ctx.empresaId, createdAt: { gte: j.de, lte: j.ate }, ...(filialId ? { filialId } : {}) });

async function totais(ctx: ContextoIA, j: { de: Date; ate: Date }, filialId?: string) {
  const [fin, outras] = await Promise.all([
    prisma.venda.aggregate({ where: { ...whereVendas(ctx, j, filialId), status: 'FINALIZADA' }, _count: { _all: true }, _sum: { total: true, desconto: true } }),
    prisma.venda.groupBy({ by: ['status'], where: { ...whereVendas(ctx, j, filialId), status: { in: ['CANCELADA', 'DEVOLVIDA', 'ESTORNADA'] } }, _count: { _all: true }, _sum: { total: true } }),
  ]);
  const qtd = fin._count._all; const fat = N(fin._sum.total);
  return { vendas: qtd, faturamento: arred(fat), ticketMedio: qtd ? arred(fat / qtd) : 0, descontos: arred(N(fin._sum.desconto)), canceladasOuDevolvidas: outras.reduce((t, o) => t + o._count._all, 0), valorCanceladoOuDevolvido: arred(outras.reduce((t, o) => t + N(o._sum.total), 0)) };
}

const filialArg = { filialId: { type: 'string' as const, description: 'ID da filial (opcional).' } };
const diasArg = (padrao: number) => ({ dias: { type: 'integer' as const, description: `Período em dias até hoje (1 a 365). Padrão ${padrao}.` } });

export const resumoVendas: Ferramenta<{ dias: number; filialId?: string }> = {
  nome: 'resumo_vendas',
  descricao: 'Vendas finalizadas do período (quantidade, faturamento, ticket médio, descontos, canceladas/devolvidas) comparadas com o período anterior de mesmo tamanho (variação %), e faturamento por forma de pagamento.',
  parametros: { type: 'object', properties: { ...diasArg(30), ...filialArg } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { dias, filialId }) {
    const atual = janela(dias); const anterior = janela(dias, dias);
    const [a, b, formas] = await Promise.all([
      totais(ctx, atual, filialId), totais(ctx, anterior, filialId),
      prisma.venda.groupBy({ by: ['formaPagamento'], where: { ...whereVendas(ctx, atual, filialId), status: 'FINALIZADA' }, _sum: { total: true }, _count: { _all: true } }),
    ]);
    return {
      periodo: atual.descricao, periodoAnterior: anterior.descricao, atual: a, anterior: b,
      variacaoFaturamentoPercentual: pct(a.faturamento, b.faturamento), variacaoVendasPercentual: pct(a.vendas, b.vendas), variacaoTicketPercentual: pct(a.ticketMedio, b.ticketMedio),
      porFormaPagamento: formas.map((f) => ({ forma: f.formaPagamento, vendas: f._count._all, faturamento: arred(N(f._sum.total)) })).sort((x, y) => y.faturamento - x.faturamento),
    };
  },
};

export const vendasPorDia: Ferramenta<{ dias: number; filialId?: string }> = {
  nome: 'vendas_por_dia',
  descricao: 'Série diária de vendas finalizadas (quantidade e faturamento) para ver tendência e dias fortes/fracos.',
  parametros: { type: 'object', properties: { ...diasArg(30), ...filialArg } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(120).default(30), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { dias, filialId }) {
    const j = janela(dias);
    const vendas = await prisma.venda.findMany({ where: { ...whereVendas(ctx, j, filialId), status: 'FINALIZADA' }, select: { total: true, createdAt: true, dataOperacional: true } });
    const porDia = new Map<string, { vendas: number; faturamento: number }>();
    for (const v of vendas) { const d = (v.dataOperacional ?? v.createdAt).toISOString().slice(0, 10); const x = porDia.get(d) ?? { vendas: 0, faturamento: 0 }; x.vendas++; x.faturamento += N(v.total); porDia.set(d, x); }
    const serie = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, x]) => ({ dia, vendas: x.vendas, faturamento: arred(x.faturamento) }));
    const melhor = serie.reduce<typeof serie[number] | null>((m, x) => (!m || x.faturamento > m.faturamento ? x : m), null);
    const pior = serie.reduce<typeof serie[number] | null>((m, x) => (!m || x.faturamento < m.faturamento ? x : m), null);
    return { periodo: j.descricao, diasComVenda: serie.length, melhorDia: melhor, piorDia: pior, serie };
  },
};

export const vendasPorProduto: Ferramenta<{ dias: number; limite: number; ordem: 'FATURAMENTO' | 'QUANTIDADE'; filialId?: string }> = {
  nome: 'vendas_por_produto',
  descricao: 'Ranking de produtos vendidos (quantidade e faturamento) com participação no faturamento e curva ABC (A = 80% do faturamento, B = próximos 15%, C = restante).',
  parametros: { type: 'object', properties: { ...diasArg(30), limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 15.' }, ordem: { type: 'string', enum: ['FATURAMENTO', 'QUANTIDADE'], description: 'Ordenação. Padrão FATURAMENTO.' }, ...filialArg } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30), limite: z.coerce.number().int().min(1).max(50).default(15), ordem: z.enum(['FATURAMENTO', 'QUANTIDADE']).default('FATURAMENTO'), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { dias, limite, ordem, filialId }) {
    const j = janela(dias);
    const g = await prisma.vendaItem.groupBy({ by: ['produtoId'], where: { venda: { ...whereVendas(ctx, j, filialId), status: 'FINALIZADA' } }, _sum: { quantidade: true, total: true } });
    const prods = await prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: g.map((x) => x.produtoId) } }, select: { id: true, nome: true, sku: true, unidade: true } });
    const nome = new Map(prods.map((p) => [p.id, p]));
    const total = g.reduce((t, x) => t + N(x._sum.total), 0);
    let acumulado = 0;
    const porFat = g.map((x) => ({ produtoId: x.produtoId, quantidade: N(x._sum.quantidade), faturamento: N(x._sum.total) })).sort((a, b) => b.faturamento - a.faturamento)
      .map((x) => { acumulado += x.faturamento; const fracao = total ? acumulado / total : 0; return { ...x, curva: fracao <= 0.8 ? 'A' : fracao <= 0.95 ? 'B' : 'C' }; });
    const itens = porFat.map((x) => ({ nome: nome.get(x.produtoId)?.nome ?? '(produto removido)', sku: nome.get(x.produtoId)?.sku ?? null, unidade: nome.get(x.produtoId)?.unidade ?? null, quantidade: arred(x.quantidade, 3), faturamento: arred(x.faturamento), participacaoPercentual: total ? arred((x.faturamento / total) * 100, 1) : 0, curva: x.curva }))
      .sort((a, b) => (ordem === 'QUANTIDADE' ? b.quantidade - a.quantidade : b.faturamento - a.faturamento));
    return { periodo: j.descricao, produtosVendidos: itens.length, faturamentoTotal: arred(total), curvaA: itens.filter((i) => i.curva === 'A').length, itens: itens.slice(0, limite) };
  },
};

export const margemPorProduto: Ferramenta<{ dias: number; limite: number; ordem: 'MAIOR_MARGEM' | 'MENOR_MARGEM'; filialId?: string }> = {
  nome: 'margem_por_produto',
  descricao: 'Margem bruta por produto no período: faturamento, custo (custo unitário gravado em cada venda × quantidade), lucro bruto e margem %. Também o total.',
  parametros: { type: 'object', properties: { ...diasArg(30), limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 15.' }, ordem: { type: 'string', enum: ['MAIOR_MARGEM', 'MENOR_MARGEM'], description: 'Ordenação pela margem %. Padrão MENOR_MARGEM.' }, ...filialArg } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30), limite: z.coerce.number().int().min(1).max(50).default(15), ordem: z.enum(['MAIOR_MARGEM', 'MENOR_MARGEM']).default('MENOR_MARGEM'), filialId: z.string().max(40).optional() }),
  permissao: { modulo: 'custos', acao: 'visualizar' },
  async executar(ctx, { dias, limite, ordem, filialId }) {
    const j = janela(dias);
    const itensVenda = await prisma.vendaItem.findMany({ where: { venda: { ...whereVendas(ctx, j, filialId), status: 'FINALIZADA' } }, select: { produtoId: true, quantidade: true, total: true, custoUnitario: true } });
    const acc = new Map<string, { fat: number; custo: number; qtd: number }>();
    for (const i of itensVenda) { const x = acc.get(i.produtoId) ?? { fat: 0, custo: 0, qtd: 0 }; x.fat += N(i.total); x.custo += N(i.custoUnitario) * N(i.quantidade); x.qtd += N(i.quantidade); acc.set(i.produtoId, x); }
    const prods = await prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: [...acc.keys()] } }, select: { id: true, nome: true, sku: true } });
    const nome = new Map(prods.map((p) => [p.id, p]));
    const itens = [...acc.entries()].map(([id, x]) => ({ nome: nome.get(id)?.nome ?? '(produto removido)', sku: nome.get(id)?.sku ?? null, quantidade: arred(x.qtd, 3), faturamento: arred(x.fat), custo: arred(x.custo), lucroBruto: arred(x.fat - x.custo), margemPercentual: x.fat ? arred(((x.fat - x.custo) / x.fat) * 100, 1) : null }))
      .sort((a, b) => (ordem === 'MAIOR_MARGEM' ? (b.margemPercentual ?? -Infinity) - (a.margemPercentual ?? -Infinity) : (a.margemPercentual ?? Infinity) - (b.margemPercentual ?? Infinity)));
    const fat = itens.reduce((t, i) => t + i.faturamento, 0); const custo = itens.reduce((t, i) => t + i.custo, 0);
    return { periodo: j.descricao, criterio: 'custo = custo unitário registrado no momento de cada venda', faturamentoTotal: arred(fat), custoTotal: arred(custo), lucroBrutoTotal: arred(fat - custo), margemBrutaPercentual: fat ? arred(((fat - custo) / fat) * 100, 1) : null, itens: itens.slice(0, limite) };
  },
};

export const vendasPorVendedor: Ferramenta<{ dias: number; filialId?: string }> = {
  nome: 'vendas_por_vendedor',
  descricao: 'Desempenho por vendedor (funcionário da venda): vendas, faturamento e ticket médio no período. Vendas sem vendedor aparecem como "Sem vendedor".',
  parametros: { type: 'object', properties: { ...diasArg(30), ...filialArg } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { dias, filialId }) {
    const j = janela(dias);
    const g = await prisma.venda.groupBy({ by: ['funcionarioId'], where: { ...whereVendas(ctx, j, filialId), status: 'FINALIZADA' }, _count: { _all: true }, _sum: { total: true } });
    const funcs = await prisma.funcionario.findMany({ where: { empresaId: ctx.empresaId, id: { in: g.map((x) => x.funcionarioId).filter(Boolean) as string[] } }, select: { id: true, nome: true } });
    const nome = new Map(funcs.map((f) => [f.id, f.nome]));
    const itens = g.map((x) => ({ vendedor: x.funcionarioId ? nome.get(x.funcionarioId) ?? '(removido)' : 'Sem vendedor', vendas: x._count._all, faturamento: arred(N(x._sum.total)), ticketMedio: x._count._all ? arred(N(x._sum.total) / x._count._all) : 0 })).sort((a, b) => b.faturamento - a.faturamento);
    return { periodo: j.descricao, vendedores: itens };
  },
};

export const clientesPrincipais: Ferramenta<{ dias: number; limite: number; inativosHaDias: number }> = {
  nome: 'clientes_principais',
  descricao: 'Clientes que mais compraram no período (vendas e faturamento) e clientes inativos (última compra há mais de N dias) com o valor histórico.',
  parametros: { type: 'object', properties: { ...diasArg(90), limite: { type: 'integer', description: 'Máximo de itens por lista (1 a 30). Padrão 10.' }, inativosHaDias: { type: 'integer', description: 'Dias sem comprar para ser inativo (15 a 365). Padrão 60.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(90), limite: z.coerce.number().int().min(1).max(30).default(10), inativosHaDias: z.coerce.number().int().min(15).max(365).default(60) }),
  permissao: { modulo: 'clientes', acao: 'visualizar' },
  async executar(ctx, { dias, limite, inativosHaDias }) {
    const j = janela(dias);
    const g = await prisma.venda.groupBy({ by: ['clienteId'], where: { ...whereVendas(ctx, j), status: 'FINALIZADA', clienteId: { not: null } }, _count: { _all: true }, _sum: { total: true } });
    const ids = g.map((x) => x.clienteId!) ;
    const clientes = await prisma.cliente.findMany({ where: { empresaId: ctx.empresaId, id: { in: ids } }, select: { id: true, nome: true } });
    const nome = new Map(clientes.map((c) => [c.id, c.nome]));
    const top = g.map((x) => ({ cliente: nome.get(x.clienteId!) ?? '(removido)', compras: x._count._all, faturamento: arred(N(x._sum.total)) })).sort((a, b) => b.faturamento - a.faturamento).slice(0, limite);
    const limiteData = new Date(Date.now() - inativosHaDias * 86400_000);
    const inativos = await prisma.cliente.findMany({ where: { empresaId: ctx.empresaId, ultimaCompra: { lt: limiteData } }, orderBy: { valorTotalComprado: 'desc' }, take: limite, select: { nome: true, ultimaCompra: true, valorTotalComprado: true } });
    const vendasSemCliente = await prisma.venda.count({ where: { ...whereVendas(ctx, j), status: 'FINALIZADA', clienteId: null } });
    return { periodo: j.descricao, principais: top, vendasSemClienteIdentificado: vendasSemCliente, inativos: inativos.map((c) => ({ cliente: c.nome, ultimaCompra: c.ultimaCompra?.toISOString().slice(0, 10) ?? null, valorTotalComprado: arred(N(c.valorTotalComprado)) })) };
  },
};

export const FERRAMENTAS_COMERCIAL = [resumoVendas, vendasPorDia, vendasPorProduto, margemPorProduto, vendasPorVendedor, clientesPrincipais];
export { janela, pct };

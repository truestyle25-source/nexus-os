/**
 * Ferramentas do Agente de Estoque e Produtos (Fase 02) — SOMENTE LEITURA.
 *
 * Todos os indicadores são CALCULADOS AQUI (giro, cobertura, sugestão de reposição, valor
 * parado, kits possíveis); o modelo só interpreta. Convenção do NEXUS: quantidade sempre
 * positiva; o tipo diz se entra (ENTRADAS) ou sai (SAIDAS) — mesma lista do estoque.service.
 * Sempre filtrado pela empresa do contexto; a filial informada é validada contra a empresa.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { ENTRADAS, SAIDAS } from '../../estoque/estoque.service.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';
import { arred, periodo } from './geral.js';

const PERM = { modulo: 'estoque' as const, acao: 'visualizar' as const };
const N = (v: unknown) => Number(v ?? 0);

async function filialValida(ctx: ContextoIA, filialId?: string | null) {
  if (!filialId) return null;
  const f = await prisma.filial.findFirst({ where: { id: filialId, empresaId: ctx.empresaId }, select: { id: true, nome: true } });
  if (!f) throw new ErroDeNegocio('Filial não encontrada nesta empresa.', 404);
  return f;
}

async function produtosPorTermo(ctx: ContextoIA, termo?: string, produtoId?: string, take = 10) {
  return prisma.produto.findMany({
    where: { empresaId: ctx.empresaId, ...(produtoId ? { id: produtoId } : termo ? { OR: [{ nome: { contains: termo, mode: 'insensitive' } }, { sku: { equals: termo, mode: 'insensitive' } }, { codigoBarras: termo }] } : {}) },
    select: { id: true, nome: true, sku: true, unidade: true, ehKit: true, status: true, custo: true, estoqueMinimo: true, pontoPedido: true, estoqueSeguranca: true, controlaEstoque: true },
    orderBy: { nome: 'asc' }, take,
  });
}

/** Saídas (quantidade) por produto no período, opcionalmente por filial. */
async function saidasPorProduto(ctx: ContextoIA, de: Date, filialId?: string | null, produtoIds?: string[]) {
  const g = await prisma.estoqueMovimentacao.groupBy({
    by: ['produtoId'], _sum: { quantidade: true },
    where: { empresaId: ctx.empresaId, tipo: { in: SAIDAS }, createdAt: { gte: de }, ...(filialId ? { filialId } : {}), ...(produtoIds ? { produtoId: { in: produtoIds } } : {}) },
  });
  return new Map(g.map((x) => [x.produtoId, N(x._sum.quantidade)]));
}

async function saldosPorProduto(ctx: ContextoIA, filialId?: string | null, produtoIds?: string[]) {
  const g = await prisma.estoque.groupBy({ by: ['produtoId'], _sum: { quantidade: true }, where: { empresaId: ctx.empresaId, ...(filialId ? { filialId } : {}), ...(produtoIds ? { produtoId: { in: produtoIds } } : {}) } });
  return new Map(g.map((x) => [x.produtoId, N(x._sum.quantidade)]));
}

const filialArg = { filialId: { type: 'string' as const, description: 'ID da filial (opcional; sem ele, todas as filiais).' } };

export const buscarProdutos: Ferramenta<{ termo: string; limite: number }> = {
  nome: 'buscar_produtos',
  descricao: 'Procura produtos por nome, SKU ou código de barras. Devolve id, nome, SKU, unidade, se é kit e o saldo total. Use para descobrir o id antes das outras ferramentas.',
  parametros: { type: 'object', properties: { termo: { type: 'string', description: 'Parte do nome, SKU ou código de barras.' }, limite: { type: 'integer', description: 'Máximo de resultados (1 a 20). Padrão 10.' } }, required: ['termo'] },
  validar: z.object({ termo: z.string().trim().min(1).max(80), limite: z.coerce.number().int().min(1).max(20).default(10) }),
  permissao: { modulo: 'produtos', acao: 'visualizar' },
  async executar(ctx, { termo, limite }) {
    const prods = await produtosPorTermo(ctx, termo, undefined, limite);
    const saldos = await saldosPorProduto(ctx, null, prods.map((p) => p.id));
    return { termo, encontrados: prods.length, produtos: prods.map((p) => ({ id: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade, ehKit: p.ehKit, status: p.status, saldoTotal: arred(saldos.get(p.id) ?? 0, 3) })) };
  },
};

export const saldoEstoque: Ferramenta<{ produtoId: string; filialId?: string }> = {
  nome: 'saldo_estoque',
  descricao: 'Saldo de um produto por filial, com estoque mínimo, ponto de pedido e situação (abaixo do mínimo / no ponto de pedido / normal).',
  parametros: { type: 'object', properties: { produtoId: { type: 'string', description: 'ID do produto (use buscar_produtos).' }, ...filialArg }, required: ['produtoId'] },
  validar: z.object({ produtoId: z.string().min(5).max(40), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { produtoId, filialId }) {
    const filial = await filialValida(ctx, filialId);
    const [p] = await produtosPorTermo(ctx, undefined, produtoId, 1);
    if (!p) return { erro: 'Produto não encontrado nesta empresa.' };
    const linhas = await prisma.estoque.findMany({ where: { empresaId: ctx.empresaId, produtoId, ...(filial ? { filialId: filial.id } : {}) }, select: { quantidade: true, filial: { select: { id: true, nome: true } } } });
    const total = linhas.reduce((t, l) => t + N(l.quantidade), 0);
    const minimo = N(p.estoqueMinimo); const ponto = N(p.pontoPedido);
    const situacao = (q: number) => (q <= minimo && minimo > 0 ? 'Abaixo do mínimo' : q <= ponto && ponto > 0 ? 'No ponto de pedido' : 'Normal');
    return { produto: { id: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade }, estoqueMinimo: minimo, pontoPedido: ponto, saldoTotal: arred(total, 3), situacaoTotal: situacao(total), porFilial: linhas.map((l) => ({ filial: l.filial.nome, filialId: l.filial.id, saldo: arred(N(l.quantidade), 3), situacao: situacao(N(l.quantidade)) })) };
  },
};

export const produtosAbaixoMinimo: Ferramenta<{ filialId?: string; limite: number }> = {
  nome: 'produtos_abaixo_minimo',
  descricao: 'Lista produtos ativos que controlam estoque com saldo no mínimo ou abaixo dele, ou no ponto de pedido, com a falta em relação ao mínimo.',
  parametros: { type: 'object', properties: { ...filialArg, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 20.' } } },
  validar: z.object({ filialId: z.string().max(40).optional(), limite: z.coerce.number().int().min(1).max(50).default(20) }),
  permissao: PERM,
  async executar(ctx, { filialId, limite }) {
    const filial = await filialValida(ctx, filialId);
    const prods = await prisma.produto.findMany({ where: { empresaId: ctx.empresaId, status: 'ATIVO', controlaEstoque: true, OR: [{ estoqueMinimo: { gt: 0 } }, { pontoPedido: { gt: 0 } }] }, select: { id: true, nome: true, sku: true, unidade: true, estoqueMinimo: true, pontoPedido: true } });
    const saldos = await saldosPorProduto(ctx, filial?.id, prods.map((p) => p.id));
    const itens = prods.map((p) => {
      const saldo = saldos.get(p.id) ?? 0; const minimo = N(p.estoqueMinimo); const ponto = N(p.pontoPedido);
      return { id: p.id, nome: p.nome, sku: p.sku, unidade: p.unidade, saldo: arred(saldo, 3), estoqueMinimo: minimo, pontoPedido: ponto, faltaParaMinimo: arred(Math.max(0, minimo - saldo), 3), situacao: saldo <= minimo && minimo > 0 ? 'Abaixo do mínimo' : 'No ponto de pedido' };
    }).filter((x) => (x.estoqueMinimo > 0 && x.saldo <= x.estoqueMinimo) || (x.pontoPedido > 0 && x.saldo <= x.pontoPedido))
      .sort((a, b) => b.faltaParaMinimo - a.faltaParaMinimo);
    return { filial: filial?.nome ?? 'todas', totalEncontrado: itens.length, itens: itens.slice(0, limite) };
  },
};

export const movimentacoesEstoque: Ferramenta<{ produtoId?: string; dias: number; filialId?: string }> = {
  nome: 'movimentacoes_estoque',
  descricao: 'Resumo das movimentações de estoque no período (por tipo: quantidade e número de lançamentos) e as últimas 15 movimentações. Pode filtrar por produto e filial.',
  parametros: { type: 'object', properties: { produtoId: { type: 'string', description: 'ID do produto (opcional).' }, dias: { type: 'integer', description: 'Período em dias (1 a 365). Padrão 30.' }, ...filialArg } },
  validar: z.object({ produtoId: z.string().max(40).optional(), dias: z.coerce.number().int().min(1).max(365).default(30), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { produtoId, dias, filialId }) {
    const filial = await filialValida(ctx, filialId);
    const p = periodo(dias);
    const where = { empresaId: ctx.empresaId, createdAt: { gte: p.de }, ...(produtoId ? { produtoId } : {}), ...(filial ? { filialId: filial.id } : {}) };
    const [porTipo, ultimas] = await Promise.all([
      prisma.estoqueMovimentacao.groupBy({ by: ['tipo'], where, _sum: { quantidade: true }, _count: { _all: true } }),
      prisma.estoqueMovimentacao.findMany({ where, orderBy: { createdAt: 'desc' }, take: 15, select: { createdAt: true, tipo: true, quantidade: true, motivo: true, produto: { select: { nome: true } }, filial: { select: { nome: true } } } }),
    ]);
    const entradas = porTipo.filter((t) => ENTRADAS.includes(t.tipo)).reduce((s, t) => s + N(t._sum.quantidade), 0);
    const saidas = porTipo.filter((t) => SAIDAS.includes(t.tipo)).reduce((s, t) => s + N(t._sum.quantidade), 0);
    return {
      periodo: p.descricao, filial: filial?.nome ?? 'todas', totalEntradas: arred(entradas, 3), totalSaidas: arred(saidas, 3),
      porTipo: porTipo.map((t) => ({ tipo: t.tipo, quantidade: arred(N(t._sum.quantidade), 3), lancamentos: t._count._all })),
      ultimas: ultimas.map((m) => ({ data: m.createdAt.toISOString().slice(0, 10), tipo: m.tipo, produto: m.produto.nome, filial: m.filial.nome, quantidade: arred(N(m.quantidade), 3), motivo: m.motivo })),
    };
  },
};

export const giroEstoque: Ferramenta<{ dias: number; filialId?: string; limite: number; ordem: 'MAIOR_GIRO' | 'MENOR_COBERTURA' }> = {
  nome: 'giro_estoque',
  descricao: 'Giro e cobertura por produto no período: saídas, saldo atual, giro (saídas ÷ saldo), consumo médio diário e dias de cobertura (saldo ÷ consumo diário).',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Período em dias (7 a 365). Padrão 30.' }, ...filialArg, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 15.' }, ordem: { type: 'string', enum: ['MAIOR_GIRO', 'MENOR_COBERTURA'], description: 'Ordenação. Padrão MAIOR_GIRO.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(7).max(365).default(30), filialId: z.string().max(40).optional(), limite: z.coerce.number().int().min(1).max(50).default(15), ordem: z.enum(['MAIOR_GIRO', 'MENOR_COBERTURA']).default('MAIOR_GIRO') }),
  permissao: PERM,
  async executar(ctx, { dias, filialId, limite, ordem }) {
    const filial = await filialValida(ctx, filialId);
    const p = periodo(dias);
    const saidas = await saidasPorProduto(ctx, p.de, filial?.id);
    const ids = [...saidas.keys()];
    const [saldos, prods] = await Promise.all([saldosPorProduto(ctx, filial?.id, ids), prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: ids } }, select: { id: true, nome: true, sku: true, unidade: true } })]);
    const itens = prods.map((pr) => {
      const s = saidas.get(pr.id) ?? 0; const saldo = saldos.get(pr.id) ?? 0; const diario = s / dias;
      return { id: pr.id, nome: pr.nome, sku: pr.sku, unidade: pr.unidade, saidas: arred(s, 3), saldo: arred(saldo, 3), giro: saldo > 0 ? arred(s / saldo) : null, consumoMedioDiario: arred(diario, 3), diasCobertura: diario > 0 ? arred(saldo / diario, 1) : null };
    }).sort((a, b) => (ordem === 'MAIOR_GIRO' ? (b.giro ?? Infinity) - (a.giro ?? Infinity) : (a.diasCobertura ?? Infinity) - (b.diasCobertura ?? Infinity)));
    return { periodo: p.descricao, filial: filial?.nome ?? 'todas', criterio: 'saídas = VENDA, SAIDA, PERDA, AVARIA, CONSUMO_INSUMO, DESCARTE', produtosComSaida: itens.length, itens: itens.slice(0, limite) };
  },
};

export const produtosParados: Ferramenta<{ dias: number; filialId?: string; limite: number }> = {
  nome: 'produtos_parados',
  descricao: 'Produtos com saldo positivo e NENHUMA saída no período, com o valor parado (saldo × custo do cadastro), ordenados pelo maior valor.',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Período sem saída, em dias (7 a 365). Padrão 60.' }, ...filialArg, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 15.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(7).max(365).default(60), filialId: z.string().max(40).optional(), limite: z.coerce.number().int().min(1).max(50).default(15) }),
  permissao: PERM,
  async executar(ctx, { dias, filialId, limite }) {
    const filial = await filialValida(ctx, filialId);
    const p = periodo(dias);
    const [saldos, saidas] = await Promise.all([saldosPorProduto(ctx, filial?.id), saidasPorProduto(ctx, p.de, filial?.id)]);
    const comSaldo = [...saldos.entries()].filter(([id, q]) => q > 0 && !saidas.has(id)).map(([id]) => id);
    const prods = await prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: comSaldo } }, select: { id: true, nome: true, sku: true, unidade: true, custo: true } });
    const itens = prods.map((pr) => { const saldo = saldos.get(pr.id) ?? 0; return { id: pr.id, nome: pr.nome, sku: pr.sku, unidade: pr.unidade, saldo: arred(saldo, 3), custoUnitario: arred(N(pr.custo), 4), valorParado: arred(saldo * N(pr.custo)) }; })
      .sort((a, b) => b.valorParado - a.valorParado);
    return { periodo: p.descricao, filial: filial?.nome ?? 'todas', totalProdutosParados: itens.length, valorTotalParado: arred(itens.reduce((t, i) => t + i.valorParado, 0)), itens: itens.slice(0, limite) };
  },
};

export const rupturas: Ferramenta<{ dias: number; filialId?: string; limite: number }> = {
  nome: 'rupturas_estoque',
  descricao: 'Produtos sem saldo (zero ou negativo) que tiveram saída no período — risco de venda perdida.',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Período de saídas consideradas (1 a 180). Padrão 30.' }, ...filialArg, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 20.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(180).default(30), filialId: z.string().max(40).optional(), limite: z.coerce.number().int().min(1).max(50).default(20) }),
  permissao: PERM,
  async executar(ctx, { dias, filialId, limite }) {
    const filial = await filialValida(ctx, filialId);
    const p = periodo(dias);
    const saidas = await saidasPorProduto(ctx, p.de, filial?.id);
    const ids = [...saidas.keys()];
    const [saldos, prods] = await Promise.all([saldosPorProduto(ctx, filial?.id, ids), prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: ids } }, select: { id: true, nome: true, sku: true, unidade: true } })]);
    const itens = prods.filter((pr) => (saldos.get(pr.id) ?? 0) <= 0).map((pr) => ({ id: pr.id, nome: pr.nome, sku: pr.sku, unidade: pr.unidade, saldo: arred(saldos.get(pr.id) ?? 0, 3), saidasNoPeriodo: arred(saidas.get(pr.id) ?? 0, 3), consumoMedioDiario: arred((saidas.get(pr.id) ?? 0) / dias, 3) }))
      .sort((a, b) => b.saidasNoPeriodo - a.saidasNoPeriodo);
    return { periodo: p.descricao, filial: filial?.nome ?? 'todas', totalEmRuptura: itens.length, itens: itens.slice(0, limite) };
  },
};

export const sugestaoReposicao: Ferramenta<{ diasCobertura: number; diasHistorico: number; filialId?: string; limite: number }> = {
  nome: 'sugestao_reposicao',
  descricao: 'Sugere quanto repor por produto: consumo médio diário (histórico) × dias de cobertura + estoque de segurança − saldo atual. Só produtos ativos que controlam estoque e tiveram saída. É sugestão: não cria pedido.',
  parametros: { type: 'object', properties: { diasCobertura: { type: 'integer', description: 'Dias que o estoque deve cobrir após a reposição (1 a 120). Padrão 15.' }, diasHistorico: { type: 'integer', description: 'Dias de histórico para o consumo médio (7 a 180). Padrão 30.' }, ...filialArg, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 20.' } } },
  validar: z.object({ diasCobertura: z.coerce.number().int().min(1).max(120).default(15), diasHistorico: z.coerce.number().int().min(7).max(180).default(30), filialId: z.string().max(40).optional(), limite: z.coerce.number().int().min(1).max(50).default(20) }),
  permissao: PERM,
  async executar(ctx, { diasCobertura, diasHistorico, filialId, limite }) {
    const filial = await filialValida(ctx, filialId);
    const p = periodo(diasHistorico);
    const saidas = await saidasPorProduto(ctx, p.de, filial?.id);
    const ids = [...saidas.keys()];
    const [saldos, prods] = await Promise.all([saldosPorProduto(ctx, filial?.id, ids), prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: ids }, status: 'ATIVO', controlaEstoque: true }, select: { id: true, nome: true, sku: true, unidade: true, estoqueSeguranca: true, custo: true } })]);
    const itens = prods.map((pr) => {
      const diario = (saidas.get(pr.id) ?? 0) / diasHistorico; const saldo = saldos.get(pr.id) ?? 0; const seguranca = N(pr.estoqueSeguranca);
      const sugerido = Math.max(0, Math.ceil(diario * diasCobertura + seguranca - saldo));
      return { id: pr.id, nome: pr.nome, sku: pr.sku, unidade: pr.unidade, saldo: arred(saldo, 3), consumoMedioDiario: arred(diario, 3), estoqueSeguranca: seguranca, quantidadeSugerida: sugerido, custoEstimado: arred(sugerido * N(pr.custo)) };
    }).filter((i) => i.quantidadeSugerida > 0).sort((a, b) => b.custoEstimado - a.custoEstimado);
    return { historico: p.descricao, diasCobertura, filial: filial?.nome ?? 'todas', formula: 'ceil(consumo médio diário × dias de cobertura + estoque de segurança − saldo)', totalItens: itens.length, custoTotalEstimado: arred(itens.reduce((t, i) => t + i.custoEstimado, 0)), itens: itens.slice(0, limite) };
  },
};

export const composicaoKit: Ferramenta<{ produtoId: string; filialId?: string }> = {
  nome: 'composicao_kit',
  descricao: 'Ficha de um kit/receita: ingredientes, quantidade por kit, saldo de cada ingrediente e quantos kits dá para montar com o estoque atual (limitado pelo ingrediente mais escasso).',
  parametros: { type: 'object', properties: { produtoId: { type: 'string', description: 'ID do produto do tipo kit.' }, ...filialArg }, required: ['produtoId'] },
  validar: z.object({ produtoId: z.string().min(5).max(40), filialId: z.string().max(40).optional() }),
  permissao: PERM,
  async executar(ctx, { produtoId, filialId }) {
    const filial = await filialValida(ctx, filialId);
    const kit = await prisma.produto.findFirst({ where: { id: produtoId, empresaId: ctx.empresaId }, select: { id: true, nome: true, ehKit: true } });
    if (!kit) return { erro: 'Produto não encontrado nesta empresa.' };
    if (!kit.ehKit) return { produto: kit.nome, ehKit: false, observacao: 'O produto não é um kit.' };
    const comp = await prisma.composicaoKit.findMany({ where: { empresaId: ctx.empresaId, kitProdutoId: kit.id }, orderBy: { ordem: 'asc' }, select: { quantidadePorKit: true, ingredienteProduto: { select: { id: true, nome: true, unidade: true } } } });
    const saldos = await saldosPorProduto(ctx, filial?.id, comp.map((c) => c.ingredienteProduto.id));
    const ingredientes = comp.map((c) => { const q = N(c.quantidadePorKit); const saldo = saldos.get(c.ingredienteProduto.id) ?? 0; return { ingrediente: c.ingredienteProduto.nome, unidade: c.ingredienteProduto.unidade, quantidadePorKit: arred(q, 4), saldo: arred(saldo, 3), kitsPossiveis: q > 0 ? Math.max(0, Math.floor(saldo / q)) : null }; });
    const possiveis = ingredientes.map((i) => i.kitsPossiveis).filter((x): x is number => x !== null);
    const limitante = ingredientes.reduce<typeof ingredientes[number] | null>((m, i) => (i.kitsPossiveis !== null && (m === null || i.kitsPossiveis < (m.kitsPossiveis ?? Infinity)) ? i : m), null);
    return { produto: kit.nome, filial: filial?.nome ?? 'todas', ingredientes, kitsMontaveis: possiveis.length ? Math.min(...possiveis) : 0, ingredienteLimitante: limitante?.ingrediente ?? null };
  },
};

export const FERRAMENTAS_ESTOQUE = [buscarProdutos, saldoEstoque, produtosAbaixoMinimo, movimentacoesEstoque, giroEstoque, produtosParados, rupturas, sugestaoReposicao, composicaoKit];

/**
 * Ferramentas do Agente de Compras (Fase 03) — SOMENTE LEITURA.
 * Base: pedidos de compra (Compra/CompraItem), vínculo fornecedor × produto (preço de
 * referência e prazo) e histórico de preços. Sugestões não criam pedido.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import type { Ferramenta } from '../tipos.js';
import { arred } from './geral.js';
import { janela, pct } from './comercial.js';

const N = (v: unknown) => Number(v ?? 0);
const PERM = { modulo: 'compras' as const, acao: 'visualizar' as const };
const ABERTAS = ['APROVADA', 'ENVIADA', 'PEDIDO', 'PARCIAL'] as const;

export const resumoCompras: Ferramenta<{ dias: number }> = {
  nome: 'resumo_compras',
  descricao: 'Compras do período por status (quantidade e valor), total comprado, principais fornecedores por valor e pedidos ainda não recebidos.',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Período em dias (1 a 365). Padrão 30.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
  permissao: PERM,
  async executar(ctx, { dias }) {
    const j = janela(dias);
    const where = { empresaId: ctx.empresaId, dataCompra: { gte: j.de, lte: j.ate } };
    const [porStatus, porFornecedor] = await Promise.all([
      prisma.compra.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { valorTotal: true } }),
      prisma.compra.groupBy({ by: ['fornecedorId'], where: { ...where, status: { notIn: ['CANCELADA', 'RASCUNHO'] } }, _count: { _all: true }, _sum: { valorTotal: true } }),
    ]);
    const forn = await prisma.fornecedor.findMany({ where: { empresaId: ctx.empresaId, id: { in: porFornecedor.map((f) => f.fornecedorId) } }, select: { id: true, nome: true } });
    const nome = new Map(forn.map((f) => [f.id, f.nome]));
    const comprado = porStatus.filter((s) => !['CANCELADA', 'RASCUNHO'].includes(s.status)).reduce((t, s) => t + N(s._sum.valorTotal), 0);
    return {
      periodo: j.descricao, totalComprado: arred(comprado),
      porStatus: porStatus.map((s) => ({ status: s.status, pedidos: s._count._all, valor: arred(N(s._sum.valorTotal)) })),
      principaisFornecedores: porFornecedor.map((f) => ({ fornecedor: nome.get(f.fornecedorId) ?? '(removido)', pedidos: f._count._all, valor: arred(N(f._sum.valorTotal)) })).sort((a, b) => b.valor - a.valor).slice(0, 10),
    };
  },
};

export const comprasPendentes: Ferramenta<{ limite: number }> = {
  nome: 'compras_pendentes',
  descricao: 'Pedidos de compra aprovados/enviados/confirmados/parciais ainda não recebidos por completo, com previsão de entrega e dias de atraso.',
  parametros: { type: 'object', properties: { limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 20.' } } },
  validar: z.object({ limite: z.coerce.number().int().min(1).max(50).default(20) }),
  permissao: PERM,
  async executar(ctx, { limite }) {
    const agora = new Date();
    const compras = await prisma.compra.findMany({ where: { empresaId: ctx.empresaId, status: { in: [...ABERTAS] } }, orderBy: [{ previsaoEntrega: 'asc' }], take: limite, select: { numero: true, status: true, valorTotal: true, previsaoEntrega: true, fornecedor: { select: { nome: true } } } });
    const total = await prisma.compra.aggregate({ where: { empresaId: ctx.empresaId, status: { in: [...ABERTAS] } }, _count: { _all: true }, _sum: { valorTotal: true } });
    const itens = compras.map((c) => ({ pedido: c.numero ? `CP-${String(c.numero).padStart(6, '0')}` : null, fornecedor: c.fornecedor.nome, status: c.status, valor: arred(N(c.valorTotal)), previsaoEntrega: c.previsaoEntrega?.toISOString().slice(0, 10) ?? null, diasDeAtraso: c.previsaoEntrega && c.previsaoEntrega < agora ? Math.floor((agora.getTime() - c.previsaoEntrega.getTime()) / 86400_000) : 0 }));
    return { pedidosEmAberto: total._count._all, valorEmAberto: arred(N(total._sum.valorTotal)), atrasados: itens.filter((i) => i.diasDeAtraso > 0).length, itens };
  },
};

export const historicoCustoProduto: Ferramenta<{ produtoId: string; dias: number }> = {
  nome: 'historico_custo_produto',
  descricao: 'Evolução do preço pago por um produto nas compras do período (data, fornecedor, preço unitário), primeiro × último preço e variação %, e o custo atual do cadastro.',
  parametros: { type: 'object', properties: { produtoId: { type: 'string', description: 'ID do produto (use buscar_produtos).' }, dias: { type: 'integer', description: 'Período em dias (30 a 730). Padrão 180.' } }, required: ['produtoId'] },
  validar: z.object({ produtoId: z.string().min(5).max(40), dias: z.coerce.number().int().min(30).max(730).default(180) }),
  permissao: { modulo: 'custos', acao: 'visualizar' },
  async executar(ctx, { produtoId, dias }) {
    const j = janela(dias);
    const produto = await prisma.produto.findFirst({ where: { id: produtoId, empresaId: ctx.empresaId }, select: { nome: true, unidade: true, custo: true } });
    if (!produto) return { erro: 'Produto não encontrado nesta empresa.' };
    const itens = await prisma.compraItem.findMany({ where: { produtoId, compra: { empresaId: ctx.empresaId, dataCompra: { gte: j.de, lte: j.ate }, status: { notIn: ['CANCELADA', 'RASCUNHO'] } } }, orderBy: { compra: { dataCompra: 'asc' } }, select: { valorUnit: true, quantidade: true, unidadeCompra: true, compra: { select: { dataCompra: true, fornecedor: { select: { nome: true } } } } } });
    const compras = itens.map((i) => ({ data: i.compra.dataCompra.toISOString().slice(0, 10), fornecedor: i.compra.fornecedor.nome, precoUnitario: arred(N(i.valorUnit), 4), quantidade: arred(N(i.quantidade), 3), unidade: i.unidadeCompra ?? produto.unidade }));
    const primeiro = compras[0]?.precoUnitario ?? null; const ultimo = compras[compras.length - 1]?.precoUnitario ?? null;
    return { produto: produto.nome, periodo: j.descricao, custoAtualCadastro: arred(N(produto.custo), 4), compras, primeiroPreco: primeiro, ultimoPreco: ultimo, variacaoPercentual: primeiro !== null && ultimo !== null ? pct(ultimo, primeiro) : null };
  },
};

export const compararFornecedores: Ferramenta<{ produtoId: string }> = {
  nome: 'comparar_fornecedores',
  descricao: 'Compara os fornecedores de um produto: preço de referência e último preço pago no vínculo, preço médio e número de compras nos últimos 365 dias, prazo de entrega e pedido mínimo. Indica o menor último preço.',
  parametros: { type: 'object', properties: { produtoId: { type: 'string', description: 'ID do produto (use buscar_produtos).' } }, required: ['produtoId'] },
  validar: z.object({ produtoId: z.string().min(5).max(40) }),
  permissao: { modulo: 'fornecedores', acao: 'visualizar' },
  async executar(ctx, { produtoId }) {
    const produto = await prisma.produto.findFirst({ where: { id: produtoId, empresaId: ctx.empresaId }, select: { nome: true } });
    if (!produto) return { erro: 'Produto não encontrado nesta empresa.' };
    const [vinculos, itens] = await Promise.all([
      prisma.fornecedorProduto.findMany({ where: { empresaId: ctx.empresaId, produtoId }, select: { fornecedorId: true, preco: true, ultimoPrecoCompra: true, prazoEntregaDias: true, pedidoMinimo: true, principal: true, fornecedor: { select: { nome: true, status: true } } } }),
      prisma.compraItem.findMany({ where: { produtoId, compra: { empresaId: ctx.empresaId, dataCompra: { gte: new Date(Date.now() - 365 * 86400_000) }, status: { notIn: ['CANCELADA', 'RASCUNHO'] } } }, select: { valorUnit: true, compra: { select: { fornecedorId: true } } } }),
    ]);
    const hist = new Map<string, number[]>();
    for (const i of itens) { const l = hist.get(i.compra.fornecedorId) ?? []; l.push(N(i.valorUnit)); hist.set(i.compra.fornecedorId, l); }
    const fornecedores = vinculos.map((v) => { const h = hist.get(v.fornecedorId) ?? []; return { fornecedor: v.fornecedor.nome, situacao: v.fornecedor.status, principal: v.principal, precoReferencia: v.preco === null ? null : arred(N(v.preco), 4), ultimoPrecoPago: v.ultimoPrecoCompra === null ? null : arred(N(v.ultimoPrecoCompra), 4), precoMedio365d: h.length ? arred(h.reduce((s, x) => s + x, 0) / h.length, 4) : null, comprasEm365d: h.length, prazoEntregaDias: v.prazoEntregaDias, pedidoMinimo: v.pedidoMinimo === null ? null : arred(N(v.pedidoMinimo), 3) }; });
    const comPreco = fornecedores.filter((f) => f.ultimoPrecoPago !== null);
    const menor = comPreco.reduce<typeof comPreco[number] | null>((m, f) => (!m || f.ultimoPrecoPago! < m.ultimoPrecoPago! ? f : m), null);
    return { produto: produto.nome, fornecedores, menorUltimoPreco: menor ? { fornecedor: menor.fornecedor, preco: menor.ultimoPrecoPago } : null };
  },
};

export const FERRAMENTAS_COMPRAS = [resumoCompras, comprasPendentes, historicoCustoProduto, compararFornecedores];

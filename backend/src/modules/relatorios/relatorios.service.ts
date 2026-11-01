import { prisma } from '../../lib/prisma.js';

export type TipoRelatorio = 'vendas' | 'financeiro' | 'estoque' | 'geral';
export type AgrupamentoRelatorio = 'porForma' | 'porProduto' | 'porDia' | 'lista';
export type TipoGrafico = 'line' | 'bar' | 'doughnut';

export interface PeriodoRelatorio {
  de?: Date;
  ate?: Date;
}

function periodo(de?: string, ate?: string): PeriodoRelatorio {
  const out: PeriodoRelatorio = {};
  if (de) { const d = new Date(de); if (!Number.isNaN(d.getTime())) out.de = d; }
  if (ate) {
    const a = new Date(ate);
    if (!Number.isNaN(a.getTime())) { a.setHours(23, 59, 59, 999); out.ate = a; }
  }
  return out;
}

function createdWhere(empresaId: string, p: PeriodoRelatorio): Record<string, unknown> {
  if (!p.de && !p.ate) return { empresaId };
  const createdAt: Record<string, Date> = {};
  if (p.de) createdAt.gte = p.de;
  if (p.ate) createdAt.lte = p.ate;
  return { empresaId, createdAt };
}

export interface LinhaTabela { [coluna: string]: string | number; }
export interface KpiRelatorio { label: string; valor: string; delta: string; subiu: boolean; }
export interface SugestaoGrafico { tipo: TipoGrafico; labels: string[]; values: number[]; }

export interface FonteRelatorio {
  titulo: string;
  total: number;
  faturamento: number;
  kpis: KpiRelatorio[];
  tabela: LinhaTabela[];
  grafico: SugestaoGrafico;
  /**
   * Quantos registros existem no período, antes de truncar em `LIMITE_REGISTROS`.
   * Existe para o texto do relatório poder dizer "N de M" — sem isso, uma empresa
   * com 900 vendas veria "Faturamento: R$ X" sem nenhuma pista de que X soma só
   * as 500 mais recentes, e trataria um recorte como se fosse o total.
   */
  totalNoPeriodo: number;
}

/**
 * Teto de registros lidos por fonte.
 *
 * Existe para o relatório não carregar a tabela inteira na memória, mas É UM
 * RECORTE SILENCIOSO: qualquer agregação feita sobre esses registros descreve
 * só a fatia mais recente, não o período. Por isso todo consumidor precisa ter
 * `totalNoPeriodo` à mão para poder declarar isso na tela.
 */
export const LIMITE_REGISTROS = 500;

/** Monta o WHERE de período + empresa usado pelas três fontes. */
function whereFonte(args: { empresaId: string; de?: string; ate?: string }): Record<string, unknown> {
  return createdWhere(args.empresaId, periodo(args.de, args.ate));
}

export async function getVendas(args: { empresaId: string; de?: string; ate?: string }): Promise<FonteRelatorio> {
  const where = whereFonte(args);
  const vendas = await prisma.venda.findMany({
    where: where as never,
    include: { itens: true, cliente: { select: { nome: true } } },
    orderBy: { createdAt: 'desc' },
    take: LIMITE_REGISTROS,
  });
  // Contagem separada: é o que permite dizer "500 de 1.240" em vez de deixar o
  // usuário acreditar que R$ X é o faturamento do período inteiro.
  const totalNoPeriodo = await prisma.venda.count({ where: where as never });
  const truncado = totalNoPeriodo > vendas.length;
  const faturamento = vendas.reduce((s, v) => s + Number(v.total), 0);
  const ticket = vendas.length ? faturamento / vendas.length : 0;
  const recorte = truncado
    ? ` (${vendas.length} registros mais recentes de ${totalNoPeriodo})`
    : '';
  return {
    titulo: 'Vendas',
    total: vendas.length,
    totalNoPeriodo,
    faturamento,
    kpis: [
      { label: 'Faturamento', valor: `R$ ${faturamento.toFixed(2)}`, delta: `${vendas.length} vendas${recorte}`, subiu: vendas.length > 0 },
      { label: 'Ticket médio', valor: `R$ ${ticket.toFixed(2)}`, delta: 'no recorte analisado', subiu: ticket > 0 },
      { label: 'Qtd vendas', valor: String(vendas.length), delta: truncado ? `de ${totalNoPeriodo} no período` : 'registros', subiu: vendas.length > 0 },
    ],
    tabela: vendas.slice(0, 50).map((v) => ({
      data: new Date(v.createdAt).toLocaleDateString('pt-BR'),
      pagamento: String(v.formaPagamento),
      total: Number(v.total),
      status: String(v.status),
    })),
    grafico: {
      tipo: 'line',
      labels: vendas.slice(0, 20).reverse().map((v) => new Date(v.createdAt).toLocaleDateString('pt-BR')),
      values: vendas.slice(0, 20).reverse().map((v) => Number(v.total)),
    },
  };
}


export async function getFinanceiro(args: { empresaId: string; de?: string; ate?: string }): Promise<FonteRelatorio> {
  const where = whereFonte(args);
  const lanc = await prisma.financeiro.findMany({
    where: where as never,
    orderBy: { createdAt: 'desc' },
    take: LIMITE_REGISTROS,
  });
  const totalNoPeriodo = await prisma.financeiro.count({ where: where as never });
  const truncado = totalNoPeriodo > lanc.length;
  const receitas = lanc.filter((l) => l.tipo === 'RECEITA').reduce((s, l) => s + Number(l.valor), 0);
  const despesas = lanc.filter((l) => l.tipo === 'DESPESA').reduce((s, l) => s + Number(l.valor), 0);
  const recorte = truncado ? ` (${lanc.length} de ${totalNoPeriodo} lançamentos)` : '';
  return {
    titulo: 'Financeiro',
    total: lanc.length,
    totalNoPeriodo,
    faturamento: receitas - despesas,
    kpis: [
      { label: 'Receitas', valor: `R$ ${receitas.toFixed(2)}`, delta: `entradas${recorte}`, subiu: receitas > 0 },
      { label: 'Despesas', valor: `R$ ${despesas.toFixed(2)}`, delta: 'saídas', subiu: false },
      { label: 'Resultado', valor: `R$ ${(receitas - despesas).toFixed(2)}`, delta: 'no recorte analisado', subiu: receitas - despesas >= 0 },
    ],
    tabela: lanc.slice(0, 50).map((l) => ({
      data: new Date(l.createdAt).toLocaleDateString('pt-BR'),
      tipo: String(l.tipo),
      categoria: String(l.categoria),
      valor: Number(l.valor),
      status: String(l.status),
    })),
    grafico: { tipo: 'bar', labels: ['Receitas', 'Despesas'], values: [receitas, despesas] },
  };
}

export async function getEstoque(args: { empresaId: string }): Promise<FonteRelatorio> {
  const itens = await prisma.estoque.findMany({
    where: { empresaId: args.empresaId },
    include: { produto: { select: { nome: true } } },
    take: LIMITE_REGISTROS,
  });
  const totalNoPeriodo = await prisma.estoque.count({ where: { empresaId: args.empresaId } });
  const truncado = totalNoPeriodo > itens.length;
  const criticos = itens.filter((e) => Number(e.quantidade) <= 5);
  const recorte = truncado ? ` (${itens.length} de ${totalNoPeriodo} itens)` : '';
  return {
    titulo: 'Estoque',
    total: itens.length,
    totalNoPeriodo,
    faturamento: 0,
    kpis: [
      { label: 'Itens monitorados', valor: String(itens.length), delta: `linhas${recorte}`, subiu: itens.length > 0 },
      { label: 'Estoque crítico', valor: String(criticos.length), delta: '<= 5 un', subiu: false },
      { label: 'Qtd total', valor: String(itens.reduce((s, e) => s + Number(e.quantidade), 0)), delta: 'unidades', subiu: true },
    ],
    tabela: itens.slice(0, 50).map((e) => ({
      produto: e.produto?.nome ?? e.produtoId,
      quantidade: Number(e.quantidade),
      valorTotal: Number(e.valorTotal),
    })),
    grafico: {
      tipo: 'bar',
      labels: itens.slice(0, 10).map((e) => (e.produto?.nome ?? e.produtoId).slice(0, 14)),
      values: itens.slice(0, 10).map((e) => Number(e.quantidade)),
    },
  };
}

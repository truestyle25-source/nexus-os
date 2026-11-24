/**
 * Ferramentas do Agente Financeiro (Fase 03) — SOMENTE LEITURA.
 * Mesmas regras do módulo Financeiro: VENCIDO é derivado (PENDENTE com vencimento passado);
 * realizado = lançamentos PAGO (data de pagamento quando houver, senão a do lançamento);
 * CANCELADO nunca entra. O resultado gerencial (DRE) usa receita das vendas finalizadas,
 * custo das mercadorias (custo gravado em cada item vendido) e despesas pagas.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';
import { arred } from './geral.js';
import { janela, pct } from './comercial.js';

const N = (v: unknown) => Number(v ?? 0);
const PERM = { modulo: 'financeiro' as const, acao: 'visualizar' as const };
const diasArg = (padrao: number, max = 365) => ({ dias: { type: 'integer' as const, description: `Período em dias (1 a ${max}). Padrão ${padrao}.` } });

async function pagosNoPeriodo(ctx: ContextoIA, j: { de: Date; ate: Date }) {
  return prisma.financeiro.findMany({
    where: { empresaId: ctx.empresaId, status: 'PAGO', OR: [{ pagoEm: { gte: j.de, lte: j.ate } }, { pagoEm: null, createdAt: { gte: j.de, lte: j.ate } }] },
    select: { tipo: true, categoria: true, valor: true },
  });
}

export const resumoFinanceiro: Ferramenta<{ dias: number }> = {
  nome: 'resumo_financeiro',
  descricao: 'Realizado no período (receitas e despesas pagas, saldo) e posição atual em aberto: a receber, a pagar e vencidos (receber e pagar).',
  parametros: { type: 'object', properties: diasArg(30) },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }),
  permissao: PERM,
  async executar(ctx, { dias }) {
    const j = janela(dias); const agora = new Date();
    const [pagos, abertos] = await Promise.all([
      pagosNoPeriodo(ctx, j),
      prisma.financeiro.groupBy({ by: ['tipo'], where: { empresaId: ctx.empresaId, status: { in: ['PENDENTE', 'VENCIDO'] } }, _sum: { valor: true }, _count: { _all: true } }),
    ]);
    const vencidos = await prisma.financeiro.groupBy({ by: ['tipo'], where: { empresaId: ctx.empresaId, status: { in: ['PENDENTE', 'VENCIDO'] }, vencimento: { lt: agora } }, _sum: { valor: true }, _count: { _all: true } });
    const soma = (t: 'RECEITA' | 'DESPESA') => pagos.filter((x) => x.tipo === t).reduce((s, x) => s + N(x.valor), 0);
    const ab = (t: string, g: typeof abertos) => g.find((x) => x.tipo === t);
    const receitas = soma('RECEITA'); const despesas = soma('DESPESA');
    return {
      periodo: j.descricao,
      realizado: { receitasPagas: arred(receitas), despesasPagas: arred(despesas), saldo: arred(receitas - despesas) },
      emAberto: {
        aReceber: arred(N(ab('RECEITA', abertos)?._sum.valor)), contasAReceber: ab('RECEITA', abertos)?._count._all ?? 0,
        aPagar: arred(N(ab('DESPESA', abertos)?._sum.valor)), contasAPagar: ab('DESPESA', abertos)?._count._all ?? 0,
        receberVencido: arred(N(ab('RECEITA', vencidos)?._sum.valor)), contasReceberVencidas: ab('RECEITA', vencidos)?._count._all ?? 0,
        pagarVencido: arred(N(ab('DESPESA', vencidos)?._sum.valor)), contasPagarVencidas: ab('DESPESA', vencidos)?._count._all ?? 0,
      },
    };
  },
};

export const contasVencidas: Ferramenta<{ tipo: 'RECEITA' | 'DESPESA'; limite: number }> = {
  nome: 'contas_vencidas',
  descricao: 'Lista contas a receber (RECEITA) ou a pagar (DESPESA) vencidas e não pagas, com dias de atraso, da mais antiga para a mais recente.',
  parametros: { type: 'object', properties: { tipo: { type: 'string', enum: ['RECEITA', 'DESPESA'], description: 'RECEITA = a receber; DESPESA = a pagar.' }, limite: { type: 'integer', description: 'Máximo de itens (1 a 50). Padrão 20.' } }, required: ['tipo'] },
  validar: z.object({ tipo: z.enum(['RECEITA', 'DESPESA']), limite: z.coerce.number().int().min(1).max(50).default(20) }),
  permissao: PERM,
  async executar(ctx, { tipo, limite }) {
    const agora = new Date();
    const where = { empresaId: ctx.empresaId, tipo, status: { in: ['PENDENTE' as const, 'VENCIDO' as const] }, vencimento: { lt: agora } };
    const [itens, total] = await Promise.all([
      prisma.financeiro.findMany({ where, orderBy: { vencimento: 'asc' }, take: limite, select: { descricao: true, categoria: true, valor: true, vencimento: true } }),
      prisma.financeiro.aggregate({ where, _sum: { valor: true }, _count: { _all: true } }),
    ]);
    return { tipo: tipo === 'RECEITA' ? 'a receber' : 'a pagar', totalVencido: arred(N(total._sum.valor)), quantidade: total._count._all, itens: itens.map((i) => ({ descricao: i.descricao, categoria: i.categoria, valor: arred(N(i.valor)), vencimento: i.vencimento!.toISOString().slice(0, 10), diasDeAtraso: Math.floor((agora.getTime() - i.vencimento!.getTime()) / 86400_000) })) };
  },
};

export const fluxoCaixaProjetado: Ferramenta<{ semanas: number }> = {
  nome: 'fluxo_caixa_projetado',
  descricao: 'Projeção semanal das contas em aberto pelo vencimento (entradas previstas, saídas previstas, saldo da semana e acumulado). O que já venceu entra na primeira semana. Não inclui vendas futuras.',
  parametros: { type: 'object', properties: { semanas: { type: 'integer', description: 'Quantidade de semanas à frente (1 a 12). Padrão 4.' } } },
  validar: z.object({ semanas: z.coerce.number().int().min(1).max(12).default(4) }),
  permissao: PERM,
  async executar(ctx, { semanas }) {
    const inicio = new Date(); const fim = new Date(inicio.getTime() + semanas * 7 * 86400_000);
    const abertos = await prisma.financeiro.findMany({ where: { empresaId: ctx.empresaId, status: { in: ['PENDENTE', 'VENCIDO'] }, vencimento: { lte: fim } }, select: { tipo: true, valor: true, vencimento: true } });
    const linhas = Array.from({ length: semanas }, (_, i) => ({ semana: i + 1, de: new Date(inicio.getTime() + i * 7 * 86400_000).toISOString().slice(0, 10), entradas: 0, saidas: 0 }));
    for (const a of abertos) {
      const idx = Math.max(0, Math.min(semanas - 1, Math.floor(((a.vencimento?.getTime() ?? inicio.getTime()) - inicio.getTime()) / (7 * 86400_000))));
      if (a.tipo === 'RECEITA') linhas[idx].entradas += N(a.valor); else linhas[idx].saidas += N(a.valor);
    }
    let acumulado = 0;
    const projecao = linhas.map((l) => { const saldo = l.entradas - l.saidas; acumulado += saldo; return { semana: l.semana, inicio: l.de, entradas: arred(l.entradas), saidas: arred(l.saidas), saldoDaSemana: arred(saldo), saldoAcumulado: arred(acumulado) }; });
    const pior = projecao.reduce((m, p) => (p.saldoAcumulado < m.saldoAcumulado ? p : m), projecao[0]);
    return { criterio: 'contas pendentes pelo vencimento; vencidas entram na semana 1', semanas, projecao, menorSaldoAcumulado: pior ? { semana: pior.semana, valor: pior.saldoAcumulado } : null };
  },
};

export const despesasPorCategoria: Ferramenta<{ dias: number }> = {
  nome: 'despesas_por_categoria',
  descricao: 'Despesas pagas por categoria no período comparadas com o período anterior de mesmo tamanho (variação em valor e %), destacando as que mais cresceram.',
  parametros: { type: 'object', properties: diasArg(30) },
  validar: z.object({ dias: z.coerce.number().int().min(7).max(365).default(30) }),
  permissao: PERM,
  async executar(ctx, { dias }) {
    const [a, b] = await Promise.all([pagosNoPeriodo(ctx, janela(dias)), pagosNoPeriodo(ctx, janela(dias, dias))]);
    const agrupar = (l: typeof a) => { const m = new Map<string, number>(); for (const x of l.filter((y) => y.tipo === 'DESPESA')) m.set(x.categoria, (m.get(x.categoria) ?? 0) + N(x.valor)); return m; };
    const ma = agrupar(a); const mb = agrupar(b);
    const cats = [...new Set([...ma.keys(), ...mb.keys()])];
    const itens = cats.map((c) => ({ categoria: c, atual: arred(ma.get(c) ?? 0), anterior: arred(mb.get(c) ?? 0), variacao: arred((ma.get(c) ?? 0) - (mb.get(c) ?? 0)), variacaoPercentual: pct(ma.get(c) ?? 0, mb.get(c) ?? 0) })).sort((x, y) => y.atual - x.atual);
    return { periodo: janela(dias).descricao, periodoAnterior: janela(dias, dias).descricao, totalAtual: arred([...ma.values()].reduce((s, v) => s + v, 0)), totalAnterior: arred([...mb.values()].reduce((s, v) => s + v, 0)), maioresAumentos: [...itens].filter((i) => i.variacao > 0).sort((x, y) => y.variacao - x.variacao).slice(0, 5), categorias: itens };
  },
};

export const resultadoPeriodo: Ferramenta<{ dias: number; comparar: boolean }> = {
  nome: 'resultado_periodo',
  descricao: 'DRE gerencial do período: receita (vendas finalizadas), custo das mercadorias vendidas, lucro bruto e margem bruta, despesas pagas, resultado e margem líquida — com o período anterior para comparação.',
  parametros: { type: 'object', properties: { ...diasArg(30), comparar: { type: 'boolean', description: 'Comparar com o período anterior. Padrão true.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(365).default(30), comparar: z.boolean().default(true) }),
  permissao: { modulo: 'dre', acao: 'visualizar' },
  async executar(ctx, { dias, comparar }) {
    const calcular = async (j: { de: Date; ate: Date; descricao: string }) => {
      const [vendas, itens, pagos] = await Promise.all([
        prisma.venda.aggregate({ where: { empresaId: ctx.empresaId, status: 'FINALIZADA', createdAt: { gte: j.de, lte: j.ate } }, _sum: { total: true } }),
        prisma.vendaItem.findMany({ where: { venda: { empresaId: ctx.empresaId, status: 'FINALIZADA', createdAt: { gte: j.de, lte: j.ate } } }, select: { quantidade: true, custoUnitario: true } }),
        pagosNoPeriodo(ctx, j),
      ]);
      const receita = N(vendas._sum.total); const cmv = itens.reduce((s, i) => s + N(i.custoUnitario) * N(i.quantidade), 0);
      const despesas = pagos.filter((p) => p.tipo === 'DESPESA').reduce((s, p) => s + N(p.valor), 0);
      const bruto = receita - cmv; const resultado = bruto - despesas;
      return { periodo: j.descricao, receita: arred(receita), custoMercadorias: arred(cmv), lucroBruto: arred(bruto), margemBrutaPercentual: receita ? arred((bruto / receita) * 100, 1) : null, despesasPagas: arred(despesas), resultado: arred(resultado), margemLiquidaPercentual: receita ? arred((resultado / receita) * 100, 1) : null };
    };
    const atual = await calcular(janela(dias));
    if (!comparar) return { atual };
    const anterior = await calcular(janela(dias, dias));
    return { atual, anterior, variacaoReceitaPercentual: pct(atual.receita, anterior.receita), variacaoResultadoPercentual: pct(atual.resultado, anterior.resultado), variacaoMargemBrutaPontos: atual.margemBrutaPercentual !== null && anterior.margemBrutaPercentual !== null ? arred(atual.margemBrutaPercentual - anterior.margemBrutaPercentual, 1) : null };
  },
};

export const FERRAMENTAS_FINANCEIRO = [resumoFinanceiro, contasVencidas, fluxoCaixaProjetado, despesasPorCategoria, resultadoPeriodo];

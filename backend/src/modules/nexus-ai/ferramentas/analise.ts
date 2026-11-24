/**
 * Ferramentas analíticas (Fase 05): previsão de demanda, previsão de caixa, detecção de
 * anomalias e simulador de preço/margem. Tudo DETERMINÍSTICO e calculado aqui — o modelo só
 * interpreta. Cada resultado informa o método e o período usados (para o usuário conferir).
 * Somente leitura, sempre filtradas pela empresa do contexto.
 */
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { temPermissao } from '../../../lib/permissoes.js';
import type { Modulo } from '../../../lib/permissoes-catalogo.js';
import type { ContextoIA, Ferramenta } from '../tipos.js';
import { arred } from './geral.js';

const N = (v: unknown) => Number(v ?? 0);
const DIA = 86400_000;
/** Saídas que representam demanda (perdas e descartes não são demanda). */
const DEMANDA = ['VENDA', 'SAIDA', 'CONSUMO_INSUMO'] as const;
const PERDAS = ['PERDA', 'AVARIA', 'DESCARTE'] as const;

async function pode(ctx: ContextoIA, modulo: Modulo) {
  return ctx.sistema || (ctx.usuarioId ? temPermissao(ctx.usuarioId, modulo, 'visualizar') : false);
}

/** Regressão linear simples (mínimos quadrados) de uma série diária: y = a + b·t. Exportada para os testes. */
export function regressao(serie: number[]) {
  const n = serie.length;
  if (!n) return { a: 0, b: 0 };
  const mt = (n - 1) / 2; const my = serie.reduce((s, y) => s + y, 0) / n;
  let num = 0; let den = 0;
  serie.forEach((y, t) => { num += (t - mt) * (y - my); den += (t - mt) ** 2; });
  const b = den ? num / den : 0;
  return { a: my - b * mt, b };
}

/** Mediana e desvio absoluto mediano (robustos a picos). Exportada para os testes. */
export function medianaMad(v: number[]) {
  if (!v.length) return { mediana: 0, mad: 0 };
  const ord = [...v].sort((x, y) => x - y);
  const med = (o: number[]) => (o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2);
  const mediana = med(ord);
  return { mediana, mad: med(v.map((x) => Math.abs(x - mediana)).sort((x, y) => x - y)) };
}

export const previsaoDemanda: Ferramenta<{ produtoId?: string; historicoDias: number; horizonteDias: number; filialId?: string; limite: number }> = {
  nome: 'previsao_demanda',
  descricao: 'Previsão de demanda por produto: tendência linear das saídas diárias (vendas, saídas e consumo de insumos) no histórico, quantidade prevista para o horizonte, saldo atual e em quantos dias o saldo acaba. Sem produtoId, traz os produtos com maior demanda prevista.',
  parametros: { type: 'object', properties: {
    produtoId: { type: 'string', description: 'ID do produto (opcional).' },
    historicoDias: { type: 'integer', description: 'Dias de histórico (14 a 365). Padrão 90.' },
    horizonteDias: { type: 'integer', description: 'Dias à frente (1 a 90). Padrão 30.' },
    filialId: { type: 'string', description: 'ID da filial (opcional).' },
    limite: { type: 'integer', description: 'Máximo de produtos (1 a 30). Padrão 10.' },
  } },
  validar: z.object({ produtoId: z.string().optional(), historicoDias: z.coerce.number().int().min(14).max(365).default(90), horizonteDias: z.coerce.number().int().min(1).max(90).default(30), filialId: z.string().optional(), limite: z.coerce.number().int().min(1).max(30).default(10) }),
  permissao: { modulo: 'estoque', acao: 'visualizar' },
  async executar(ctx, { produtoId, historicoDias, horizonteDias, filialId, limite }) {
    const agora = Date.now(); const de = new Date(agora - historicoDias * DIA);
    const movs = await prisma.estoqueMovimentacao.findMany({
      where: { empresaId: ctx.empresaId, tipo: { in: [...DEMANDA] }, createdAt: { gte: de }, ...(produtoId ? { produtoId } : {}), ...(filialId ? { filialId } : {}) },
      select: { produtoId: true, quantidade: true, createdAt: true }, take: 100_000,
    });
    const series = new Map<string, number[]>();
    for (const m of movs) {
      const s = series.get(m.produtoId) ?? Array(historicoDias).fill(0);
      const t = historicoDias - 1 - Math.min(historicoDias - 1, Math.floor((agora - m.createdAt.getTime()) / DIA));
      s[t] += Math.abs(N(m.quantidade)); series.set(m.produtoId, s);
    }
    if (produtoId && !series.size) series.set(produtoId, Array(historicoDias).fill(0));
    const ids = [...series.keys()];
    const [produtos, saldos] = await Promise.all([
      prisma.produto.findMany({ where: { empresaId: ctx.empresaId, id: { in: ids } }, select: { id: true, nome: true, unidade: true } }),
      prisma.estoque.groupBy({ by: ['produtoId'], _sum: { quantidade: true }, where: { empresaId: ctx.empresaId, produtoId: { in: ids }, ...(filialId ? { filialId } : {}) } }),
    ]);
    const nome = new Map(produtos.map((p) => [p.id, p])); const saldo = new Map(saldos.map((s) => [s.produtoId, N(s._sum.quantidade)]));
    const itens = ids.filter((id) => nome.has(id)).map((id) => {
      // A série começa na primeira saída do produto: dias antes dele existir/vender não viram tendência falsa.
      const cheia = series.get(id)!; const primeiro = cheia.findIndex((y) => y > 0);
      const s = primeiro < 0 ? cheia : cheia.slice(primeiro); const n = s.length;
      const media = s.reduce((x, y) => x + y, 0) / n;
      // Menos de 7 dias de histórico: só a média (tendência não é confiável).
      const { a, b } = n >= 7 ? regressao(s) : { a: media, b: 0 };
      let prevista = 0;
      for (let k = 0; k < horizonteDias; k++) prevista += Math.max(0, a + b * (n + k));
      const diaria = prevista / horizonteDias; const sal = saldo.get(id) ?? 0;
      return {
        produtoId: id, nome: nome.get(id)!.nome, unidade: nome.get(id)!.unidade,
        mediaDiariaHistorica: arred(media, 2), diasDeHistoricoUsados: n, tendenciaPercentualNoHistorico: media ? arred(((b * (n - 1)) / media) * 100, 1) : 0,
        demandaPrevista: arred(prevista, 1), mediaDiariaPrevista: arred(diaria, 2), saldoAtual: arred(sal, 3),
        diasAteAcabar: diaria > 0 ? arred(Math.max(0, sal) / diaria, 1) : null,
        faltaParaOHorizonte: arred(Math.max(0, prevista - Math.max(0, sal)), 1),
      };
    }).sort((x, y) => y.demandaPrevista - x.demandaPrevista).slice(0, limite);
    return { metodo: 'regressão linear das saídas diárias (vendas, saídas e consumo) desde a primeira saída do produto no histórico; com menos de 7 dias, média simples; sem valores negativos', historico: `${historicoDias} dias`, horizonte: `${horizonteDias} dias`, itens };
  },
};

export const previsaoCaixa: Ferramenta<{ semanas: number; semanasHistorico: number }> = {
  nome: 'previsao_caixa',
  descricao: 'Previsão de caixa semanal em dois cenários: (1) só as contas em aberto pelo vencimento; (2) contas em aberto + vendas e despesas estimadas pela média semanal do histórico. Mostra a semana de menor saldo acumulado em cada cenário.',
  parametros: { type: 'object', properties: { semanas: { type: 'integer', description: 'Semanas à frente (1 a 12). Padrão 4.' }, semanasHistorico: { type: 'integer', description: 'Semanas de histórico para as médias (2 a 26). Padrão 8.' } } },
  validar: z.object({ semanas: z.coerce.number().int().min(1).max(12).default(4), semanasHistorico: z.coerce.number().int().min(2).max(26).default(8) }),
  permissao: { modulo: 'financeiro', acao: 'visualizar' },
  async executar(ctx, { semanas, semanasHistorico }) {
    const agora = Date.now(); const fim = new Date(agora + semanas * 7 * DIA); const de = new Date(agora - semanasHistorico * 7 * DIA);
    const [abertos, vendas, despesas] = await Promise.all([
      prisma.financeiro.findMany({ where: { empresaId: ctx.empresaId, status: { in: ['PENDENTE', 'VENCIDO'] }, vencimento: { lte: fim } }, select: { tipo: true, valor: true, vencimento: true } }),
      prisma.venda.aggregate({ where: { empresaId: ctx.empresaId, status: 'FINALIZADA', createdAt: { gte: de } }, _sum: { total: true } }),
      prisma.financeiro.aggregate({ where: { empresaId: ctx.empresaId, tipo: 'DESPESA', status: 'PAGO', OR: [{ pagoEm: { gte: de } }, { pagoEm: null, createdAt: { gte: de } }] }, _sum: { valor: true } }),
    ]);
    const vendasSemana = N(vendas._sum.total) / semanasHistorico; const despesasSemana = N(despesas._sum.valor) / semanasHistorico;
    const contas = Array.from({ length: semanas }, () => ({ entradas: 0, saidas: 0 }));
    for (const a of abertos) {
      const i = Math.max(0, Math.min(semanas - 1, Math.floor(((a.vencimento?.getTime() ?? agora) - agora) / (7 * DIA))));
      if (a.tipo === 'RECEITA') contas[i].entradas += N(a.valor); else contas[i].saidas += N(a.valor);
    }
    let acc1 = 0; let acc2 = 0;
    const projecao = contas.map((c, i) => {
      acc1 += c.entradas - c.saidas; acc2 += c.entradas + vendasSemana - c.saidas - despesasSemana;
      return { semana: i + 1, inicio: new Date(agora + i * 7 * DIA).toISOString().slice(0, 10), contasEntradas: arred(c.entradas), contasSaidas: arred(c.saidas), saldoAcumuladoSoContas: arred(acc1), saldoAcumuladoComEstimativas: arred(acc2) };
    });
    const pior = (k: 'saldoAcumuladoSoContas' | 'saldoAcumuladoComEstimativas') => projecao.reduce((m, p) => (p[k] < m[k] ? p : m), projecao[0]);
    return {
      metodo: `contas em aberto pelo vencimento (vencidas na semana 1); estimativas = média semanal das últimas ${semanasHistorico} semanas`,
      vendasEstimadasPorSemana: arred(vendasSemana), despesasEstimadasPorSemana: arred(despesasSemana), projecao,
      menorSaldoSoContas: { semana: pior('saldoAcumuladoSoContas').semana, valor: pior('saldoAcumuladoSoContas').saldoAcumuladoSoContas },
      menorSaldoComEstimativas: { semana: pior('saldoAcumuladoComEstimativas').semana, valor: pior('saldoAcumuladoComEstimativas').saldoAcumuladoComEstimativas },
      observacao: 'O cenário com estimativas pode contar em dobro despesas que já estão lançadas como contas em aberto.',
    };
  },
};

export const detectarAnomalias: Ferramenta<{ dias: number; diasBase: number }> = {
  nome: 'detectar_anomalias',
  descricao: 'Procura comportamentos fora do padrão nos últimos dias comparando com um período-base: dias de venda muito acima ou abaixo do normal, aumento de cancelamentos, salto de despesas por categoria e perdas/avarias de estoque. Áreas sem permissão do usuário são omitidas.',
  parametros: { type: 'object', properties: { dias: { type: 'integer', description: 'Dias recentes analisados (1 a 30). Padrão 7.' }, diasBase: { type: 'integer', description: 'Dias do período-base anterior (14 a 180). Padrão 56.' } } },
  validar: z.object({ dias: z.coerce.number().int().min(1).max(30).default(7), diasBase: z.coerce.number().int().min(14).max(180).default(56) }),
  permissao: { modulo: 'dashboard', acao: 'visualizar' },
  async executar(ctx, { dias, diasBase }) {
    const agora = Date.now(); const ini = new Date(agora - dias * DIA); const iniBase = new Date(agora - (dias + diasBase) * DIA);
    const anomalias: { area: string; tipo: string; descricao: string; atual: number; esperado: number; ocorrencias?: number; severidade: 'ALTA' | 'MEDIA' }[] = [];
    const omitidas: string[] = [];
    const base = { gte: iniBase, lt: ini }; const recente = { gte: ini };
    const porDia = (lista: { createdAt: Date; total: unknown }[], de: number, n: number) => {
      const s = Array(n).fill(0);
      for (const v of lista) { const i = Math.floor((v.createdAt.getTime() - de) / DIA); if (i >= 0 && i < n) s[i] += N(v.total); }
      return s;
    };

    if (await pode(ctx, 'vendas')) {
      const vs = await prisma.venda.findMany({ where: { empresaId: ctx.empresaId, createdAt: { gte: iniBase } }, select: { createdAt: true, total: true, status: true }, take: 200_000 });
      const fin = vs.filter((v) => v.status === 'FINALIZADA');
      const sBase = porDia(fin, iniBase.getTime(), diasBase); const sRec = porDia(fin, ini.getTime(), dias);
      const { mediana, mad } = medianaMad(sBase); const escala = Math.max(mad * 1.4826, mediana * 0.1, 1);
      sRec.forEach((v, i) => {
        const z = (v - mediana) / escala;
        if (Math.abs(z) >= 3) anomalias.push({ area: 'vendas', tipo: z < 0 ? 'QUEDA_DE_VENDAS' : 'PICO_DE_VENDAS', descricao: `Faturamento do dia ${new Date(ini.getTime() + i * DIA).toISOString().slice(0, 10)} fora do padrão`, atual: arred(v), esperado: arred(mediana), severidade: Math.abs(z) >= 5 ? 'ALTA' : 'MEDIA' });
      });
      const canc = (de: number, ate: number) => vs.filter((v) => v.createdAt.getTime() >= de && v.createdAt.getTime() < ate);
      const rec = canc(ini.getTime(), agora + 1); const bas = canc(iniBase.getTime(), ini.getTime());
      const taxa = (l: typeof vs) => (l.length ? l.filter((v) => v.status === 'CANCELADA').length / l.length : 0);
      const nCanc = rec.filter((v) => v.status === 'CANCELADA').length;
      if (nCanc >= 3 && taxa(rec) >= Math.max(2 * taxa(bas), 0.05)) anomalias.push({ area: 'vendas', tipo: 'CANCELAMENTOS_ACIMA_DO_NORMAL', descricao: 'Taxa de cancelamento de vendas (%) acima do padrão', ocorrencias: nCanc, atual: arred(taxa(rec) * 100, 1), esperado: arred(taxa(bas) * 100, 1), severidade: taxa(rec) >= 4 * Math.max(taxa(bas), 0.02) ? 'ALTA' : 'MEDIA' });
    } else omitidas.push('vendas');

    if (await pode(ctx, 'financeiro')) {
      const ds = await prisma.financeiro.findMany({ where: { empresaId: ctx.empresaId, tipo: 'DESPESA', status: 'PAGO', OR: [{ pagoEm: { gte: iniBase } }, { pagoEm: null, createdAt: { gte: iniBase } }] }, select: { categoria: true, valor: true, pagoEm: true, createdAt: true } });
      const cat = new Map<string, { rec: number; base: number }>();
      for (const d of ds) { const t = (d.pagoEm ?? d.createdAt).getTime(); const c = cat.get(d.categoria ?? 'sem categoria') ?? { rec: 0, base: 0 }; if (t >= ini.getTime()) c.rec += N(d.valor); else c.base += N(d.valor); cat.set(d.categoria ?? 'sem categoria', c); }
      for (const [c, v] of cat) {
        const esperado = (v.base / diasBase) * dias;
        if (v.rec >= 2 * esperado && v.rec - esperado >= 100) anomalias.push({ area: 'financeiro', tipo: 'DESPESA_ACIMA_DO_NORMAL', descricao: `Despesas de "${c}" acima do padrão`, atual: arred(v.rec), esperado: arred(esperado), severidade: v.rec >= 4 * esperado ? 'ALTA' : 'MEDIA' });
      }
    } else omitidas.push('financeiro');

    if (await pode(ctx, 'estoque')) {
      const ps = await prisma.estoqueMovimentacao.findMany({ where: { empresaId: ctx.empresaId, tipo: { in: [...PERDAS] }, createdAt: { gte: iniBase } }, select: { quantidade: true, createdAt: true, produto: { select: { custo: true } } }, take: 100_000 });
      let rec = 0; let bas = 0;
      for (const p of ps) { const v = Math.abs(N(p.quantidade)) * N(p.produto?.custo); if (p.createdAt >= ini) rec += v; else bas += v; }
      const esperado = (bas / diasBase) * dias;
      if (rec >= 2 * esperado && rec - esperado >= 50) anomalias.push({ area: 'estoque', tipo: 'PERDAS_ACIMA_DO_NORMAL', descricao: 'Perdas, avarias e descartes (valor a custo) acima do padrão', atual: arred(rec), esperado: arred(esperado), severidade: rec >= 4 * esperado ? 'ALTA' : 'MEDIA' });
    } else omitidas.push('estoque');

    return {
      metodo: `últimos ${dias} dias comparados com os ${diasBase} dias anteriores; vendas diárias por mediana e desvio absoluto (|z| ≥ 3); demais por média do período-base (≥ 2×)`,
      total: anomalias.length, anomalias: anomalias.sort((a, b) => (a.severidade === b.severidade ? 0 : a.severidade === 'ALTA' ? -1 : 1)),
      ...(omitidas.length ? { areasOmitidasPorPermissao: omitidas } : {}),
    };
  },
};

export const simularPreco: Ferramenta<{ produtoId: string; novoPreco?: number; variacaoPercentual?: number; elasticidade: number; dias: number }> = {
  nome: 'simular_preco',
  descricao: 'Simula a mudança de preço de um produto: preço médio praticado, custo, volume e lucro bruto atuais do período; novo preço, volume estimado (pela elasticidade informada; 0 = volume igual), novo lucro bruto e margem, e o volume mínimo para manter o lucro bruto atual. É uma simulação: não altera o preço.',
  parametros: { type: 'object', properties: {
    produtoId: { type: 'string', description: 'ID do produto (use buscar_produtos).' },
    novoPreco: { type: 'number', description: 'Novo preço de venda (ou use variacaoPercentual).' },
    variacaoPercentual: { type: 'number', description: 'Variação do preço em % (ex.: 10 ou -5).' },
    elasticidade: { type: 'number', description: 'Variação % do volume para cada 1% de preço (ex.: -1,2). Padrão 0.' },
    dias: { type: 'integer', description: 'Período-base em dias (7 a 365). Padrão 30.' },
  }, required: ['produtoId'] },
  validar: z.object({ produtoId: z.string().min(1), novoPreco: z.coerce.number().positive().optional(), variacaoPercentual: z.coerce.number().min(-90).max(500).optional(), elasticidade: z.coerce.number().min(-10).max(10).default(0), dias: z.coerce.number().int().min(7).max(365).default(30) })
    .refine((a) => a.novoPreco !== undefined || a.variacaoPercentual !== undefined, 'Informe novoPreco ou variacaoPercentual.'),
  permissao: { modulo: 'custos', acao: 'visualizar' },
  async executar(ctx, { produtoId, novoPreco, variacaoPercentual, elasticidade, dias }) {
    const p = await prisma.produto.findFirst({ where: { id: produtoId, empresaId: ctx.empresaId }, select: { nome: true, precoVenda: true, custo: true } });
    if (!p) return { erro: 'Produto não encontrado.' };
    const itens = await prisma.vendaItem.findMany({ where: { produtoId, venda: { empresaId: ctx.empresaId, status: 'FINALIZADA', createdAt: { gte: new Date(Date.now() - dias * DIA) } } }, select: { quantidade: true, total: true, custoUnitario: true } });
    const qtd = itens.reduce((s, i) => s + N(i.quantidade), 0);
    const receita = itens.reduce((s, i) => s + N(i.total), 0);
    const custoTotal = itens.reduce((s, i) => s + N(i.quantidade) * N(i.custoUnitario ?? p.custo), 0);
    const precoAtual = qtd ? receita / qtd : N(p.precoVenda); const custoUnit = qtd ? custoTotal / qtd : N(p.custo);
    const preco = novoPreco ?? precoAtual * (1 + (variacaoPercentual ?? 0) / 100);
    const varPreco = precoAtual ? ((preco - precoAtual) / precoAtual) * 100 : 0;
    const qtdNova = Math.max(0, qtd * (1 + (elasticidade * varPreco) / 100));
    const lucroAtual = (precoAtual - custoUnit) * qtd; const lucroNovo = (preco - custoUnit) * qtdNova;
    return {
      produto: p.nome, periodoBase: `${dias} dias`, observacao: qtd ? undefined : 'Sem vendas no período: usado o preço e o custo cadastrados, com volume zero.',
      atual: { precoMedio: arred(precoAtual), custoUnitario: arred(custoUnit), quantidade: arred(qtd, 3), lucroBruto: arred(lucroAtual), margemPercentual: precoAtual ? arred(((precoAtual - custoUnit) / precoAtual) * 100, 1) : null },
      simulado: { preco: arred(preco), variacaoPrecoPercentual: arred(varPreco, 1), elasticidadeUsada: elasticidade, quantidadeEstimada: arred(qtdNova, 3), lucroBruto: arred(lucroNovo), margemPercentual: preco ? arred(((preco - custoUnit) / preco) * 100, 1) : null, diferencaLucroBruto: arred(lucroNovo - lucroAtual) },
      quantidadeMinimaParaManterLucro: preco > custoUnit ? arred(lucroAtual / (preco - custoUnit), 1) : null,
    };
  },
};

export const FERRAMENTAS_ANALISE = [previsaoDemanda, previsaoCaixa, detectarAnomalias, simularPreco];

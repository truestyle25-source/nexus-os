import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  getEstoque,
  getFinanceiro,
  getVendas,
  type FonteRelatorio,
  type KpiRelatorio,
  type SugestaoGrafico,
} from './relatorios.service.js';

export type FonteInterpretada = 'vendas' | 'financeiro' | 'estoque';
export type AgrupamentoIA = 'porForma' | 'porProduto' | 'porDia';

export interface InterpretacaoPergunta {
  fonte: FonteInterpretada;
  agrupamento: AgrupamentoIA;
  tipoGrafico: 'line' | 'bar' | 'doughnut';
  metricas: string[];
}

export interface DadosRelatorio {
  resumo: string;
  kpis: KpiRelatorio[];
  tabela: Array<Record<string, string | number>>;
  grafico: SugestaoGrafico;
  fonte: FonteInterpretada;
  periodo: { de: string | null; ate: string | null };
  /** true = estrutura montada localmente (Gemini ausente/erro). */
  fallback: boolean;
}

export interface RelatorioGeradoDTO {
  id: string;
  empresaId: string;
  perguntaOriginal: string;
  titulo: string;
  tipo: string;
  dados: DadosRelatorio;
  insights: string[];
  criadoEm: Date;
}

/**
 * Interpreta a pergunta em linguagem natural (Seção 33):
 * - forma de pagamento/pix/dinheiro/cartão → doughnut porForma;
 * - top/produto/rentabilidade/estoque     → bar porProduto;
 * - por dia/evolução/linha                 → line porDia;
 * - padrão                                 → line porDia.
 * A aba ativa só desempata a FONTE quando não há palavra-chave.
 */
export function interpretarPergunta(pergunta: string, tab?: string): InterpretacaoPergunta {
  const p = pergunta.toLowerCase();
  const tem = (...ks: string[]) => ks.some((k) => p.includes(k));

  const querPagamento = tem(
    'forma de pagamento', 'formas de pagamento', 'pagamento',
    'pix', 'dinheiro', 'cartão', 'cartao',
    'crédito', 'credito', 'débito', 'debito', 'boleto',
    'transferência', 'transferencia',
  );
  const querProduto = tem('top', 'produto', 'produtos', 'rentabilidade', 'mais vendido', 'mais vendidos', 'margem');
  const querEstoque = tem('estoque', 'ruptura');
  const querFinanceiro = tem(
    'financeiro', 'receita', 'receitas', 'despesa', 'despesas',
    'fluxo de caixa', 'resultado', 'lucro', 'prejuízo', 'prejuizo',
  );
  const querPorDia = tem(
    'por dia', 'evolução', 'evolucao', 'linha do tempo',
    'diário', 'diario', 'histórico', 'historico', 'período', 'periodo',
  );

  const metricas: string[] = [];
  if (querPagamento) metricas.push('formaPagamento');
  if (querProduto) metricas.push('produto');
  if (querEstoque) metricas.push('estoque');
  if (querFinanceiro) metricas.push('financeiro');
  if (querPorDia) metricas.push('porDia');

  // Fonte: estoque > financeiro > (aba ativa como hint) > vendas.
  let fonte: FonteInterpretada = 'vendas';
  if (querEstoque) fonte = 'estoque';
  else if (querFinanceiro) fonte = 'financeiro';
  else if (tab && /financeiro|dre/i.test(tab)) fonte = 'financeiro';

  // Gráfico: ordem de prioridade definida na Seção 33.
  if (fonte !== 'estoque' && querPagamento) {
    return { fonte, agrupamento: 'porForma', tipoGrafico: 'doughnut', metricas };
  }
  if (fonte === 'estoque' || querProduto) {
    return { fonte, agrupamento: 'porProduto', tipoGrafico: 'bar', metricas };
  }
  return { fonte, agrupamento: 'porDia', tipoGrafico: 'line', metricas };
}

/** WHERE de período compartilhado pelas agregações do gráfico. */
function wherePeriodo(empresaId: string, de?: string, ate?: string) {
  const createdAt: Record<string, Date> = {};
  if (de) {
    const d = new Date(de);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (ate) {
    const a = new Date(ate);
    if (!Number.isNaN(a.getTime())) {
      a.setHours(23, 59, 59, 999);
      createdAt.lte = a;
    }
  }
  const where: Record<string, unknown> = { empresaId };
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
  return where;
}

function rotuloDia(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function agruparPorDia(
  linhas: Array<{ data: Date; valor: number }>,
): { labels: string[]; values: number[] } {
  const mapa = new Map<string, { data: Date; valor: number }>();
  for (const l of linhas) {
    const chave = l.data.toISOString().slice(0, 10);
    const atual = mapa.get(chave) ?? { data: l.data, valor: 0 };
    atual.valor += l.valor;
    mapa.set(chave, atual);
  }
  const dias = [...mapa.values()]
    .sort((a, b) => a.data.getTime() - b.data.getTime())
    .slice(-30);
  return { labels: dias.map((x) => rotuloDia(x.data)), values: dias.map((x) => x.valor) };
}

/**
 * Agrega dados REAIS do Prisma no agrupamento pedido pela interpretação.
 * Todo valor vem do banco filtrado pela empresa — nada de inventar número.
 * (Estoque não passa por aqui: getEstoque já devolve bar porProduto.)
 */
export async function montarGrafico(
  interp: InterpretacaoPergunta,
  args: { empresaId: string; de?: string; ate?: string },
): Promise<SugestaoGrafico> {
  const where = wherePeriodo(args.empresaId, args.de, args.ate);
  const { empresaId } = args;

  // doughnut por forma de pagamento (agrega vendas por formaPagamento).
  if (interp.agrupamento === 'porForma') {
    const vendas = await prisma.venda.findMany({
      where: where as never,
      select: { formaPagamento: true, total: true },
      take: 2000,
    });
    const mapa = new Map<string, number>();
    for (const v of vendas) {
      const chave = String(v.formaPagamento);
      mapa.set(chave, (mapa.get(chave) ?? 0) + Number(v.total));
    }
    const entradas = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
    return {
      tipo: 'doughnut',
      labels: entradas.map(([k]) => k),
      values: entradas.map(([, v]) => Number(v.toFixed(2))),
    };
  }

  // bar por produto: soma de VendaItem.total agrupada por produtoId.
  if (interp.agrupamento === 'porProduto' && interp.fonte === 'vendas') {
    const relWhere: Record<string, unknown> = { empresaId };
    if (where.createdAt) relWhere.createdAt = where.createdAt;
    const itens = await prisma.vendaItem.findMany({
      where: { venda: relWhere } as never,
      select: { produtoId: true, total: true },
      take: 5000,
    });
    const mapa = new Map<string, number>();
    for (const i of itens) {
      mapa.set(i.produtoId, (mapa.get(i.produtoId) ?? 0) + Number(i.total));
    }
    const top = [...mapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const produtos = await prisma.produto.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, nome: true },
    });
    const nomes = new Map(produtos.map((pr) => [pr.id, pr.nome]));
    return {
      tipo: 'bar',
      labels: top.map(([id]) => (nomes.get(id) ?? id).slice(0, 18)),
      values: top.map(([, v]) => Number(v.toFixed(2))),
    };
  }

  // line por dia — financeiro (receita - despesa somados por dia).
  if (interp.fonte === 'financeiro') {
    const lanc = await prisma.financeiro.findMany({
      where: where as never,
      select: { createdAt: true, valor: true, tipo: true },
      take: 2000,
    });
    const dias = agruparPorDia(
      lanc.map((l) => ({
        data: new Date(l.createdAt),
        valor: l.tipo === 'DESPESA' ? -Number(l.valor) : Number(l.valor),
      })),
    );
    return { tipo: 'line', labels: dias.labels, values: dias.values };
  }

  // line por dia — vendas (total somado por dia, últimos 30 dias com dados).
  const vendas = await prisma.venda.findMany({
    where: where as never,
    select: { createdAt: true, total: true },
    take: 2000,
  });
  const dias = agruparPorDia(
    vendas.map((v) => ({ data: new Date(v.createdAt), valor: Number(v.total) })),
  );
  return { tipo: 'line', labels: dias.labels, values: dias.values };
}

interface EstruturaIA {
  titulo: string;
  resumo: string;
  kpis: KpiRelatorio[];
  insights: string[];
  grafico: SugestaoGrafico;
}

function periodoTexto(de?: string, ate?: string): string {
  if (!de && !ate) return 'todo o histórico disponível';
  const fmt = (s?: string) => (s ? new Date(s).toLocaleDateString('pt-BR') : 'início');
  return `${fmt(de)} a ${fmt(ate)}`;
}

/**
 * Fallback determinístico (sem Gemini): título/resumo/insights calculados
 * localmente a partir dos MESMOS números reais da fonte — nunca inventado.
 */
function estruturaFallback(
  fonte: FonteRelatorio,
  interp: InterpretacaoPergunta,
  grafico: SugestaoGrafico,
  de?: string,
  ate?: string,
): EstruturaIA {
  const periodo = periodoTexto(de, ate);
  const kpis = fonte.kpis.slice(0, 4);
  // O recorte precisa aparecer no texto, não só no rótulo do KPI. Sem esta
  // frase, um relatório gerado sobre 500 de 1.240 registros se lê como se
  // cobrisse o período inteiro — e o número errado continua "certo" para quem
  // não percebe a diferença.
  const truncado = fonte.totalNoPeriodo > fonte.total;
  const avisoRecorte = truncado
    ? ` Atenção: a análise considera os ${fonte.total} registros mais recentes de ${fonte.totalNoPeriodo} existentes no período.`
    : '';
  const resumo =
    `${fonte.titulo}: ${fonte.total} registros em ${periodo}. ` +
    kpis.map((k) => `${k.label}: ${k.valor}`).join(' • ') +
    '.' + avisoRecorte;
  const insights: string[] = [
    `${fonte.titulo} — ${fonte.total} registros analisados (${periodo}).` +
      (truncado ? ` O período tem ${fonte.totalNoPeriodo}; foram usados os ${fonte.total} mais recentes.` : ''),
  ];
  if (kpis[0]) insights.push(`${kpis[0].label}: ${kpis[0].valor} (${kpis[0].delta}).`);
  if (grafico.labels.length > 0) {
    let imax = 0;
    grafico.values.forEach((v, i) => {
      if (v > grafico.values[imax]) imax = i;
    });
    insights.push(
      `Maior valor do gráfico (${interp.tipoGrafico}): ${grafico.labels[imax]} com ${grafico.values[imax].toLocaleString('pt-BR')}.`,
    );
  } else {
    insights.push('Sem lançamentos no período para desenhar o gráfico.');
  }
  return {
    titulo: `Relatório de ${fonte.titulo} — ${periodo}`,
    resumo,
    kpis,
    insights: insights.slice(0, 3),
    grafico,
  };
}

/**
 * Regra de ouro da validação: o valor do KPI precisa existir entre os KPIs
 * REAIS calculados — se o Gemini paraphrasear o número, o KPI é descartado.
 */
function normalizarKpi(candidato: unknown, reais: KpiRelatorio[]): KpiRelatorio | null {
  if (!candidato || typeof candidato !== 'object') return null;
  const o = candidato as Record<string, unknown>;
  if (typeof o.label !== 'string' || typeof o.valor !== 'string') return null;
  const rotulo: string = o.label;
  const valor: string = o.valor;
  const real = reais.find((k) => k.valor.trim() === valor.trim());
  if (!real) return null;
  const delta =
    typeof o.delta === 'string' && o.delta.trim() ? o.delta.trim().slice(0, 60) : real.delta;
  const subiu = typeof o.subiu === 'boolean' ? o.subiu : real.subiu;
  return { label: rotulo.trim().slice(0, 60), valor: real.valor, delta, subiu };
}

/**
 * Estrutura o relatório com o Gemini (mesmo padrão da IA do ia.routes.ts).
 * Retorna null quando não há chave/erro/JSON inválido → fallback local.
 */
async function estruturarComIA(
  pergunta: string,
  fonte: FonteRelatorio,
  grafico: SugestaoGrafico,
  interp: InterpretacaoPergunta,
  fb: EstruturaIA,
): Promise<EstruturaIA | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  const prompt = `Você é o NEXUS, analista de relatórios da NEXUS OS (pt-BR).
Abaixo estão DADOS REAIS já calculados no banco da empresa. Estruture um relatório executivo.
REGRAS CRÍTICAS:
1. NUNCA invente números. Em "kpis", copie "valor" EXATAMENTE como está nos dados reais.
2. Responda SOMENTE com JSON válido (sem markdown):
{"tituloRelatorio":"...","resumo":"2-3 frases executivas","kpis":[{"label":"...","valor":"...","delta":"...","subiu":true}],"insights":["frase 1","frase 2","frase 3"]}
3. "kpis": exatamente 3 objetos copiados dos KPIs reais (só o label/delta pode mudar).
4. "insights": exatamente 3 frases curtas e acionáveis citando números reais.
5. O gráfico já está definido como ${interp.tipoGrafico}; não é preciso devolvê-lo.

DADOS REAIS:
${JSON.stringify({ kpis: fonte.kpis, totais: { total: fonte.total, totalNoPeriodo: fonte.totalNoPeriodo, truncado: fonte.totalNoPeriodo > fonte.total, faturamento: fonte.faturamento }, grafico, tabela: fonte.tabela.slice(0, 12) })}
${fonte.totalNoPeriodo > fonte.total ? `\nATENÇÃO: os dados acima são um RECORTE — ${fonte.total} registros mais recentes de ${fonte.totalNoPeriodo} no período. Se escrever no resumo, deixe isso explícito.` : ''}

Pergunta do usuário: ${pergunta}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let r: Response;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 900,
              responseMimeType: 'application/json',
            },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!r.ok) return null;
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!texto) return null;

    const bruto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const i0 = bruto.indexOf('{');
    const i1 = bruto.lastIndexOf('}');
    const json = JSON.parse(
      i0 >= 0 && i1 > i0 ? bruto.slice(i0, i1 + 1) : bruto,
    ) as Record<string, unknown>;

    const kpisIa = (Array.isArray(json.kpis) ? json.kpis : [])
      .map((k) => normalizarKpi(k, fonte.kpis))
      .filter((k): k is KpiRelatorio => k !== null);
    const insightsIa = (Array.isArray(json.insights) ? json.insights : [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 240))
      .slice(0, 3);

    return {
      titulo:
        typeof json.tituloRelatorio === 'string' && json.tituloRelatorio.trim()
          ? json.tituloRelatorio.trim().slice(0, 140)
          : fb.titulo,
      resumo:
        typeof json.resumo === 'string' && json.resumo.trim()
          ? json.resumo.trim().slice(0, 600)
          : fb.resumo,
      kpis: kpisIa.length >= 3 ? kpisIa.slice(0, 3) : fb.kpis,
      insights: insightsIa.length > 0 ? insightsIa : fb.insights,
      grafico: fb.grafico,
    };
  } catch {
    return null;
  }
}

/**
 * Fluxo completo (Seção 33): fonte real → gráfico agregado → estrutura
 * (Gemini/fallback determinístico) → persistência em RelatorioGerado → DTO.
 */
export async function gerarRelatorioPorIA(args: {
  empresaId: string;
  pergunta: string;
  tab?: string;
  interpretacao: InterpretacaoPergunta;
  de?: string;
  ate?: string;
}): Promise<RelatorioGeradoDTO> {
  const { empresaId, pergunta, interpretacao, de, ate } = args;

  // 1. Fonte de dados REAL do Prisma (o `tab` já age como hint na interpretação).
  const fonte =
    interpretacao.fonte === 'financeiro'
      ? await getFinanceiro({ empresaId, de, ate })
      : interpretacao.fonte === 'estoque'
        ? await getEstoque({ empresaId })
        : await getVendas({ empresaId, de, ate });

  // 2. Gráfico agregado no agrupamento pedido (estoque já vem pronto na fonte).
  let grafico =
    interpretacao.fonte === 'estoque'
      ? fonte.grafico
      : await montarGrafico(interpretacao, { empresaId, de, ate });
  if (grafico.values.length === 0) grafico = fonte.grafico;

  // 3. Estrutura: Gemini quando disponível; senão fallback determinístico.
  const fb = estruturaFallback(fonte, interpretacao, grafico, de, ate);
  const ia = await estruturarComIA(pergunta, fonte, grafico, interpretacao, fb);
  const estrutura = ia ?? fb;

  const dados: DadosRelatorio = {
    resumo: estrutura.resumo,
    kpis: estrutura.kpis,
    tabela: fonte.tabela,
    grafico: estrutura.grafico,
    fonte: interpretacao.fonte,
    periodo: { de: de ?? null, ate: ate ?? null },
    fallback: ia === null,
  };

  // 4. Persistência (id e criadoEm vêm do banco).
  const salvo = await prisma.relatorioGerado.create({
    data: {
      empresaId,
      perguntaOriginal: pergunta,
      titulo: estrutura.titulo,
      tipo: interpretacao.fonte,
      dados: dados as unknown as Prisma.InputJsonValue,
      insights: estrutura.insights as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    id: salvo.id,
    empresaId,
    perguntaOriginal: pergunta,
    titulo: estrutura.titulo,
    tipo: interpretacao.fonte,
    dados,
    insights: estrutura.insights,
    criadoEm: salvo.criadoEm,
  };
}
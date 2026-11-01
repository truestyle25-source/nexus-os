'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Database, Download, RefreshCw } from 'lucide-react';

import api, { getToken } from '@/lib/api';
import { formatBRL, formatDate, formatNumber, formatPct } from '@/lib/format';
import {
  comFuso,
  intervaloDoPreset,
  mensagemErro,
  periodoAnterior,
  rotuloPonto,
  tendencia,
  PRESETS,
  type Alerta,
  type DashboardSerie,
  type DashboardStats,
  type DreDetalhes,
  type EstoqueResposta,
  type Falhas,
  type FluxoCaixa,
  type Meta,
  type PresetKey,
  type RhResposta,
  type RoiResposta,
  type SerieTotais,
} from '@/lib/dashboard';
import ModuleHeader from '@/components/ModuleHeader';
import { t as traduzir, tMenu } from '@/lib/i18n';
import {
  Badge,
  BarChart,
  EmptyState,
  InnerPanel,
  KpiCard,
  LineChart,
  Panel,
  SectionTitle,
  TabsPill,
  toneForStatus,
  type Trend,
} from '@/components/ui';

/**
 * Dashboard — visão geral da empresa com dados 100% reais.
 *
 * Cada painel é alimentado por um endpoint real do backend e, quando falha,
 * mostra a mensagem verdadeira (permissão negada, rede, etc.). Indicador que
 * o sistema não sabe calcular NÃO recebe número: o card mostra "—" e o
 * motivo. Nenhum valor é estimado, projetado ou preenchido à mão.
 */

const FONTES_DE_DADOS: Array<{ chave: string; endpoint: string; descricao: string }> = [
  {
    chave: 'stats',
    endpoint: 'GET /dashboard/stats',
    descricao:
      'Faturamento do mês corrente (vendas FINALIZADA), vendas de hoje e contagem de produtos e usuários ATIVO.',
  },
  {
    chave: 'serie',
    endpoint: 'GET /dashboard/serie',
    descricao:
      'Série do período por dia ou mês: faturamento, CMV, lucro, margem, quantidade de vendas, clientes distintos e LTV realizado.',
  },
  {
    chave: 'fluxo',
    endpoint: 'GET /fluxo-caixa',
    descricao:
      'Entradas, saídas, saldo realizado e projeção dos próximos 30 dias a partir dos lançamentos financeiros.',
  },
  {
    chave: 'dre',
    endpoint: 'GET /dre',
    descricao:
      'Deduções, impostos, despesas operacionais e percentuais do DRE no período (financeiro e vendas reais).',
  },
  {
    chave: 'roi',
    endpoint: 'GET /roi',
    descricao:
      'Compras RECEBIDAS × vendas FINALIZADAS no período: investimento, retorno, resultado e ROI.',
  },
  {
    chave: 'metas',
    endpoint: 'GET /metas',
    descricao: 'Metas cadastradas por tipo e período, com valor, realizado e percentual atingido.',
  },
  {
    chave: 'estoque',
    endpoint: 'GET /estoque',
    descricao:
      'Valor do estoque (só com permissão de custos), itens abaixo do mínimo e itens sem estoque.',
  },
  {
    chave: 'rh',
    endpoint: 'GET /rh/indicadores',
    descricao:
      'Headcount total e ativo, faltas, atrasos, horas extras, absenteísmo e turnover do mês.',
  },
  {
    chave: 'alertas',
    endpoint: 'GET /alertas',
    descricao: 'Alertas reais gerados pelas regras de automação da empresa autenticada.',
  },
];

/** Chips da barra de fluxo: o estado de cada etapa vem do dado real carregado. */
function etapasFluxo(
  t: SerieTotais | null,
  ind: EstoqueResposta['indicadores'] | undefined,
  fluxo: FluxoCaixa | null,
  dre: DreDetalhes | null,
) {
  return [
    { nome: 'PDV', detalhe: 'não consultado nesta tela' },
    {
      nome: 'Vendas',
      detalhe: t ? `${formatNumber(t.qtdVendas)} vendas no período` : 'sem dado no período',
    },
    {
      nome: 'Estoque',
      detalhe: ind ? `${formatNumber(ind.qtdBaixo)} itens abaixo do mínimo` : 'não consultado',
    },
    {
      nome: 'Financeiro',
      detalhe: fluxo ? `saldo ${formatBRL(fluxo.resumo.saldo)}` : 'não consultado',
    },
    { nome: 'Fiscal', detalhe: 'não consultado nesta tela' },
    {
      nome: 'DRE',
      detalhe: dre ? `resultado ${formatBRL(dre.resultadoOperacional)}` : 'não consultado',
    },
    { nome: 'Dashboard', detalhe: 'este painel' },
    { nome: 'IA', detalhe: 'não consultado nesta tela' },
  ];
}

/** Tom do badge conforme os valores reais de prioridade do backend. */
function tomPrioridade(prioridade: string) {
  const v = (prioridade || '').toUpperCase();
  if (v === 'CRITICA' || v === 'ALTA') return 'red';
  if (v === 'MEDIA') return 'amber';
  return 'neutral';
}

/** Linha rótulo → valor dos mini-cards. */
function Linha({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: string;
  tom?: 'amber' | 'red';
}) {
  const cor = tom === 'red' ? 'text-red-300' : tom === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/35">{rotulo}</span>
      <span className={`text-right ${cor}`}>{valor}</span>
    </div>
  );
}

type AbaFinanceiro = 'entradas' | 'saidas' | 'saldo' | 'projecao';

export default function Dashboard() {
  const router = useRouter();

  const [preset, setPreset] = useState<PresetKey>('mes');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  const periodo = useMemo(() => intervaloDoPreset(preset, de, ate), [preset, de, ate]);
  const janelaAnterior = useMemo(
    () => periodoAnterior(periodo.inicio, periodo.fim),
    [periodo.inicio, periodo.fim],
  );

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [serie, setSerie] = useState<DashboardSerie | null>(null);
  const [serieAnterior, setSerieAnterior] = useState<DashboardSerie | null>(null);
  const [fluxo, setFluxo] = useState<FluxoCaixa | null>(null);
  const [dre, setDre] = useState<DreDetalhes | null>(null);
  const [roi, setRoi] = useState<RoiResposta | null>(null);
  const [metas, setMetas] = useState<Meta[] | null>(null);
  const [estoque, setEstoque] = useState<EstoqueResposta | null>(null);
  const [rh, setRh] = useState<RhResposta | null>(null);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);

  // Defesa contra resposta fora do contrato (ex.: backend devolvendo
  // { alertas: [...] } ou qualquer objeto): mantém SEMPRE um array aqui,
  // para que .length/.slice/.map não quebrem a renderização do dashboard.
  const alertasSafe: Alerta[] = Array.isArray(alertas)
    ? alertas
    : ((alertas as any)?.data ?? (alertas as any)?.alertas ?? []);

  const [falhas, setFalhas] = useState<Falhas>({});
  const [loading, setLoading] = useState(true);
  const [abaFinanceiro, setAbaFinanceiro] = useState<AbaFinanceiro>('saldo');
  const [kpisRecolhidos, setKpisRecolhidos] = useState(false);
  const [fuso, setFuso] = useState('');

  // O fuso mostrado no rodapé é o real do navegador (nunca um valor fixo).
  useEffect(() => {
    try {
      setFuso(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    } catch {
      setFuso('');
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setFalhas({});

    const params = {
      periodoInicio: comFuso(periodo.inicio, '00:00'),
      periodoFim: comFuso(periodo.fim, '23:59'),
    };
    const paramsAnterior = {
      periodoInicio: comFuso(janelaAnterior.inicio, '00:00'),
      periodoFim: comFuso(janelaAnterior.fim, '23:59'),
    };

    const busca = async <T,>(chave: string, requisicao: () => Promise<{ data: T }>) => {
      try {
        const { data } = await requisicao();
        return data;
      } catch (err: any) {
        setFalhas((atual) => ({
          ...atual,
          [chave]: mensagemErro(err, 'Não foi possível consultar este endpoint.'),
        }));
        return null;
      }
    };

    const [rStats, rSerie, rSerieAnterior, rFluxo, rDre, rRoi, rMetas, rEstoque, rRh, rAlertas] =
      await Promise.all([
        busca('stats', () => api.get<DashboardStats>('/dashboard/stats')),
        busca('serie', () => api.get<DashboardSerie>('/dashboard/serie', { params })),
        busca('serieAnterior', () =>
          api.get<DashboardSerie>('/dashboard/serie', { params: paramsAnterior }),
        ),
        busca('fluxo', () => api.get<FluxoCaixa>('/fluxo-caixa', { params })),
        busca('dre', () => api.get<{ detalhes: DreDetalhes }>('/dre', { params })),
        busca('roi', () => api.get<RoiResposta>('/roi', { params })),
        busca('metas', () => api.get<{ metas: Meta[] }>('/metas')),
        busca('estoque', () => api.get<EstoqueResposta>('/estoque')),
        busca('rh', () => api.get<RhResposta>('/rh/indicadores')),
        busca('alertas', () => api.get<Alerta[]>('/alertas')),
      ]);

    setStats(rStats);
    setSerie(rSerie);
    setSerieAnterior(rSerieAnterior);
    setFluxo(rFluxo);
    setDre(rDre?.detalhes ?? null);
    setRoi(rRoi);
    setMetas(rMetas?.metas ?? null);
    setEstoque(rEstoque);
    setRh(rRh);
    setAlertas(rAlertas);
    setLoading(false);
  }, [periodo.inicio, periodo.fim, janelaAnterior.inicio, janelaAnterior.fim]);

  const [autenticado, setAutenticado] = useState(false);

  useEffect(() => {
    // O token só existe após a hidratação client-side (localStorage). Até
    // confirmarmos, o Dashboard não faz NENHUM request — isso elimina o 401
    // em carregamento quente e abas abertas sem sessão válida.
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setAutenticado(true);
  }, [router]);

  useEffect(() => {
    if (autenticado) {
      void carregar();
    }
  }, [autenticado, carregar]);

  // ── Valores derivados (sempre de dado real; sem estimativa) ──────────────
  const rotulos = serie?.pontos?.map((p) => rotuloPonto(p.periodo, serie.granularidade)) ?? [];
  const t = serie?.totais ?? null;
  const ta = serieAnterior?.totais ?? null;
  const ltv = serie?.ltv ?? null;
  const semCusto = serie ? !serie.permissaoCusto : false;
  // "Meta Atingida" precisa ser a meta do PERÍODO que a tela está mostrando.
//
// Antes era `metas[0]`, e `/metas` devolve TODAS as metas da empresa ordenadas
// por `percentual DESC` (gestao.routes.ts). Ou seja, o card exibia a meta mais
// bem atingida de qualquer mês e de qualquer tipo — trocando o período no
// alto da tela não mudava nada, e o número não descrevia o período visível.
// Agora a preferência é a meta cujo `periodo` (AAAA-MM) bate com o fim do
// intervalo escolhido; só sem nenhuma meta do período é que se mostra a mais
// alta de todas, e o card diz isso explicitamente.
const periodoDaMeta = periodo.fim.slice(0, 7);
const metasDoPeriodo = useMemo(
  () => (metas ?? []).filter((m) => String(m.periodo) === periodoDaMeta),
  [metas, periodoDaMeta],
);
const kpiMeta = useMemo(() => {
  const lista = metasDoPeriodo.length ? metasDoPeriodo : (metas ?? []);
  if (!lista.length) return null;
  // `metas` já vem ordenado por percentual DESC; entre as do período mantemos
  // a ordem do servidor em vez de reordenar por um critério inventado aqui.
  return lista[0];
}, [metasDoPeriodo, metas]);
const metaForaDoPeriodo = metasDoPeriodo.length === 0 && (metas ?? []).length > 0;
  const pctMeta = kpiMeta?.percentual != null ? Number(kpiMeta.percentual) : null;
  const lucroBrutoDre = dre && !semCusto ? dre.receitaLiquida - dre.custos : null;
  const ind = estoque?.indicadores;

  const statusDe = (chave: string) => {
    const f = falhas[chave];
    if (!f) return null;
    return /permiss/i.test(f) ? 'Sem permissão' : 'Indisponível';
  };

  const numero = (
    chave: string,
    v: number | null | undefined,
    fmt: (n: number) => string,
  ): string => {
    const st = statusDe(chave);
    if (st) return st;
    if (loading) return 'Carregando…';
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    return fmt(Number(v));
  };

  const reais = (chave: string, v: number | null | undefined) => numero(chave, v, formatBRL);
  const contagem = (chave: string, v: number | null | undefined) => numero(chave, v, formatNumber);
  const subDe = (chave: string, padrao: string) => falhas[chave] ?? padrao;

  const kpis: Array<{
    titulo: string;
    formulaKey?: string;
    valor: string;
    sub: string;
    trend?: Trend;
    trendTone?: 'good' | 'bad';
  }> = [
    {
      titulo: 'Faturamento Bruto',
      formulaKey: 'Faturamento Bruto',
      valor: reais('serie', t?.faturamento),
      sub: subDe('serie', 'Soma das vendas FINALIZADAS no período.'),
      trend: tendencia(t?.faturamento ?? null, ta?.faturamento ?? null),
    },
    {
      titulo: 'Receita Líquida',
      formulaKey: 'Receita Líquida',
      valor: reais('dre', dre?.receitaLiquida),
      sub: subDe('dre', 'Receita bruta − deduções e impostos (financeiro real).'),
    },
    {
      titulo: 'Número de Vendas',
      formulaKey: 'Número de Vendas',
      valor: contagem('serie', t?.qtdVendas),
      sub: subDe('serie', 'Vendas FINALIZADAS no período.'),
      trend: tendencia(t?.qtdVendas ?? null, ta?.qtdVendas ?? null),
    },
    {
      titulo: 'Ticket Médio',
      formulaKey: 'Ticket Médio',
      valor: reais('serie', t?.ticketMedio),
      sub: subDe('serie', 'Faturamento ÷ número de vendas.'),
      trend: tendencia(t?.ticketMedio ?? null, ta?.ticketMedio ?? null),
    },
    {
      titulo: 'CMV',
      formulaKey: 'CMV',
      valor: semCusto ? 'Sem permissão' : reais('serie', t?.cmv),
      sub: semCusto
        ? 'Exige a permissão de custos (custos.visualizar).'
        : subDe('serie', 'Custo dos itens vendidos no período.'),
      trend: semCusto ? 'neutral' : tendencia(t?.cmv ?? null, ta?.cmv ?? null),
      trendTone: 'bad',
    },
    {
      titulo: 'Lucro Bruto',
      formulaKey: 'Lucro Bruto',
      valor: semCusto ? 'Sem permissão' : reais('dre', lucroBrutoDre),
      sub: semCusto
        ? 'Exige a permissão de custos (custos.visualizar).'
        : subDe('dre', 'Receita líquida − CMV (financeiro e vendas reais).'),
      trendTone: 'good',
    },
    {
      titulo: 'Margem Bruta',
      formulaKey: 'Margem Bruta',
      valor: semCusto ? 'Sem permissão' : numero('dre', dre?.margemBruta, formatPct),
      sub: semCusto
        ? 'Exige a permissão de custos (custos.visualizar).'
        : subDe('dre', 'Lucro bruto ÷ receita líquida × 100.'),
    },
    {
      titulo: 'Despesas Operacionais',
      formulaKey: 'Despesas Operacionais',
      valor: reais('dre', dre?.despesas),
      sub: subDe('dre', 'Despesas financeiras do período, sem deduções e impostos.'),
      trendTone: 'bad',
    },
    {
      titulo: 'EBITDA',
      formulaKey: 'EBITDA',
      valor: '—',
      sub: 'Sem fonte: o sistema não registra depreciação nem amortização.',
    },
    {
      titulo: 'Lucro Líquido',
      formulaKey: 'Lucro Líquido',
      valor: reais('dre', dre?.lucroPrejuizo),
      sub: subDe('dre', 'Resultado operacional do período (o sistema não registra IR/CSLL).'),
      trendTone: 'good',
    },
    {
      titulo: 'Lucratividade',
      formulaKey: 'Lucratividade',
      valor: numero('dre', dre?.margemLiquida, formatPct),
      sub: subDe('dre', 'Lucro líquido ÷ receita bruta × 100.'),
      trendTone: 'good',
    },
    {
      titulo: 'Ponto de Equilíbrio',
      formulaKey: 'Ponto de Equilíbrio',
      valor: '—',
      sub: 'Sem fonte: as despesas não são separadas em custos fixos e variáveis.',
    },
    {
      titulo: 'ROI',
      formulaKey: 'ROI',
      valor: numero('roi', roi?.roi, formatPct),
      sub: subDe('roi', 'Compras RECEBIDAS × vendas FINALIZADAS no período.'),
      trendTone: 'good',
    },
    {
      titulo: 'CAC',
      formulaKey: 'CAC',
      valor: '—',
      sub: 'Sem fonte: não há registro de investimento em aquisição (marketing/vendas).',
    },
    {
      titulo: 'LTV (realizado)',
      valor: reais('serie', ltv?.ltvRealizado),
      sub: subDe(
        'serie',
        ltv
          ? `${formatNumber(ltv.clientesComHistorico)} clientes já compraram • realizado, sem projeção.`
          : 'Faturamento histórico ÷ clientes que já compraram.',
      ),
      trendTone: 'good',
    },
    {
      titulo: 'Meta Atingida',
      formulaKey: 'Meta Atingida',
      valor: pctMeta === null ? (loading ? 'Carregando…' : '—') : formatPct(pctMeta),
      sub: kpiMeta
        ? metaForaDoPeriodo
          ? `${kpiMeta.tipo} • ${kpiMeta.periodo} — não há meta de ${periodoDaMeta} cadastrada; esta é a mais alta da empresa.`
          : `${kpiMeta.tipo} • ${kpiMeta.periodo} • meta ${formatBRL(kpiMeta.metaValor)} • realizado ${formatBRL(kpiMeta.realizado)}`
        : subDe('metas', 'Nenhuma meta cadastrada para esta empresa.'),
    },
  ];

  // (os valores de `t`, `ta`, `ind`, `reais`, `contagem` e `numero` estão
  // definidos uma única vez acima, em "Valores derivados").

  // Indicadores derivados NÃO são recalculados aqui: cada card usa o valor que
  // o endpoint real devolveu (ver `kpis`). Nada é estimado por fórmula própria.

  const resumoFinanceiro = (() => {
    const f = fluxo?.resumo;
    const p = fluxo?.projecao30dias;
    if (abaFinanceiro === 'entradas')
      return {
        titulo: 'Entradas realizadas',
        valor: reais('fluxo', f?.totalEntradas),
        nota: 'Lançamentos de RECEITA com status PAGO no período selecionado.',
      };
    if (abaFinanceiro === 'saidas')
      return {
        titulo: 'Saídas realizadas',
        valor: reais('fluxo', f?.totalSaidas),
        nota: 'Lançamentos de DESPESA com status PAGO no período selecionado.',
      };
    if (abaFinanceiro === 'saldo')
      return {
        titulo: 'Saldo realizado',
        valor: reais('fluxo', f?.saldo),
        nota: 'Entradas realizadas − saídas realizadas no período selecionado.',
      };
    return {
      titulo: 'Projeção de saldo (30 dias)',
      valor: reais('fluxo', p?.saldoProjetado),
      nota: `Pendentes com vencimento nos próximos 30 dias: entradas ${reais(
        'fluxo',
        p?.entradas,
      )} e saídas ${reais('fluxo', p?.saidas)} — somadas ao saldo realizado.`,
    };
  })();

  return (
    <main className="admin-page">
      <ModuleHeader
        title={traduzir('dash_titulo', 'Dashboard')}
        subtitle={traduzir('dash_subtitulo', 'Visão geral da empresa — todos os números vêm dos endpoints reais do sistema.')}
      />

      {/* ── Barra de período ─────────────────────────────────────────────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Período"
          right={
            <div className="flex flex-wrap gap-1.5 justify-end">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPreset(p.key)}
                  className={`h-8 px-3 rounded-[10px] text-[12.5px] border transition ${
                    preset === p.key
                      ? 'bg-white text-black border-white font-medium'
                      : 'bg-[#121221] border-white/[0.08] text-white/50 hover:text-white hover:border-white/20'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          }
        >
          {preset === 'personalizado' ? 'Intervalo personalizado' : 'Resumo do período'}
        </SectionTitle>

        {preset === 'personalizado' && (
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <label className="text-[11.5px] text-white/40">
              De
              <input
                type="date"
                value={de || periodo.inicio}
                max={ate || periodo.fim}
                onChange={(e) => setDe(e.target.value)}
                className="block mt-1 h-9 px-3 rounded-[10px] bg-[#121221] border border-white/[0.08] text-[12.5px] text-white"
              />
            </label>
            <label className="text-[11.5px] text-white/40">
              Até
              <input
                type="date"
                value={ate || periodo.fim}
                min={de || periodo.inicio}
                onChange={(e) => setAte(e.target.value)}
                className="block mt-1 h-9 px-3 rounded-[10px] bg-[#121221] border border-white/[0.08] text-[12.5px] text-white"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Badge tone="accent">
            {formatDate(periodo.inicio)} → {formatDate(periodo.fim)}
          </Badge>
          <Badge tone="neutral">
            {traduzir('dash_periodo_vs', 'vs. {a} → {b}', { a: formatDate(janelaAnterior.inicio), b: formatDate(janelaAnterior.fim) })}
          </Badge>
          {serie && (
            <Badge tone="neutral">
              {traduzir(serie.granularidade === 'dia' ? 'dash_serie_dia' : 'dash_serie_mes', serie.granularidade === 'dia' ? 'série por dia' : 'série por mês')}
            </Badge>
          )}
          {semCusto && <Badge tone="amber">{traduzir('dash_sem_custo', 'custos ocultos: sem permissão')}</Badge>}

          <span className="flex-1" />

          <button
            type="button"
            onClick={() => {
              void carregar();
            }}
            disabled={loading}
            className="h-8 px-3 rounded-[10px] bg-[#1A1A2E] border border-white/[0.08] text-white/60 hover:text-white text-[12px] inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading
              ? traduzir('dash_atualizando', 'Atualizando…')
              : traduzir('dash_atualizar', 'Atualizar')}
          </button>
          <button
            type="button"
            onClick={() =>
              exportarCsv(
                `dashboard-${periodo.inicio}-a-${periodo.fim}`,
                ['Indicador', 'Valor exibido', 'Base real'],
                kpis.map((k) => [k.titulo, k.valor, k.sub]),
              )
            }
            className="h-8 px-3 rounded-[10px] bg-white text-black text-[12px] font-medium inline-flex items-center gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {traduzir('dash_exportar_csv', 'Exportar CSV')}
          </button>
        </div>
      </Panel>

      {Object.keys(falhas).length > 0 && (
        <Panel className="mb-5">
          <SectionTitle kicker={traduzir('dash_resposta_backend', 'Resposta real do backend')}>{traduzir('dash_paineis_vazios', 'Painéis sem carregar')}</SectionTitle>
          <ul className="mt-3 space-y-1.5">
            {Object.entries(falhas).map(([chave, msg]) => (
              <li key={chave} className="text-[11.5px] text-amber-300/80">
                <span className="text-white/40">{chave}</span> — {msg}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ── Indicadores (16 do Layout Mestre, todos com base real) ───────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Indicadores"
          right={
            <button
              type="button"
              onClick={() => setKpisRecolhidos((v) => !v)}
              className="h-8 px-3 rounded-[10px] bg-[#121221] border border-white/[0.08] text-white/50 hover:text-white text-[12px]"
            >
              {kpisRecolhidos ? 'Expandir 16 indicadores' : 'Recolher indicadores'}
            </button>
          }
        >
          Resultados do período
        </SectionTitle>

        {kpisRecolhidos ? (
          <p className="mt-3 text-[12px] text-white/35">
            Indicadores recolhidos — os mesmos valores seguem disponíveis no CSV exportado.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
            {kpis.map((k) => (
              <KpiCard
                key={k.titulo}
                title={k.titulo}
                value={k.valor}
                sub={k.sub}
                trend={k.trend}
                trendTone={k.trendTone}
                formulaKey={k.formulaKey}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* ── Gráficos: evolução do faturamento e margem × lucro ───────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
        <Panel>
          <SectionTitle kicker="Faturamento • Evolução">
            Vendas FINALIZADAS por {serie?.granularidade === 'mes' ? 'mês' : 'dia'}
          </SectionTitle>
          <div className="mt-4">
            <BarChart
              points={(serie?.pontos ?? []).map((p, i) => ({
                label: rotulos[i] ?? p.periodo,
                value: p.faturamento,
              }))}
              format="currency"
              emptyLabel={
                statusDe('serie')
                  ? (subDe('serie', '') as string)
                  : 'Nenhuma venda FINALIZADA no período selecionado.'
              }
            />
          </div>
          {t && (
            <p className="text-[11px] text-white/30 mt-2">
              Total do período: {formatBRL(t.faturamento)} • média por{' '}
              {serie?.granularidade === 'mes' ? 'mês' : 'dia'}: {formatBRL(t.vendasPorDia)}
            </p>
          )}
        </Panel>

        <Panel>
          <SectionTitle kicker="Margem × Lucro">
            {semCusto ? 'Lucro e margem exigem permissão de custos' : 'Por período'}
          </SectionTitle>
          <div className="mt-4">
            <LineChart
              labels={rotulos}
              series={[
                {
                  label: 'Lucro bruto (R$)',
                  color: '#34D399',
                  values: (serie?.pontos ?? []).map((p) => p.lucro),
                },
                {
                  label: 'Margem bruta (%)',
                  color: '#7C3AED',
                  values: (serie?.pontos ?? []).map((p) => p.margem),
                },
              ]}
              format="currency"
            />
          </div>
          {t && !semCusto && (
            <p className="text-[11px] text-white/30 mt-2">
              Lucro bruto do período: {formatBRL(t.lucroBruto)} • margem bruta:{' '}
              {t.margemBruta === null ? '—' : formatPct(t.margemBruta)}
            </p>
          )}
        </Panel>
      </div>

      {/* ── Vendas por período ───────────────────────────────────────────── */}
      <Panel className="mb-5">
        <SectionTitle kicker="Vendas por período • Barra">
          Quantidade de vendas FINALIZADAS
        </SectionTitle>
        <div className="mt-4">
          <BarChart
            points={(serie?.pontos ?? []).map((p, i) => ({
              label: rotulos[i] ?? p.periodo,
              value: p.qtdVendas,
            }))}
            color="#38BDF8"
            emptyLabel={
              statusDe('serie')
                ? (subDe('serie', '') as string)
                : 'Nenhuma venda FINALIZADA no período selecionado.'
            }
          />
        </div>
      </Panel>

      {/* ── Resumo financeiro em abas ────────────────────────────────────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Resumo | Financeiro"
          right={
            <span className="text-[11px] text-white/30">
              GET /fluxo-caixa — PAGO no período, PENDENTE vencendo em até 30 dias
            </span>
          }
        >
          Fluxo de caixa
        </SectionTitle>

        <TabsPill
          className="mt-4"
          items={[
            { key: 'entradas' as AbaFinanceiro, label: 'Entradas' },
            { key: 'saidas' as AbaFinanceiro, label: 'Saídas' },
            { key: 'saldo' as AbaFinanceiro, label: 'Saldo' },
            { key: 'projecao' as AbaFinanceiro, label: 'Projeção' },
          ]}
          value={abaFinanceiro}
          onChange={setAbaFinanceiro}
        />

        <InnerPanel className="mt-4 p-4">
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            {resumoFinanceiro.titulo}
          </div>
          <div className="text-[24px] font-bold text-white mt-1">{resumoFinanceiro.valor}</div>
          <p className="text-[11.5px] text-white/35 mt-1.5">{resumoFinanceiro.nota}</p>
        </InnerPanel>

        {fluxo && fluxo.serie.length > 1 && (
          <div className="mt-4">
            <LineChart
              labels={fluxo.serie?.map((s) => formatDate(s.dia)) ?? []}
              series={[
                {
                  label: 'Saldo acumulado (R$)',
                  color: '#FBBF24',
                  values: fluxo.serie?.map((s) => s.saldoAcumulado) ?? [],
                },
              ]}
              format="currency"
            />
          </div>
        )}
      </Panel>

      {/* ── Vendas • Estoque • RH ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
        <Panel>
          <SectionTitle kicker={tMenu('Vendas')}>{traduzir('dash_resultado_periodo', 'Resultado do período')}</SectionTitle>
          <div className="mt-3 space-y-1.5 text-[12px]">
            <Linha rotulo="Faturamento" valor={reais('serie', t?.faturamento)} />
            <Linha rotulo="Vendas finalizadas" valor={contagem('serie', t?.qtdVendas)} />
            <Linha rotulo="Ticket médio" valor={reais('serie', t?.ticketMedio)} />
            <Linha rotulo="Clientes distintos" valor={contagem('serie', t?.clientesDistintos)} />
          </div>
        </Panel>

        <Panel>
          <SectionTitle kicker={tMenu('Estoque')}>{traduzir('dash_posicao_atual', 'Posição atual')}</SectionTitle>
          <div className="mt-3 space-y-1.5 text-[12px]">
            <Linha rotulo="Valor em estoque" valor={reais('estoque', ind?.valorTotal)} />
            <Linha
              rotulo="Itens abaixo do mínimo"
              valor={contagem('estoque', ind?.qtdBaixo)}
              tom={ind && ind.qtdBaixo > 0 ? 'amber' : undefined}
            />
            <Linha
              rotulo="Itens sem estoque"
              valor={contagem('estoque', ind?.qtdSemEstoque)}
              tom={ind && ind.qtdSemEstoque > 0 ? 'red' : undefined}
            />
            <Linha rotulo={traduzir('dash_produtos_ativos', 'Produtos ativos')} valor={contagem('stats', stats?.produtosAtivos)} />
          </div>
        </Panel>

        <Panel>
          <SectionTitle kicker="RH">Indicadores do mês</SectionTitle>
          <div className="mt-3 space-y-1.5 text-[12px]">
            <Linha
              rotulo="Funcionários ativos"
              valor={`${contagem('rh', rh?.ativos)}${
                rh ? ` / ${formatNumber(rh.totalFuncionarios)}` : ''
              }`}
            />
            <Linha rotulo="Faltas hoje" valor={contagem('rh', rh?.faltas)} />
            <Linha rotulo="Atrasos hoje" valor={contagem('rh', rh?.atrasos)} />
            <Linha rotulo="Absenteísmo" valor={numero('rh', rh?.absenteismo, formatPct)} />
            <Linha rotulo="Turnover (mês)" valor={numero('rh', rh?.turnover, formatPct)} />
          </div>
        </Panel>
      </div>

      {/* ── Operação agora (dados do momento, não do período) ─────────────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Operação agora"
          right={
            <span className="text-[11px] text-white/30">
              GET /dashboard/stats — mês corrente e dia de hoje
            </span>
          }
        >
          {traduzir('dash_situacao_momento', 'Situação do momento')}
        </SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <KpiCard
            title={traduzir('dash_faturamento_mes', 'Faturamento do mês')}
            value={reais('stats', stats?.faturamentoMes)}
            sub="Vendas FINALIZADAS do mês corrente."
          />
          <KpiCard
            title={traduzir('dash_vendas_hoje', 'Vendas hoje')}
            value={contagem('stats', stats?.vendasHoje)}
            sub="Vendas FINALIZADAS hoje."
          />
          <KpiCard
            title={traduzir('dash_produtos_ativos', 'Produtos ativos')}
            value={contagem('stats', stats?.produtosAtivos)}
            sub="Produtos com status ATIVO."
          />
          <KpiCard
            title={traduzir('dash_usuarios_ativos', 'Usuários ativos')}
            value={contagem('stats', stats?.usuariosAtivos)}
            sub="Usuários com status ATIVO na empresa."
          />
        </div>
      </Panel>

      {/* ── Alertas reais (gerados pelas regras de automação) ────────────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Alertas"
          right={
            <span className="text-[11px] text-white/30">
              {alertas ? `${alertasSafe.length} alerta(s) da empresa` : 'GET /alertas'}
            </span>
          }
        >
          {traduzir('dash_requer_atencao', 'O que exige atenção agora')}
        </SectionTitle>

        {alertas === null ? (
          <p className="mt-3 text-[12px] text-white/35">{subDe('alertas', 'Carregando alertas…')}</p>
        ) : alertasSafe.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={Bell}
            title={traduzir('dash_nenhum_alerta', 'Nenhum alerta gerado')}
            description={traduzir('dash_nenhum_alerta_desc', 'Os alertas são criados pelas regras de automação SE/ENTÃO na página Alertas. Sem regra disparada, esta lista fica vazia — nenhum alerta é inventado aqui.')}
          />
        ) : (
          <ul className="mt-4 space-y-2">
            {alertasSafe.slice(0, 6).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-[12px] bg-[#121221] border border-white/[0.05] px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] text-white">{a.titulo}</div>
                  <div className="text-[11px] text-white/35 mt-0.5 leading-relaxed">
                    {a.descricao}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge tone={tomPrioridade(a.prioridade)}>{a.prioridade}</Badge>
                  <Badge tone={toneForStatus(a.status)} dot>
                    {a.status}
                  </Badge>
                  <span className="text-[10.5px] text-white/25">{formatDate(a.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── Fluxo entre módulos (estado real de cada etapa carregada) ─────── */}
      <Panel className="mb-5">
        <SectionTitle kicker="Fluxo">PDV ⇄ Estoque ⇄ Financeiro ⇄ Fiscal ⇄ DRE ⇄ IA</SectionTitle>
        <div className="flex flex-wrap gap-2 mt-4">
          {etapasFluxo(t, ind, fluxo, dre).map((etapa, i) => (
            <span
              key={etapa.nome}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-[10px] bg-[#121221] border border-white/[0.06] text-[11.5px]"
              title={etapa.detalhe}
            >
              <span className="text-white/70">{etapa.nome}</span>
              <span className="text-white/25">•</span>
              <span className="text-white/35">{etapa.detalhe}</span>
              {i < 7 && <span className="text-white/15 ml-1">⇄</span>}
            </span>
          ))}
        </div>
      </Panel>

      {/* ── Fontes de dados ─────────────────────────────────────────────── */}
      <Panel className="mb-5">
        <SectionTitle
          kicker="Auditoria dos dados"
          right={
            <button
              type="button"
              onClick={() =>
                exportarCsv(
                  `dashboard-fontes-${periodo.inicio}-a-${periodo.fim}`,
                  ['Endpoint', 'Status real', 'Descrição'],
                  FONTES_DE_DADOS.map((f) => [
                    f.endpoint,
                    falhas[f.chave] ? `ERRO: ${falhas[f.chave]}` : 'OK',
                    f.descricao,
                  ]),
                )
              }
              className="h-8 px-3 rounded-[10px] bg-[#121221] border border-white/[0.08] text-white/50 hover:text-white text-[12px]"
            >
              Exportar fontes
            </button>
          }
        >
          Fontes de dados (todas reais)
        </SectionTitle>

        <ul className="mt-4 divide-y divide-white/[0.05]">
          {FONTES_DE_DADOS.map((f) => (
            <li key={f.endpoint} className="py-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-white flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-white/25 shrink-0" />
                  {f.endpoint}
                </div>
                <p className="text-[11px] text-white/35 mt-1 leading-relaxed">{f.descricao}</p>
              </div>
              <div className="shrink-0">
                {falhas[f.chave] ? (
                  <Badge tone="amber">{traduzir('dash_indisponivel', 'Indisponível')}</Badge>
                ) : loading ? (
                  <Badge tone="neutral">{traduzir('dash_consultando', 'Consultando…')}</Badge>
                ) : (
                  <Badge tone="emerald" dot>
                    OK
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ── Rodapé institucional (locale/moeda/fuso reais do navegador) ───── */}
      <footer className="rounded-[16px] bg-[#1A1A2E] border border-white/[0.06] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] text-white/35">
          ⚡ NEXUS OS • Central de comando da empresa • v2.1
        </span>
        <span className="text-[11.5px] text-white/35">
          🌐 pt-BR • BRL • {fuso || 'fuso do navegador'} • DD/MM/AAAA • 24h
        </span>
      </footer>
    </main>
  );
}

/** Exporta dados reais já exibidos em tela para CSV (sem recálculo). */
function exportarCsv(nome: string, cabecalho: string[], linhas: Array<Array<string | number>>) {
  const csv = [cabecalho, ...linhas]
    .map((linha) => linha.map((celula) => `"${String(celula).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${nome}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar DEPOIS do clique, nunca antes: o navegador ainda está lendo o blob
  // de forma assíncrona quando ele some, e revogar no mesmo tique cancela o
  // download em vários navegadores — sem mensagem de erro nenhuma para o
  // gestor. O mesmo cuidado já existe em `lib/radar.tsx`; aqui a revogação
  // acontecia na linha seguinte ao `click()`, o que fazia os DOIS botões de
  // exportação ("Exportar CSV" e "Exportar fontes") falharem em silêncio.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}



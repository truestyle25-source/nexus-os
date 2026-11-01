// NEXUS OS — contratos e regras de período do Dashboard (apenas dados reais).
//
// Fica fora da página para que o cálculo de datas seja reutilizável e
// verificável: TODAS as datas são montadas em horário local e enviadas ao
// backend com o offset real do navegador, para o dia não deslocar em UTC-3.

export interface DashboardStats {
  faturamentoMes: number;
  vendasHoje: number;
  produtosAtivos: number;
  usuariosAtivos: number;
}

export interface SeriePonto {
  periodo: string;
  faturamento: number;
  cmv: number | null;
  lucro: number | null;
  margem: number | null;
  qtdVendas: number;
}

export interface SerieTotais {
  faturamento: number;
  cmv: number | null;
  lucroBruto: number | null;
  margemBruta: number | null;
  qtdVendas: number;
  ticketMedio: number | null;
  vendasPorDia: number;
  clientesDistintos: number;
}

export interface DashboardSerie {
  granularidade: 'dia' | 'mes';
  periodoInicio: string;
  periodoFim: string;
  periodoInformado: boolean;
  permissaoCusto: boolean;
  pontos: SeriePonto[];
  totais: SerieTotais;
  ltv: {
    ltvRealizado: number | null;
    cac: number | null;
    clientesComHistorico: number;
    faturamentoHistorico: number;
    observacao: string;
  };
}

export interface DreDetalhes {
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  custos: number;
  despesas: number;
  resultadoOperacional: number;
  lucroPrejuizo: number;
  /**
   * Margem em %. `null` quando não há receita no período para servir de
   * denominador — dividir por zero não é "margem 0%", é margem IMPOSSÍVEL de
   * calcular, e a tela mostra "—" nesse caso. O backend devolve `null` por
   * esse motivo; o tipo acompanha para ninguém "resolver" com `?? 0` e
   * transformar um período sem receita em margem zero.
   */
  margemBruta: number | null;
  margemLiquida: number | null;
  qtdVendas: number;
}

export interface FluxoCaixa {
  resumo: { totalEntradas: number; totalSaidas: number; saldo: number };
  projecao30dias: { entradas: number; saidas: number; saldoProjetado: number };
  serie: Array<{ dia: string; saldoAcumulado: number }>;
}

export interface RoiResposta {
  investimento: number;
  retorno: number;
  resultado: number;
  roi: number;
  base: string;
  limitacao: string;
}

export interface Meta {
  id: string;
  tipo: string;
  periodo: string;
  metaValor: string | number;
  realizado: string | number;
  percentual: string | number | null;
}

export interface EstoqueResposta {
  indicadores?: {
    valorTotal?: number;
    qtdBaixo: number;
    qtdSemEstoque: number;
  };
}

export interface RhResposta {
  totalFuncionarios: number;
  ativos: number;
  faltas: number;
  atrasos: number;
  absenteismo: number;
  turnover: number;
}

export interface Alerta {
  id: string;
  tipo: string;
  prioridade: string;
  titulo: string;
  descricao: string;
  status: string;
  createdAt: string;
}

/** Falha real de um endpoint (permissão negada, rede) — mostrada como veio. */
export type Falhas = Record<string, string>;

export type PresetKey =
  | 'hoje'
  | 'ontem'
  | '7d'
  | '30d'
  | 'mes'
  | 'mesAnterior'
  | 'trimestre'
  | 'semestre'
  | 'ano'
  | 'personalizado';

/** Data local em YYYY-MM-DD (nunca toISOString, que converte para UTC). */
export function diaLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Anexa o offset real do navegador: "2026-09-19T00:00:00-03:00". */
export function comFuso(data: string, hora: string): string {
  const offset = -new Date().getTimezoneOffset();
  const sinal = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${data}T${hora}:00${sinal}${hh}:${mm}`;
}

/** Intervalo do preset, sempre em datas locais do navegador. */
export function intervaloDoPreset(
  preset: PresetKey,
  de: string,
  ate: string,
): { inicio: string; fim: string } {
  const h = new Date();
  const d = (dt: Date) => diaLocal(dt);

  if (preset === 'personalizado') return { inicio: de || d(h), fim: ate || d(h) };
  if (preset === 'hoje') return { inicio: d(h), fim: d(h) };
  if (preset === 'ontem') {
    const ontem = new Date(h.getFullYear(), h.getMonth(), h.getDate() - 1);
    return { inicio: d(ontem), fim: d(ontem) };
  }
  if (preset === '7d' || preset === '30d') {
    const dias = preset === '7d' ? 6 : 29;
    return { inicio: d(new Date(h.getFullYear(), h.getMonth(), h.getDate() - dias)), fim: d(h) };
  }
  if (preset === 'mes') {
    return { inicio: d(new Date(h.getFullYear(), h.getMonth(), 1)), fim: d(h) };
  }
  if (preset === 'mesAnterior') {
    return {
      inicio: d(new Date(h.getFullYear(), h.getMonth() - 1, 1)),
      fim: d(new Date(h.getFullYear(), h.getMonth(), 0)),
    };
  }
  if (preset === 'trimestre') {
    return { inicio: d(new Date(h.getFullYear(), Math.floor(h.getMonth() / 3) * 3, 1)), fim: d(h) };
  }
  if (preset === 'semestre') {
    return { inicio: d(new Date(h.getFullYear(), h.getMonth() < 6 ? 0 : 6, 1)), fim: d(h) };
  }
  // ano
  return { inicio: d(new Date(h.getFullYear(), 0, 1)), fim: d(h) };
}

/** Janela imediatamente anterior, com a mesma quantidade de dias. */
export function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const i = new Date(`${inicio}T00:00:00`);
  const f = new Date(`${fim}T00:00:00`);
  const dias = Math.max(1, Math.round((f.getTime() - i.getTime()) / 86400000) + 1);
  const fimAnterior = new Date(i.getFullYear(), i.getMonth(), i.getDate() - 1);
  const inicioAnterior = new Date(
    fimAnterior.getFullYear(),
    fimAnterior.getMonth(),
    fimAnterior.getDate() - (dias - 1),
  );
  return { inicio: diaLocal(inicioAnterior), fim: diaLocal(fimAnterior) };
}

/** Rótulo curto do ponto do gráfico (DD/MM para dia, MM/AAAA para mês). */
export function rotuloPonto(periodo: string, granularidade: 'dia' | 'mes'): string {
  const partes = periodo.split('-');
  if (granularidade === 'mes') return `${partes[1]}/${partes[0]}`;
  return `${partes[2]}/${partes[1]}`;
}

/** Direção da tendência comparando com o período anterior real. */
export function tendencia(
  atual: number | null | undefined,
  anterior: number | null | undefined,
): 'up' | 'down' | 'neutral' {
  if (
    atual === null ||
    atual === undefined ||
    anterior === null ||
    anterior === undefined ||
    !Number.isFinite(atual) ||
    !Number.isFinite(anterior)
  )
    return 'neutral';
  if (atual > anterior) return 'up';
  if (atual < anterior) return 'down';
  return 'neutral';
}

export function mensagemErro(err: any, padrao: string): string {
  return err?.message || err?.response?.data?.error || padrao;
}

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'ontem', label: 'Ontem' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'mes', label: 'Este mês' },
  { key: 'mesAnterior', label: 'Mês anterior' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'semestre', label: 'Semestre' },
  { key: 'ano', label: 'Ano' },
  { key: 'personalizado', label: 'Personalizado' },
];

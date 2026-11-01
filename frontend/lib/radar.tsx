/**
 * Camada de dados do Radar Organizacional.
 *
 * O que mudou: a tela deixou de gerar número no navegador. Ela pede
 * `GET /radar/resumo` (backend/src/modules/radar/radar.routes.ts) e usa o que
 * vier de lá. Se a chamada falhar — backend fora, token expirado, empresa sem
 * cadastro — a tela mostra o ERRO e o estado fica vazio, sem número inventado.
 *
 * NÃO EXISTE MAIS BASE DEMONSTRATIVA. Antes, quando a API falhava, a tela caía
 * em 12 colaboradores e 8 alertas fictícios. Hoje:
 *  - enquanto carrega, mostra "Carregando…";
 *  - se a chamada falha, mostra o erro;
 *  - se a empresa não tem cadastro/ponto, o backend devolve `faltando` com o
 *    motivo, e a tela mostra esse motivo.
 *
 * Por que a queda é preferível à base de exemplo: uma tela de RH que abre em
 * branco porque a API caiu é ruim, mas uma tela de RH com número inventado é
 * pior — o gestor lê "12 colaboradores" e não tem como saber que nenhum deles
 * existe.
 *
 * Campos que o backend devolve como `null` (eNPS, DISC, bem-estar...) NÃO são
 * preenchidos aqui com valor plausível. Viram `null` e a interface mostra "—".
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import api from './api';

export type Criticidade = 'Alta' | 'Média' | 'Baixa';
export type TipoAlertaTela = 'Burnout' | 'Gargalo' | 'Clima' | 'Cliente';
export type StatusAlertaTela = 'Novo' | 'Em ação' | 'Resolvido';
export type PerfilDISC = 'D' | 'I' | 'S' | 'C';

/**
 * As parcelas que compõem um risco, já ponderadas para 0–100.
 *
 * `resultado` é a única que NÃO vem da pessoa: é o quanto a OPERAÇÃO do setor
 * está longe do combinado (meta abaixo do crítico, ruptura de estoque). Por isso
 * ela entra na Gargalo e não no risco de ninguém. Sem meta e sem ruptura no
 * período, ela é 0 — e a Gargalo é simplesmente o risco do setor.
 */
export type ComponenteRisco = {
  absenteismo: number;
  horasExtras: number;
  disciplina: number;
  resultado: number;
};

export type SinaisFuncionario = {
  diasRegistrados: number;
  /** Minutos trabalhados no período (não são horas — o nome é explícito). */
  horasMin: number;
  horasExtrasMin: number;
  faltas: number;
  atrasos: number;
  absenteismoPct: number;
  extrasMediaDiaMin: number;
  diasAposPrevisto: number;
  minutosExcedentesMedia: number;
  saidasAntecipadas: number;
  inconsistencias: number;
  vendasQtd: number;
  vendasTotal: number;
  advertencias: number;
  suspensoes: number;
};

/**
 * Colaborador do Radar. Todo campo que o NEXUS OS não mede é `null` — e a
 * interface trata `null` como "não há dado", nunca como zero.
 *
 * `disc` e `bemEstar` vêm de tabelas onde o RH REGISTRA a avaliação
 * (AvaliacaoComportamental / PesquisaBemEstar). O Radar não infere nenhum dos
 * dois a partir de ponto ou venda: perfil comportamental e bem-estar são
 * avaliação humana, e inferir isso seria o "diagnóstico automático" que o
 * módulo proíbe.
 */
export type ColaboradorRadar = {
  id: string; nome: string; cargo: string | null; setor: string; status: string;
  usuarioId: string | null;
  horarioEntradaPrevisto: string | null; horarioSaidaPrevisto: string | null;
  disc: PerfilDISC | null; scores: Record<PerfilDISC, number> | null;
  discData: string | null; discObservacoes: string | null;
  /**
   * Id da avaliação vigente. O Plano de Desenvolvimento se ancora nela — é
   * dela que saem o perfil e os percentuais que o plano congela em snapshot.
   */
  discAvaliacaoId: string | null;
  bemEstar: number | null; bemEstarData: string | null; bemEstarResposta: string | null;
  /**
   * Plano de desenvolvimento em curso (Ciclo 1). `null` quando a pessoa não tem
   * nenhum — e a tela mostra a ausência explicitamente, nunca um plano de
   * exemplo. O backend nunca inclui plano CANCELADO aqui: cancelado sai do
   * acompanhamento e fica no histórico do RH.
   */
  planoDesenvolvimento: {
    id: string;
    objetivo: string;
    competencia: string;
    status: string;
    prazo: string | null;
    dataInicio: string;
    responsavelId: string | null;
    /** Derivado das ações gravadas pelo gestor — a tela não calcula nada. */
    progresso: { total: number; concluidas: number; percentual: number | null };
  } | null;
  risco: number; componentes: ComponenteRisco;
  descricao: string; online: boolean; pontuacao: number;
  sinais: SinaisFuncionario;
};

export type AlertaRadar = {
  id: string;
  ref: string;
  titulo: string;
  area: string;
  tipo: TipoAlertaTela;
  criticidade: Criticidade;
  /** `causas` carrega as EVIDÊNCIAS: os números que o gestor confere. */
  causas: string[];
  fato: string;
  impacto: string;
  sugestao: string;
  status: StatusAlertaTela;
  prazo: string;
  emoji: string;
  cor: string;
  origem: string;
  funcionarioId: string | null;
  acaoRadarId: string | null;
  /**
   * Plano de ação gravado para este alerta, ou `null` quando ainda não existe.
   * Adicionado ao DTO sem renomear nem remover nenhum campo anterior.
   */
  plano: {
    id: string;
    status: 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
    acoes: Array<{ texto: string; concluida: boolean }>;
    prazo: string | null;
    responsavelId: string | null;
    criadoEm: string;
  } | null;
};

export type AreaRisco = {
  area: string; risco: number; tamanho: number; pessoas: string[];
  componentes: ComponenteRisco;
};

export type EquipeRadar = {
  posicao: number; nome: string; pontos: number; medalha: 'Ouro' | 'Prata' | 'Bronze';
  cor: string; membros: string[]; meta: number; tamanho: number; temPontos: boolean;
};

export type PontoSerie = { semana: string; saude: number | null; produtividade: number | null; risco: number | null };
export type HeatmapRadar = { setores: string[]; semanas: string[]; valores: Array<Array<number | null>> };

/** Formato que a tela consome. Nasce VAZIO: não existe mais base de exemplo. */
export type RadarDados = {
  colaboradores: ColaboradorRadar[];
  alertas: AlertaRadar[];
  areasRisco: AreaRisco[];
  equipes: EquipeRadar[];
  heatmap: Array<Array<number | null>>;
  heatmapSetores: string[];
  heatmapSemanas: string[];
  evolucao: PontoSerie[];
  correlacaoHoras: Array<{ horas: number; produtividade: number; equipe: string }>;
  kpis: { extras: number | null; absenteismo: number | null; produtividade: number | null; enps: number | null; turnover: number | null };
  saudeMedia: number | null;
  /**
   * Nível real do Simulador What-If, calculado pelo servidor na MESMA função
   * que `POST /radar/simulacao` usa. Antes a tela carregava uma constante
   * `{70, 80, 70}` no navegador e anunciava "cenário atual: saúde 70%" para
   * qualquer empresa — número inventado apresentado como medição.
   * `null` enquanto o resumo não chegou (estado inicial).
   */
  nivelSimulacao: { saude: number; gargalo: number; burnout: number } | null;
  totalBadges: number | null;
  base: { colaboradores: number; departamentos: number; diasUteis: number; registrosPonto: number };
  sinais: { faltas: number; atrasos: number; saidasAntecipadas: number; inconsistencias: number };
  comercial: { vendasQtd: number; vendasTotal: number };
  rupturas: Array<{ produto: string; filial: string; quantidade: number; minimo: number }>;
  clientesInativos: Array<{ nome: string; diasSemComprar: number; valorTotal: number }>;
  metas: Array<{ id: string; tipo: string; periodo: string; metaValor: number; realizado: number; percentual: number; status: string }>;
  disc: { disponivel: boolean; motivo: string | null };
  bemEstar: { disponivel: boolean; motivo: string | null };
  gamificacao: { registros: number; pontos: number };
  faltando: Array<{ campo: string; motivo: string }>;
  periodo: { inicio: string; fim: string } | null;
};

export type ResumoRadarApi = Omit<RadarDados, 'heatmap' | 'heatmapSetores' | 'heatmapSemanas' | 'correlacaoHoras'> & {
  heatmap: HeatmapRadar;
  correlacaoHoras: Array<{ horas: number; absenteismo: number; equipe: string }>;
  fonte: 'dados_reais';
  geradoEm: string;
};

/** Estado vazio — o que a tela mostra ANTES da API responder. */
export const RADAR_VAZIO: RadarDados = {
  colaboradores: [], alertas: [], areasRisco: [], equipes: [],
  heatmap: [], heatmapSetores: [], heatmapSemanas: [],
  evolucao: [], correlacaoHoras: [],
  kpis: { extras: null, absenteismo: null, produtividade: null, enps: null, turnover: null },
  saudeMedia: null, totalBadges: null,
  nivelSimulacao: null,
  base: { colaboradores: 0, departamentos: 0, diasUteis: 0, registrosPonto: 0 },
  sinais: { faltas: 0, atrasos: 0, saidasAntecipadas: 0, inconsistencias: 0 },
  comercial: { vendasQtd: 0, vendasTotal: 0 },
  rupturas: [], clientesInativos: [], metas: [],
  disc: { disponivel: false, motivo: null },
  bemEstar: { disponivel: false, motivo: null },
  gamificacao: { registros: 0, pontos: 0 },
  faltando: [],
  periodo: null,
};

/** Converte a resposta da API no formato da tela. Só reordena e renomeia. */
export function normalizarResumo(resumo: ResumoRadarApi): RadarDados {
  return {
    colaboradores: resumo.colaboradores,
    alertas: resumo.alertas,
    areasRisco: resumo.areasRisco,
    equipes: resumo.equipes,
    heatmap: resumo.heatmap.valores,
    heatmapSetores: resumo.heatmap.setores,
    heatmapSemanas: resumo.heatmap.semanas,
    evolucao: resumo.evolucao,
    // A API correlaciona carga horária com absenteísmo (não há medição de
    // produtividade individual no NEXUS OS) — só o rótulo do eixo Y muda.
    correlacaoHoras: resumo.correlacaoHoras.map((p) => ({
      horas: p.horas, produtividade: p.absenteismo, equipe: p.equipe,
    })),
    kpis: resumo.kpis,
    saudeMedia: resumo.saudeMedia,
    nivelSimulacao: resumo.nivelSimulacao ?? null,
    totalBadges: resumo.totalBadges,
    base: resumo.base,
    sinais: resumo.sinais,
    comercial: resumo.comercial,
    rupturas: resumo.rupturas,
    clientesInativos: resumo.clientesInativos,
    metas: resumo.metas,
    disc: resumo.disc,
    bemEstar: resumo.bemEstar,
    gamificacao: resumo.gamificacao,
    faltando: resumo.faltando,
    periodo: resumo.periodo,
  };
}

export type EstadoRadar = {
  dados: RadarDados;
  carregando: boolean;
  erro: string | null;
  /** true quando a empresa não tem dado suficiente para qualquer análise. */
  semDados: boolean;
  recarregar: () => void;
  /** Muda a cada `recarregar()`: use como dependência para repetir buscas. */
  versao: number;
};

const RadarCtx = createContext<EstadoRadar | null>(null);

/**
 * Provider do Radar.
 *
 * NÃO EXISTE MAIS BASE DEMONSTRATIVA. Antes, quando a API falhava, a tela
 * mostrava 12 colaboradores e 8 alertas fictícios — o que a auditoria apontou
 * como o problema mais grave do módulo. Agora o estado nasce VAZIO:
 *  - enquanto carrega, a tela mostra "Carregando…";
 *  - se a chamada falha, mostra o erro e "Dados insuficientes para análise";
 *  - se a empresa não tem cadastro/ponto, o backend devolve `faltando` com o
 *    motivo, e a tela mostra esse motivo.
 * Nenhum número aparece sem vir do banco.
 */
export function RadarProvider({ children }: { children: ReactNode }) {
  const [dados, setDados] = useState<RadarDados>(RADAR_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    api
      .get('/radar/resumo')
      .then((r) => {
        if (!vivo) return;
        setDados(normalizarResumo(r.data as ResumoRadarApi));
        setErro(null);
        setCarregando(false);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(typeof e?.message === 'string' ? e.message : 'Não foi possível carregar o Radar.');
        setCarregando(false);
      });
    return () => { vivo = false; };
  }, [tentativa]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  const semDados = !carregando && !erro && dados.base.colaboradores === 0 && dados.base.registrosPonto === 0;

  return (
    <RadarCtx.Provider value={{ dados, carregando, erro, semDados, recarregar, versao: tentativa }}>
      {children}
    </RadarCtx.Provider>
  );
}

export function useRadar(): EstadoRadar {
  const ctx = useContext(RadarCtx);
  if (!ctx) throw new Error('useRadar precisa estar dentro de <RadarProvider>.');
  return ctx;
}

/** Número para cálculo, com fallback explícito quando o dado não existe. */
export function numOu(valor: number | null | undefined, fallback = 0): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : fallback;
}

/** Texto para exibição: "—" quando não há dado. */
export function txt(valor: number | null | undefined, sufixo = ''): string {
  return typeof valor === 'number' && Number.isFinite(valor) ? `${valor}${sufixo}` : '—';
}

/** Motivo pelo qual um campo não está disponível, para tooltips. */
export function useFaltando(campo: string): string | null {
  const { dados } = useRadar();
  return useMemo(() => dados.faltando.find((f) => f.campo === campo)?.motivo ?? null, [dados.faltando, campo]);
}

/** Texto padrão quando não há dado suficiente para análise. */
export const SEM_DADOS = 'Dados insuficientes para análise';

// ═══════════════════════════════════════════════════════════════════════════
// AÇÕES — as que antes só mostravam um toast de sucesso
// ═══════════════════════════════════════════════════════════════════════════

/** Converte a resposta base64 do backend num arquivo baixável de verdade. */
function baixarBase64(base64: string, nome: string, mime: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar depois do clique: revogar antes cancela o download em alguns
  // navegadores (o blob é lido de forma assíncrona).
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Exporta o relatório do Radar.
 *
 * `pdf` volta como bytes binários (o backend envia `application/pdf`), então vai
 * por `api.download`; `csv` volta como JSON com base64.
 */
export async function exportarRelatorio(
  formato: 'pdf' | 'csv',
  opcoes: { periodoInicio?: string; periodoFim?: string; setor?: string } = {},
): Promise<{ nome: string }> {
  if (formato === 'pdf') {
    const { blob, nome } = await api.download('/radar/relatorio', { post: true, body: { formato, ...opcoes } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { nome };
  }
  const r = await api.post('/radar/relatorio', { formato, ...opcoes });
  baixarBase64(r.data.base64, r.data.nome, r.data.mime || 'text/csv');
  return { nome: r.data.nome };
}

export type RespostaSimulacao = {
  suficiente: boolean;
  motivo: string | null;
  cenario: { saude: number; gargalo: number; burnout: number } | null;
  nivelAtual: { saude: number; gargalo: number; burnout: number } | null;
  deltas: { dSaude: number; dGargalo: number; dBurnout: number } | null;
  pressupostos: string[];
  aviso?: string;
  aplicaNoBanco?: boolean;
};

export async function rodarSimulacao(params: {
  prodAdd: number; vendasAdd: number; horasDelta: number;
  periodoInicio?: string; periodoFim?: string;
}): Promise<RespostaSimulacao> {
  const r = await api.post('/radar/simulacao', params);
  return r.data as RespostaSimulacao;
}

export async function criarPlanoDeAcao(params: {
  alertaRef: string;
  alertaTitulo: string;
  funcionarioId?: string | null;
  acoes: Array<{ texto: string; concluida: boolean }>;
  responsavelId?: string | null;
  prazo?: string | null;
  observacoes?: string | null;
}) {
  const r = await api.post('/radar/acoes', params);
  return r.data as { id: string; status: string; acoes: unknown; criadoEm: string };
}

export async function atualizarPlanoDeAcao(id: string, params: {
  status: 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
  acoes?: Array<{ texto: string; concluida: boolean }>;
  /** AAAA-MM-DD. `null` remove o prazo; ausente (undefined) preserva o atual. */
  prazo?: string | null;
}) {
  const r = await api.patch(`/radar/acoes/${id}`, params);
  return r.data as { id: string; status: string; acoes: unknown; prazo: string | null };
}

export type RespostaIA = { resposta: string; semBase: boolean; modeloIndisponivel?: boolean; contextoUsado?: unknown };

export async function perguntarRadar(pergunta: string, periodo?: { inicio?: string; fim?: string }): Promise<RespostaIA> {
  const r = await api.post('/radar/ia', {
    pergunta,
    periodoInicio: periodo?.inicio,
    periodoFim: periodo?.fim,
  });
  return r.data as RespostaIA;
}

export async function registrarAvaliacao(payload: {
  funcionarioId: string;
  perfil: 'D' | 'I' | 'S' | 'C' | null;
  scores?: Record<string, number> | null;
  observacoes?: string | null;
  dataAvaliacao: string;
}) {
  const r = await api.post('/radar/avaliacoes', payload);
  return r.data as { id: string; perfil: string | null; vigente: boolean };
}

export async function registrarBemEstar(payload: {
  funcionarioId: string;
  nota: number;
  resposta?: string | null;
  dataPesquisa: string;
}) {
  const r = await api.post('/radar/bem-estar', payload);
  return r.data as { id: string; nota: number };
}

export type PlacarGamificacao = {
  registros: Array<{ id: string; funcionarioId: string | null; tipo: string; descricao: string; pontos: number; regraId: string | null; data: string }>;
  totalPontos: number;
  porSetor: Array<{ setor: string; pontos: number }>;
};

export async function lerGamificacao(): Promise<PlacarGamificacao> {
  const r = await api.get('/radar/gamificacao');
  return r.data as PlacarGamificacao;
}



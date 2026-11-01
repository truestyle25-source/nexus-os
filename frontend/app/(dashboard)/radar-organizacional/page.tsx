'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t as traduzir } from '@/lib/i18n';
import {
  RadarProvider, useRadar, numOu, txt, SEM_DADOS,
  exportarRelatorio, rodarSimulacao, perguntarRadar, criarPlanoDeAcao,
  atualizarPlanoDeAcao, lerGamificacao,
} from '@/lib/radar';
import type { PlacarGamificacao } from '@/lib/radar';
// Ciclo 1 — Plano de Desenvolvimento DISC. Um único modal, usado também pela
// aba DISC de Relatórios: duas telas fazendo o mesmo trabalho divergem.
import PlanoDesenvolvimentoModal from '@/components/rh/PlanoDesenvolvimentoModal';
// Ciclo 2 — Treinamento. Os botões "Treinamento" e "Agendar" já existiam no
// Radar e avisavam que nada foi gravado; agora abrem o modal real.
import TreinamentoModal from '@/components/rh/TreinamentoModal';
// Ciclo 3 — Feedback de liderança. O botão "Enviar reconhecimento" do perfil
// prometia registrar algo e não gravava nada; agora grava a conversa.
import FeedbackLiderancaModal from '@/components/rh/FeedbackLiderancaModal';
// Ciclo 4 — os dois painéis que faltavam. Liderança Empática entra na aba
// Bem-estar (junto do card de Treinamento) e a Loja na aba Gamificação.
// Nenhum dos dois cria aba nova.
import LiderancaEmpaticPainel from '@/components/rh/LiderancaEmpaticPainel';
import LojaRecompensasPainel from '@/components/rh/LojaRecompensasPainel';
// Ciclo 5 — a política de pontos é da empresa, não uma constante do NEXUS.
import PontuacaoConfigPainel from '@/components/rh/PontuacaoConfigPainel';
// `api` direto, e não um helper novo em lib/radar: o módulo de treinamentos tem
// rotas próprias, e um wrapper de uma linha só seria estrutura sem propósito.
import api from '@/lib/api';
// Ciclo 3: a mesma convenção de cargo usada no backend, replicada aqui só para
// exibir a etiqueta "cargo de liderança" no modal. O BACKEND é quem decide —
// se divergissem, a tela mentiria sobre quem é líder.
//
// Sem `export`: arquivo 'use client' de App Router só pode exportar o
// componente default, e um export a mais quebra o tipo da rota.
const TERMOS_LIDERANCA_FRONT = [
  'LIDER', 'LÍDER', 'LIDERANCA', 'LIDERANÇA', 'GESTOR', 'GESTORA', 'GERENTE',
  'SUPERVISOR', 'SUPERVISORA', 'COORDENADOR', 'COORDENADORA', 'DIRETOR', 'DIRETORA',
  'DIRET', 'CHEFE', 'ENCARREGADO', 'ENCARREGADA', 'PREZIDENTE', 'HEAD',
];
function cargoIndicaLideranca(cargo: string | null | undefined): boolean {
  if (!cargo) return false;
  const limpo = cargo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  return TERMOS_LIDERANCA_FRONT.some((t) => {
    const termo = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return new RegExp(`(^|[^A-Z0-9])${termo}([^A-Z0-9]|$)`).test(limpo);
  });
}
import type {
  RadarDados, ColaboradorRadar, AlertaRadar, AreaRisco, EquipeRadar,
  Criticidade as RadarCriticidade, TipoAlertaTela, StatusAlertaTela,
  PerfilDISC as RadarPerfilDISC, PontoSerie,
} from '@/lib/radar';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Award, BarChart3, BookOpen,
  Brain, Building2, Calendar, CheckCircle2, ChevronRight, Clock, Download,
  FileText, Filter, Flame, Gauge, Gift, Heart, Layers, Fingerprint,
  LineChart as LineChartIcon, MessageSquare, PieChart as PieChartIcon,
  Radar as RadarIcon, Search, Shield, Smile, Sparkles, Star, Target,
  TrendingDown, TrendingUp, Trophy, Users, X, Zap,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

/**
 * Radar Organizacional — Saúde & Comportamento (V2).
 *
 * O LAYOUT é o aprovado e não mudou. O que mudou foi a origem de tudo que ele
 * mostra. Esta tela nasceu 100% client-side, com 12 colaboradores, 8 alertas,
 * um heatmap e um placar de gamificação inventados no próprio arquivo; todos
 * esses números foram removidos. Hoje:
 *
 *  - todo número vem de `GET /radar/resumo` (ou de `/radar/gamificacao`);
 *  - campo que o NEXUS OS não mede chega como `null` e a tela mostra "—",
 *    nunca um zero nem um valor plausível;
 *  - quando não há dado suficiente, o bloco mostra "Dados insuficientes para
 *    análise" em vez de um número inventado;
 *  - nada se apresenta como "tempo real" por conta própria: o que muda a tela é
 *    o gestor recarregando depois de um lançamento no módulo de origem;
 *  - as ações que gravam (plano de ação, avaliação DISC, bem-estar) vão para
 *    rotas reais; as que não têm rota (agendar treinamento, resgatar
 *    recompensa) avisam que nada foi gravado, em vez de dar sucesso falso.
 *
 * `localStorage` guarda só preferências de interface — quais regras de
 * pontuação o gestor deixou ligadas. Nenhum dado de empresa fica no navegador.
 */

type TabKey = 'visao' | 'preditivo' | 'disc' | 'bem' | 'gam' | 'rel';

/**
 * Os tipos da tela vêm de `@/lib/radar`, o mesmo contrato do endpoint
 * `GET /radar/resumo`. É por isso que todo campo que o NEXUS OS não mede é
 * `null` (e não `0`): a API devolve `null` onde não há fonte e a interface
 * mostra "—". Definir os tipos aqui de novo esconderia essa diferença e faria o
 * compilador aceitar número inventado.
 */
type Criticidade = RadarCriticidade;
type TipoAlerta = TipoAlertaTela;
type StatusAlerta = StatusAlertaTela;
type PerfilDISC = RadarPerfilDISC;
type Kpis = RadarDados['kpis'];
type Colaborador = ColaboradorRadar;
type Alerta = AlertaRadar;
type Equipe = EquipeRadar;

/** O que o PlanoModal entrega ao pai: o alerta de origem + o que foi marcado. */
type PlanoDeAcao = {
  alerta: Alerta;
  acoes: Array<{ texto: string; concluida: boolean }>;
  prazo: string | null;
  responsavel: string | null;
  /**
   * Status escolhido no modal. Só é enviado ao backend na EDIÇÃO
   * (`PATCH /radar/acoes/:id`) — na criação o servidor nasce ABERTA
   * e ignora este campo, então mandá-lo seria mentira.
   */
  status: 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
};

interface ToastItem {
  id: number;
  tipo: 'ok' | 'warn';
  titulo: string;
  mensagem: string;
}

const C = {
  bg: 'var(--nx-canvas)',
  card: 'var(--nx-surface)',
  cardHover: 'var(--nx-surface-2)',
  border: 'var(--nx-border)',
  inner: 'var(--nx-surface-2)',
  innerBorder: 'var(--nx-border)',
  primary: 'var(--nx-accent)',
  primary2: 'var(--nx-accent-2)',
  text: 'var(--nx-ink)',
  muted: 'var(--nx-ink-2)',
  dim: 'var(--nx-ink-3)',
  green: 'var(--nx-green)',
  amber: 'var(--nx-amber)',
  red: 'var(--nx-red)',
  blue: 'var(--nx-accent-2)',
};

const DISC_COLORS: Record<PerfilDISC, string> = {
  D: 'var(--nx-red)',
  I: 'var(--nx-amber)',
  S: 'var(--nx-green)',
  C: 'var(--nx-accent)',
};

const DISC_NOMES: Record<PerfilDISC, string> = {
  D: 'Dominância',
  I: 'Influência',
  S: 'Estabilidade',
  C: 'Conformidade',
};

/**
 * Ordem de urgência: Alta > Média > Baixa. Mesma do backend
 * (`radar.regras.ts`), para que a lista de sugestões da tela não reordene o
 * que o backend já ordenou.
 */
const ORDEM_CRITICIDADE: Record<Criticidade, number> = { Alta: 0, Média: 1, Baixa: 2 };
function ordemCriticidade(c: Criticidade): number {
  return ORDEM_CRITICIDADE[c] ?? 3;
}

const TABS: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
  { key: 'visao', label: 'Visão Geral', icon: Gauge },
  { key: 'preditivo', label: 'Preditivo & Alertas', icon: Brain },
  { key: 'disc', label: 'Perfis DISC', icon: RadarIcon },
  { key: 'bem', label: 'Bem-estar', icon: Heart },
  { key: 'gam', label: 'Gamificação', icon: Trophy },
  { key: 'rel', label: 'Relatórios', icon: FileText },
];


function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function corHeat(valor: number): string {
  if (valor > 80) return C.green;
  if (valor >= 60) return C.amber;
  return C.red;
}

function classificarHeat(valor: number): string {
  if (valor > 80) return 'saudável';
  if (valor >= 60) return 'atenção';
  return 'crítico';
}

function competenciaHeat(valor: number): string {
  if (valor > 80) return 'Alta performance';
  if (valor >= 60) return 'Estável com sinais de pressão';
  return 'Risco elevado de sobrecarga';
}

/**
 * Variação do KPI em relação à abertura da sessão.
 *
 * Antes o "delta" comparava o número atual com um baseline fixo (147 extras,
 * 87% de produtividade) inventado no próprio arquivo, o que fazia a tela
 * anunciar ganhos que ninguém tinha provocado. Agora o delta é calculado
 * contra o valor que o servidor entregou na primeira carga: se o dado não
 * mudou desde a abertura, o delta é "—" em vez de um número falso.
 */
function deltaKpi(atual: number | null, base: number | null, casas = 0): string {
  if (atual === null || base === null || !Number.isFinite(atual) || !Number.isFinite(base)) return '—';
  const d = atual - base;
  if (Math.abs(d) < 10 ** -casas / 2) return 'estável';
  const texto = casas > 0 ? d.toFixed(casas) : String(Math.round(d));
  return `${d > 0 ? '+' : ''}${texto}`;
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  return `${partes[0][0]}${partes.length > 1 ? partes[partes.length - 1][0] : ''}`.toUpperCase();
}

/**
 * Classificação DISC.
 *
 * O perfil NÃO é inferido de ponto, venda ou assiduidade — essa era a lógica
 * anterior, e ela produzia um laudo comportamental de fora de dados que não
 * medem comportamento. O NEXUS OS registra o que o RH avaliou em
 * `AvaliacaoComportamental`; aqui só lemos esse registro.
 */
function classificarDISC(pessoa: Colaborador): { perfil: PerfilDISC | null; motivo: string } {
  if (pessoa.disc) {
    return {
      perfil: pessoa.disc,
      motivo: pessoa.discData
        ? `Avaliação registrada pelo RH em ${pessoa.discData}.`
        : 'Avaliação registrada pelo RH.',
    };
  }
  if (!pessoa.scores) {
    return { perfil: null, motivo: 'Sem avaliação comportamental registrada — o RH precisa lançar a avaliação.' };
  }
  //_scores existam sem `perfil_ (registro antigo/incompleto): aí sim o
  // predominante é o melhor que há, e ele é declarado como tal.
  const ranking = (['D', 'I', 'S', 'C'] as PerfilDISC[])
    .map((perfil) => ({ perfil, valor: pessoa.scores![perfil] }))
    .sort((a, b) => b.valor - a.valor);
  return {
    perfil: ranking[0].perfil,
    motivo: `Maior pontuação nos scores registrados (${ranking[0].valor} pts).`,
  };
}

interface RiscoMatriz {
  nivel: 'Alto' | 'Médio' | 'Baixo';
  risco: string;
  descricao: string;
}

function riscoMatriz(scores: Record<PerfilDISC, number>, bemEstar: number, estresse: number): RiscoMatriz {
  if (scores.D > 75 && bemEstar < 60) {
    return { nivel: 'Alto', risco: 'Conflito', descricao: 'Dominância alta com bem-estar baixo eleva atrito e impulsividade.' };
  }
  if (scores.I > 75 && bemEstar < 50) {
    return { nivel: 'Alto', risco: 'Desengajamento', descricao: 'Influência alta sem energia tende a virar afastamento social.' };
  }
  if (scores.S > 75 && bemEstar < 50) {
    return { nivel: 'Alto', risco: 'Burnout silencioso', descricao: 'Estabilidade alta esconde sobrecarga até o limite.' };
  }
  if (scores.C > 75 && estresse > 70) {
    return { nivel: 'Alto', risco: 'Paralisia por análise', descricao: 'Perfil analítico sob estresse trava decisões.' };
  }
  if (bemEstar < 65 || estresse > 60) {
    return { nivel: 'Médio', risco: 'Atenção preventiva', descricao: 'Sinais iniciais de pressão pedem acompanhamento.' };
  }
  return { nivel: 'Baixo', risco: 'Equilíbrio saudável', descricao: 'Sem sinais relevantes de risco no ciclo atual.' };
}

/** pontos = entregas*50 + zeroExtra*30 + feedback*20 + ajuda*15 + curso*40 - atraso*30 - extras*20 */
function pontosGamificacao(entregas: number, zeroExtra: number, feedback: number, ajuda: number, curso: number, atraso: number, extras: number): number {
  return entregas * 50 + zeroExtra * 30 + feedback * 20 + ajuda * 15 + curso * 40 - atraso * 30 - extras * 20;
}

const CARD = 'bg-[var(--nx-surface)] border border-[var(--nx-border)] rounded-[20px] p-6 shadow-sm transition-all hover:border-[var(--nx-border-strong)]';
const INNER = 'bg-[var(--nx-surface-2)] border border-[var(--nx-border)] rounded-[12px] p-[14px_16px]';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[var(--nx-ink)] text-[13px] font-bold bg-[var(--nx-accent)] hover:opacity-90 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_GHOST = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-[10px] text-[13px] font-semibold bg-[var(--nx-surface-2)] border border-[var(--nx-border)] text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:border-[var(--nx-border-strong)] transition';
const FIELD = 'h-11 px-4 rounded-[12px] bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:border-[var(--nx-accent)] focus:outline-none transition-colors';

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-5 right-4 z-[70] flex w-full max-w-[380px] flex-col gap-[10px]">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={`radar-toast relative flex gap-[10px] overflow-hidden rounded-[14px] border px-4 py-3 shadow-2xl ${
            item.tipo === 'ok'
              ? 'bg-[var(--nx-surface)] border-[color-mix(in_srgb,var(--nx-green)_30%,var(--nx-border))]'
              : 'bg-[var(--nx-surface)] border-[color-mix(in_srgb,var(--nx-amber)_30%,var(--nx-border))]'
          }`}
        >
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              item.tipo === 'ok' ? 'bg-[color-mix(in_srgb,var(--nx-green)_15%,var(--nx-surface))] text-[var(--nx-green)]' : 'bg-[color-mix(in_srgb,var(--nx-amber)_15%,var(--nx-surface))] text-[var(--nx-amber)]'
            }`}
          >
            {item.tipo === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-[var(--nx-ink)]">{item.titulo}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--nx-ink-2)]">{item.mensagem}</p>
          </div>
          <button type="button" onClick={() => onDismiss(item.id)} className="text-[var(--nx-ink-3)] transition hover:text-[var(--nx-ink)]" aria-label={traduzir('fechar_aviso', "Fechar aviso")}>
            <X className="h-3.5 w-3.5" />
          </button>
          <span className="radar-toast-progress absolute bottom-0 left-0 h-[2px] bg-[var(--nx-accent)]" />
        </div>
      ))}
    </div>
  );
}

/**
 * `positivo` é opcional de propósito: quando é `undefined` o cartão não tem
 * comparação possível (ex.: turnover, que exigiria histórico de desligamentos)
 * e mostra "—" em cinza, em vez de inventar um número e uma seta de tendência.
 */
function KpiCard({ label, value, delta, positivo, hint }: { label: string; value: string; delta: string; positivo?: boolean; hint: string }) {
  const semDado = positivo === undefined;
  const corChip = semDado
    ? 'bg-[var(--nx-surface-2)] text-[var(--nx-ink-3)] border border-[var(--nx-border)]'
    : positivo
      ? 'bg-[color-mix(in_srgb,var(--nx-green)_10%,var(--nx-surface))] text-[var(--nx-green)] border border-[color-mix(in_srgb,var(--nx-green)_20%,var(--nx-border))]'
      : 'bg-[color-mix(in_srgb,var(--nx-red)_10%,var(--nx-surface))] text-[var(--nx-red)] border border-[color-mix(in_srgb,var(--nx-red)_20%,var(--nx-border))]';
  return (
    <div className={CARD} title={hint}>
      <p className="text-[12px] font-semibold uppercase tracking-[1.2px] text-[var(--nx-ink-3)]">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-[26px] font-bold leading-none tracking-tight text-[var(--nx-ink)]">{value}</p>
        <span className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] font-bold ${corChip}`}>
          {!semDado && (positivo ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
          {delta}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-[var(--nx-ink-3)]">{hint}</p>
    </div>
  );
}

/**
 * Os rótulos (setores/semanas) vêm junto da matriz: com dados reais quem manda
 * no eixo é o backend, não as constantes do catálogo local. Célula `null`
 * significa "sem batida naquela semana" e é desenhada neutra — pintar 0% ali
 * seria afirmar absenteismo total onde só não há registro.
 */
function Heatmap({
  dados,
  setores,
  semanas,
}: {
  dados: Array<Array<number | null>>;
  setores: string[];
  semanas: string[];
}) {
  const grade = `grid-cols-[92px_repeat(${Math.max(1, semanas.length)},minmax(0,1fr))]`;
  return (
    <div className="min-w-[540px]">
      <div className={`mb-2 grid ${grade} gap-2`}>
        <span />
        {semanas.map((semana) => (
          <span key={semana} className="text-center text-[12px] font-bold uppercase tracking-[1px] text-[var(--nx-ink-3)]">
            {semana}
          </span>
        ))}
      </div>
      {setores.map((setor, linha) => (
        <div key={setor} className={`mb-2 grid ${grade} items-center gap-2`}>
          <span className="truncate text-[12px] font-semibold text-[var(--nx-ink-2)]">{setor}</span>
          {(dados[linha] ?? []).map((valor, coluna) => (
            <div
              key={semanas[coluna] ?? `c${coluna}`}
              title={valor === null
                ? `${setor} • ${semanas[coluna] ?? ''} • sem registro de ponto`
                : `${setor} • ${semanas[coluna] ?? ''} • Saúde ${valor}% (${classificarHeat(valor)}) — ${competenciaHeat(valor)}`}
              className="radar-heat flex h-9 cursor-help items-center justify-center rounded-[8px] text-[12px] font-bold transition-transform hover:scale-105"
              style={{
                backgroundColor: valor === null ? 'var(--nx-surface-3)' : `color-mix(in srgb, ${corHeat(valor)} 22%, var(--nx-surface))`,
                color: valor === null ? 'var(--nx-ink-3)' : 'var(--nx-ink)',
              }}
            >
              {valor === null ? '—' : valor}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-[var(--nx-ink-2)]">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.green }} /> &gt; 80 saudável
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.amber }} /> 60–80 atenção
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: C.red }} /> &lt; 60 crítico
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--nx-surface-3)' }} /> sem registro
        </span>
      </div>
    </div>
  );
}

type ToastFn = (titulo: string, mensagem: string, tipo?: 'ok' | 'warn') => void;

/**
 * Ações que NÃO têm endpoint correspondente.
 *
 * Restam quatro: agendar treinamento, redistribuir carga, resgatar recompensa
 * e registrar reconhecimento. Nenhuma delas tem rota no backend, então seguem
 * avisando que não foram feitas — nunca "sucesso" falso. Exportar relatório,
 * aplicar simulação, criar plano de ação, perguntar à IA e registrar
 * avaliação/bem-estar JÁ têm endpoint e foram ligados às rotas reais.
 */
function avisoSemBackend(notificar: ToastFn, titulo: string, detalhe: string) {
  notificar(
    titulo,
    `${detalhe} — esta ação não tem integração no NEXUS OS: nada foi gravado.`,
    'warn',
  );
}

/**
 * Comportamento comum aos três modais: trava o scroll do body, move o foco para
 * dentro do diálogo, fecha no Escape e prende o Tab entre os elementos focáveis.
 * Antes, só o PerfilModal tinha o "focus trap" — PlanoModal e ComoFuncionaModal
 * deixavam o foco escapar para a página de trás.
 */
function useModalAcessivel(
  dialogRef: React.RefObject<HTMLDivElement>,
  onClose: () => void,
  focoInicial?: React.RefObject<HTMLElement>,
) {
  useEffect(() => {
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (focoInicial?.current ?? dialogRef.current)?.focus();

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        onClose();
        return;
      }
      if (evento.key !== 'Tab') return;
      const focaveis = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focaveis || focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener('keydown', aoTeclar);
    };
  }, [dialogRef, onClose, focoInicial]);
}

function CritBadge({ criticidade }: { criticidade: Criticidade }) {
  const mapa: Record<Criticidade, string> = {
    Alta: 'bg-[color-mix(in_srgb,var(--nx-red)_10%,var(--nx-surface))] text-[var(--nx-red)] border-[color-mix(in_srgb,var(--nx-red)_25%,var(--nx-border))]',
    Média: 'bg-[color-mix(in_srgb,var(--nx-amber)_10%,var(--nx-surface))] text-[var(--nx-amber)] border-[color-mix(in_srgb,var(--nx-amber)_25%,var(--nx-border))]',
    Baixa: 'bg-[color-mix(in_srgb,var(--nx-green)_10%,var(--nx-surface))] text-[var(--nx-green)] border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))]',
  };
  return <span className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${mapa[criticidade]}`}>{criticidade}</span>;
}

function StatusBadge({ status }: { status: StatusAlerta }) {
  const mapa: Record<StatusAlerta, string> = {
    Novo: 'bg-[var(--nx-accent-2)]/10 text-[var(--nx-accent-ink)] border-[var(--nx-border)]',
    'Em ação': 'bg-[color-mix(in_srgb,var(--nx-amber)_10%,var(--nx-surface))] text-[var(--nx-amber)] border-[color-mix(in_srgb,var(--nx-amber)_25%,var(--nx-border))]',
    Resolvido: 'bg-[color-mix(in_srgb,var(--nx-green)_10%,var(--nx-surface))] text-[var(--nx-green)] border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))]',
  };
  return <span className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${mapa[status]}`}>{status}</span>;
}

function DiscMini({ perfil }: { perfil: PerfilDISC }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold shadow-xs"
      style={{ backgroundColor: DISC_COLORS[perfil], color: 'var(--nx-accent-ink)' }}
    >
      {perfil}
    </span>
  );
}

function ProgressBar({ valor, cor, altura = 8 }: { valor: number; cor: string; altura?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full bg-[var(--nx-surface-3)]" style={{ height: altura }}>
      <div className="radar-bar h-full rounded-full" style={{ width: `${clamp(valor, 0, 100)}%`, backgroundColor: cor }} />
    </div>
  );
}

function AvatarStack({ pessoas, max = 4 }: { pessoas: string[]; max?: number }) {
  const visiveis = pessoas.slice(0, max);
  const resto = pessoas.length - visiveis.length;
  return (
    <div className="flex items-center">
      {visiveis.map((pessoa, indice) => (
        <span
          key={`${pessoa}-${indice}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--nx-surface)] bg-[var(--nx-accent)] text-[11px] font-bold text-[var(--nx-ink)]"
          style={{ marginLeft: indice === 0 ? 0 : -8 }}
        >
          {pessoa}
        </span>
      ))}
      {resto > 0 && (
        <span className="ml-[-8px] flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--nx-surface)] bg-[var(--nx-surface-3)] text-[11px] font-bold text-[var(--nx-ink-2)]">
          +{resto}
        </span>
      )}
    </div>
  );
}

function AlertaResumo({ item, onPlano, onTreinamento }: { item: Alerta; onPlano: (alerta: Alerta) => void; onTreinamento: (contexto: string) => void }) {
  return (
    <div className={`${INNER} transition-colors hover:border-[var(--nx-border-strong)]`}>
      <div className="flex items-start gap-3">
        <span className="text-[18px] leading-none">{item.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-snug text-[var(--nx-ink)]">{item.titulo}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CritBadge criticidade={item.criticidade} />
            <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-2.5 py-1 text-[12px] font-bold text-[var(--nx-ink-2)]">
              {item.origem}
            </span>
            <span className="text-[12px] text-[var(--nx-ink-3)]">{item.area}</span>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">{item.causas.join(' • ')}</p>
          {item.plano && item.plano.status !== 'CANCELADA' && (
            <p className="mt-2 text-[12px] text-[var(--nx-accent-ink)] font-medium">
              Plano em andamento: {item.plano.acoes.filter((a) => a.concluida).length}/{item.plano.acoes.length} ações
              {item.plano.prazo ? ` • prazo ${item.plano.prazo}` : ''}
            </p>
          )}
          <button type="button" onClick={() => onPlano(item)} className={`${BTN_GHOST} mt-3 h-8 px-3 text-[12px]`}>
            {item.plano && item.plano.status !== 'CANCELADA' ? 'Gerenciar Plano de Ação' : 'Criar Plano de Ação'}{' '}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
/**
 * Distribuição DISC derivada das AVALIAÇÕES REGISTRADAS pelo RH.
 *
 * Antes eram 4 percentuais fixos (22/31/28/19) que não correspondiam a
 * ninguém. Agora conta os `scores`/`disc` que vieram de
 * `POST /radar/avaliacoes`. Sem nenhuma avaliação registrada, devolve `[]` e a
 * rosca some — a legenda diz que ainda não há avaliação, que é a verdade.
 */
function discDistribuicao(colaboradores: Colaborador[]) {
  const contagem: Record<PerfilDISC, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const pessoa of colaboradores) if (pessoa.disc) contagem[pessoa.disc] += 1;
  return (Object.keys(contagem) as PerfilDISC[])
    .filter((perfil) => contagem[perfil] > 0)
    .map((perfil) => ({
      perfil,
      nome: DISC_NOMES[perfil],
      value: contagem[perfil],
      cor: DISC_COLORS[perfil],
    }));
}

/**
 * Participação de um perfil entre as AVALIAÇÕES REGISTRADAS.
 *
 * O denominador é quem tem avaliação, não a base inteira: um percentual sobre
 * o total de colaboradores diria que "12% é D" quando o que se sabe é que 1 dos
 * 3 avaliados é D. Sem nenhuma avaliação, devolve o texto explícito em vez de 0%.
 */
function percentualBase(colaboradores: Colaborador[], perfil: PerfilDISC): string {
  const avaliados = colaboradores.filter((p) => p.disc);
  if (avaliados.length === 0) return 'sem avaliação';
  const n = avaliados.filter((p) => p.disc === perfil).length;
  return String(Math.round((n / avaliados.length) * 100)) + '% da base avaliada';
}

/** Mesma contagem, por setor, para o gráfico de barras. Null = sem avaliação. */
function discPorSetor(colaboradores: Colaborador[]) {
  const mapa = new Map<string, Record<PerfilDISC, number>>();
  for (const pessoa of colaboradores) {
    if (!pessoa.disc) continue;
    const linha = mapa.get(pessoa.setor) ?? { D: 0, I: 0, S: 0, C: 0 };
    linha[pessoa.disc] += 1;
    mapa.set(pessoa.setor, linha);
  }
  return [...mapa.entries()].map(([setor, contagem]) => ({ setor, ...contagem }));
}

function DiscDonut({ colaboradores }: { colaboradores: Colaborador[] }) {
  const dados = discDistribuicao(colaboradores);
  if (dados.length === 0) return <SemDados altura="240px" />;
  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={dados} dataKey="value" nameKey="nome" innerRadius="60%" outerRadius="85%" paddingAngle={3} stroke="none">
            {dados.map((item) => (
              <Cell key={item.perfil} fill={item.cor} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: '1px solid var(--nx-border)', borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} />
          <Legend verticalAlign="bottom" iconType="circle" formatter={(valor) => <span style={{ color: 'var(--nx-ink-2)', fontSize: 12 }}>{valor}</span>} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Placeholder único para todo bloco sem dado. É a regra do módulo: nunca
 * preencher buraco com número plausível — mostra-se o que falta.
 */
function SemDados({ altura, mensagem }: { altura?: string; mensagem?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-6 text-center"
      style={altura ? { minHeight: altura } : undefined}
    >
      <AlertTriangle className="h-4 w-4 text-[var(--nx-ink-3)]" />
      <p className="text-[13px] font-bold text-[var(--nx-ink-2)]">{SEM_DADOS}</p>
      <p className="max-w-[280px] text-[12px] leading-relaxed text-[var(--nx-ink-3)]">
        {mensagem ?? 'O módulo só mostra o que existe no banco desta empresa.'}
      </p>
    </div>
  );
}

function VisaoGeralTab({
  onTreinamento,
  kpis,
  kpisBase,
  heatmap,
  heatmapSetores,
  heatmapSemanas,
  alertas,
  colaboradores,
  areasRisco,
  onPlano,
  onToast,
  onIrPreditivo,
}: {
  kpis: Kpis;
  /** KPIs na primeira carga da sessão: base honesta dos deltas. */
  kpisBase: Kpis;
  heatmap: Array<Array<number | null>>;
  heatmapSetores: string[];
  heatmapSemanas: string[];
  alertas: Alerta[];
  colaboradores: Colaborador[];
  areasRisco: AreaRisco[];
  onPlano: (alerta: Alerta) => void;
  onTreinamento: (contexto: string) => void;
  onToast: ToastFn;
  onIrPreditivo: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={traduzir('horas_extras', "Horas extras")} value={txt(kpis.extras === null ? null : kpis.extras, 'h')} delta={deltaKpi(kpis.extras, kpisBase.extras)} positivo={kpis.extras === null || kpisBase.extras === null ? undefined : kpis.extras <= kpisBase.extras} hint={traduzir('variacao_horas_extras', "Variação em relação à abertura da sessão (menor é melhor)")} />
        <KpiCard label={traduzir('absenteismo', "Absenteísmo")} value={txt(kpis.absenteismo === null ? null : Number(kpis.absenteismo.toFixed(1)), '%')} delta={deltaKpi(kpis.absenteismo, kpisBase.absenteismo, 1)} positivo={kpis.absenteismo === null ? undefined : kpis.absenteismo <= numOu(kpisBase.absenteismo, Infinity)} hint={traduzir('variacao_absenteismo', "Variação em relação à abertura da sessão (menor é melhor)")} />
        <KpiCard label={traduzir('produtividade', "Produtividade")} value={txt(kpis.produtividade, '%')} delta={deltaKpi(kpis.produtividade, kpisBase.produtividade)} positivo={kpis.produtividade === null ? undefined : kpis.produtividade >= numOu(kpisBase.produtividade)} hint={traduzir('variacao_produtividade', "Variação em relação à abertura da sessão (maior é melhor)")} />
        <KpiCard label={traduzir('enps', "eNPS")} value={txt(kpis.enps)} delta={deltaKpi(kpis.enps, kpisBase.enps)} positivo={kpis.enps === null ? undefined : kpis.enps >= numOu(kpisBase.enps)} hint={traduzir('variacao_enps', "Variação em relação à abertura da sessão (maior é melhor)")} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.8fr_1fr]">
        <div className={CARD}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Mapa Calor Organizacional</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
                Saúde média por setor nas últimas 5 semanas — passe o mouse na célula para ver o detalhe.
              </p>
            </div>
            <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 py-1 text-[12px] font-bold text-[var(--nx-ink-2)]">
              {colaboradores.length} colaboradores
            </span>
          </div>
          <div className="overflow-x-auto pb-1">
            <Heatmap dados={heatmap} setores={heatmapSetores} semanas={heatmapSemanas} />
          </div>
        </div>

        <div className={CARD}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Alertas Preditivos IA</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Projeção dos próximos 14 dias</p>
            </div>
            <Brain className="h-4 w-4 text-[var(--nx-accent)]" />
          </div>
          <div className="space-y-3">
            {alertas.slice(0, 3).map((item) => (
              <AlertaResumo key={item.id} item={item} onPlano={onPlano} onTreinamento={onTreinamento} />
            ))}
          </div>
          <button type="button" onClick={onIrPreditivo} className={`${BTN_GHOST} mt-4 w-full`}>
            Ver todos os {alertas.length} alertas <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Distribuição DISC</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">{colaboradores.length} colaboradores da base nos {areasRisco.length} setores</p>
          <div className="mt-3 grid grid-cols-1 items-center gap-4 lg:grid-cols-[230px_1fr]">
            <DiscDonut colaboradores={colaboradores} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] border-collapse">
                <thead>
                  <tr>
                    {['Setor', 'D', 'I', 'S', 'C'].map((coluna) => (
                      <th key={coluna} className="pb-2 text-left text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {discPorSetor(colaboradores).map((linha) => (
                    <tr key={linha.setor} className="border-t border-[var(--nx-border)]">
                      <td className="py-2 text-[12px] font-semibold text-[var(--nx-ink)]">{linha.setor}</td>
                      {(['D', 'I', 'S', 'C'] as PerfilDISC[]).map((perfil) => (
                        <td key={perfil} className="py-2 text-[12px] font-bold" style={{ color: linha[perfil] > 0 ? DISC_COLORS[perfil] : 'var(--nx-ink-3)' }}>
                          {linha[perfil] > 0 ? linha[perfil] : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {discPorSetor(colaboradores).length === 0 && (
                <p className="mt-2 text-[12px] text-[var(--nx-ink-3)]">
                  Nenhuma avaliação comportamental registrada — o RH precisa lançar em Avaliações.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className={CARD}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Áreas com Risco de Burnout</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Probabilidade calculada por sinais de sobrecarga</p>
            </div>
            <Flame className="h-4 w-4 text-[var(--nx-red)]" />
          </div>
          {areasRisco.map((item) => {
            const cor = item.risco > 75 ? C.red : item.risco > 60 ? C.amber : C.green;
            return (
              <div key={item.area} className="mb-4 last:mb-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--nx-ink)]">{item.area}</span>
                    <span className="rounded-[6px] px-2 py-0.5 text-[12px] font-bold" style={{ color: cor, backgroundColor: `${cor}22` }}>
                      {item.risco}%
                    </span>
                  </div>
                  <AvatarStack pessoas={item.pessoas} />
                </div>
                <ProgressBar valor={item.risco} cor={cor} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onTreinamento(item.area)}
                    className={`${BTN_GHOST} h-8 px-3 text-[12px]`}
                  >
                    Treinamento
                  </button>
                  <button
                    type="button"
                    onClick={() => avisoSemBackend(onToast, 'Redistribuição não aplicada', `Carga de ${item.area}`)}
                    className={`${BTN_GHOST} h-8 px-3 text-[12px]`}
                  >
                    Redistribuir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface FiltrosAlertas {
  criticidade: Criticidade | 'Todas';
  tipo: TipoAlerta | 'Todos';
  status: StatusAlerta | 'Todos';
  busca: string;
}

interface SimuladorState {
  prodAdd: number;
  vendasAdd: number;
  horasDelta: number;
}

interface PreviewSimulacao {
  /** Nível projetado do indicador, em %. */
  saude: number;
  gargalo: number;
  burnout: number;
  /**
   * Variação em pontos percentuais em relação ao nível REAL observado.
   * Positivo = melhora em saúde; negativo = melhora em gargalo e burnout.
   */
  dSaude: number;
  dGargalo: number;
  dBurnout: number;
  /**
   * `true` quando não há base real para projetar. A tela diz isso na tela em vez
   * de exibir um "cenário atual" tirado do nada.
   */
  semBase: boolean;
}

/**
 * Calcula o cenário projetado e o delta contra o nível ATUAL REAL.
 *
 * `nivel` vem do servidor (`dados.nivelSimulacao`, mesma função que
 * `POST /radar/simulacao` chama). Antes era a constante `NIVEL_ATUAL =
 * {saude: 70, gargalo: 80, burnout: 70}` escrita no arquivo: a tela mostrava
 * "cenário atual: saúde 70%" para qualquer empresa, independentemente do
 * absenteísmo real — número inventado apresentado como medição.
 *
 * Os COEFICIENTES dos deltas continuam sendo uma estimativa local, e a tela
 * declara isso. Quem vale é o servidor: o botão "Aplicar Simulação" reenvia os
 * parâmetros e mostra o resultado de `POST /radar/simulacao`.
 */
function calcularSimulacao(
  simulador: SimuladorState,
  nivel: { saude: number; gargalo: number; burnout: number } | null,
): PreviewSimulacao {
  if (!nivel) {
    return { saude: 0, gargalo: 0, burnout: 0, dSaude: 0, dGargalo: 0, dBurnout: 0, semBase: true };
  }
  const dSaude = simulador.prodAdd * 3 + simulador.vendasAdd * 2 + simulador.horasDelta * 0.5;
  const dGargalo = -simulador.prodAdd * 12;
  const dBurnout = simulador.horasDelta * 0.8;
  return {
    saude: clamp(nivel.saude + dSaude, 0, 100),
    gargalo: clamp(nivel.gargalo + dGargalo, 0, 100),
    burnout: clamp(nivel.burnout + dBurnout, 0, 100),
    dSaude: Math.round(dSaude),
    dGargalo: Math.round(dGargalo),
    dBurnout: Math.round(dBurnout),
    semBase: false,
  };
}

function PreditivoTab({
  alertas,
  filtros,
  onFiltros,
  onPlano,
  simulador,
  onSimulador,
  onAplicar,
  nivelSimulacao,
}: {
  alertas: Alerta[];
  filtros: FiltrosAlertas;
  onFiltros: (parcial: Partial<FiltrosAlertas>) => void;
  onPlano: (alerta: Alerta) => void;
  simulador: SimuladorState;
  onSimulador: (parcial: Partial<SimuladorState>) => void;
  onAplicar: (preview: PreviewSimulacao) => void;
  /** Nível real observado, entregue por `/radar/resumo`. */
  nivelSimulacao: { saude: number; gargalo: number; burnout: number } | null;
}) {
  const preview: PreviewSimulacao = calcularSimulacao(simulador, nivelSimulacao);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
      <div className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Alertas Expandidos</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
              {alertas.length} alerta(s) com os filtros atuais • {alertas.length} alerta(s) detectado(s) nesta empresa
            </p>
          </div>
          <Filter className="h-4 w-4 text-[var(--nx-accent)]" />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <select
            value={filtros.criticidade}
            onChange={(evento) => onFiltros({ criticidade: evento.target.value as FiltrosAlertas['criticidade'] })}
            className={FIELD}
            aria-label={traduzir('filtrar_por_criticidade', "Filtrar por criticidade")}
          >
            <option value="Todas">Criticidade: todas</option>
            <option value="Alta">Alta</option>
            <option value="Média">Média</option>
            <option value="Baixa">Baixa</option>
          </select>
          <select
            value={filtros.tipo}
            onChange={(evento) => onFiltros({ tipo: evento.target.value as FiltrosAlertas['tipo'] })}
            className={FIELD}
            aria-label={traduzir('filtrar_por_tipo', "Filtrar por tipo")}
          >
            <option value="Todos">Tipo: todos</option>
            <option value="Burnout">Burnout</option>
            <option value="Gargalo">Gargalo</option>
            <option value="Clima">Clima</option>
            <option value="Cliente">{traduzir('cliente', "Cliente")}</option>
          </select>
          <select
            value={filtros.status}
            onChange={(evento) => onFiltros({ status: evento.target.value as FiltrosAlertas['status'] })}
            className={FIELD}
            aria-label={traduzir('filtrar_por_status', "Filtrar por status")}
          >
            <option value="Todos">Status: todos</option>
            <option value="Novo">Novo</option>
            <option value="Em ação">Em ação</option>
            <option value="Resolvido">Resolvido</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-ink-3)]" />
            <input
              value={filtros.busca}
              onChange={(evento) => onFiltros({ busca: evento.target.value })}
              placeholder={traduzir('buscar_alerta', "Buscar alerta...")}
              className={`${FIELD} w-full pl-9`}
              aria-label={traduzir('buscar_alerta', "Buscar alerta")}
            />
          </div>
        </div>

        <div className="space-y-3">
          {alertas.length === 0 && (
            <p className={`${INNER} text-center text-[12px] text-[var(--nx-ink-3)]`}>Nenhum alerta corresponde aos filtros.</p>
          )}
          {alertas.map((item) => (
            <article key={item.id} className="rounded-[14px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4 transition hover:border-[var(--nx-border-strong)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <span className="text-[18px] leading-none">{item.emoji}</span>
                  <div>
                    <p className="text-[13px] font-bold text-[var(--nx-ink)]">{item.titulo}</p>
                    <p className="mt-1 text-[12px] text-[var(--nx-ink-2)]">
                      {item.area} • {item.fato} • Impacto: {item.impacto}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CritBadge criticidade={item.criticidade} />
                  <StatusBadge status={item.status} />
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">Causas detectadas</p>
                  <ul className="mt-1.5 space-y-1">
                    {item.causas.map((causa) => (
                      <li key={causa} className="flex items-start gap-1.5 text-[12px] text-[var(--nx-ink-2)]">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.cor }} />
                        {causa}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">Sugestão da IA</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">{item.sugestao}</p>
                </div>
              </div>
              {item.plano && item.plano.status !== 'CANCELADA' && (
                <div className="mt-3 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">
                      Plano de ação
                    </p>
                    <span className="text-[12px] font-bold text-[var(--nx-accent-ink)]">
                      {item.plano.acoes.filter((a) => a.concluida).length}/{item.plano.acoes.length} ações concluídas
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {item.plano.acoes.map((acao, indice) => (
                      <li
                        key={`${item.plano?.id ?? 'p'}-${indice}`}
                        className={`flex items-start gap-1.5 text-[12px] ${
                          acao.concluida ? 'text-[var(--nx-ink-3)] line-through' : 'text-[var(--nx-ink)]'
                        }`}
                      >
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: acao.concluida ? 'var(--nx-green)' : 'var(--nx-accent)' }}
                        />
                        {acao.texto}
                      </li>
                    ))}
                  </ul>
                  {item.plano.prazo && (
                    <p className="mt-1.5 text-[12px] text-[var(--nx-ink-3)]">
                      Prazo do plano: {item.plano.prazo}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nx-border)] pt-3">
                <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--nx-ink-3)]">
                  <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Prazo {item.prazo}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {item.origem}</span>
                </div>
                <button type="button" onClick={() => onPlano(item)} className={`${BTN_PRIMARY} h-9 px-4 text-[12px]`}>
                  {item.plano && item.plano.status !== 'CANCELADA' ? 'Gerenciar Plano' : 'Criar Plano de Ação'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--nx-border-strong)] bg-[var(--nx-surface)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Brain className="h-4 w-4 text-[var(--nx-accent)]" />
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Simulador What-If</h2>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
          Ajuste o cenário e veja o impacto projetado na saúde, no gargalo e no burnout da operação.
        </p>
        <div className="space-y-5">
          <label className="block">
            <span className="flex items-center justify-between text-[12px] font-semibold text-[var(--nx-ink)]">
              Adicionar pessoas • Produção
              <span className="rounded-[6px] bg-[var(--nx-surface-2)] px-2 py-0.5 text-[12px] font-bold text-[var(--nx-accent-ink)]">+{simulador.prodAdd}</span>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={simulador.prodAdd}
              onChange={(evento) => onSimulador({ prodAdd: Number(evento.target.value) })}
              className="radar-slider mt-2 w-full"
              aria-label={traduzir('adicionar_pessoas_na_producao', "Adicionar pessoas na Produção")}
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-[12px] font-semibold text-[var(--nx-ink)]">
              Reforço • Vendas
              <span className="rounded-[6px] bg-[var(--nx-surface-2)] px-2 py-0.5 text-[12px] font-bold text-[var(--nx-accent-ink)]">+{simulador.vendasAdd}</span>
            </span>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={simulador.vendasAdd}
              onChange={(evento) => onSimulador({ vendasAdd: Number(evento.target.value) })}
              className="radar-slider mt-2 w-full"
              aria-label={traduzir('reforco_em_vendas', "Reforço em Vendas")}
            />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-[12px] font-semibold text-[var(--nx-ink)]">{traduzir('reduzir_horas_extras', "Reduzir horas extras")}<span className="rounded-[6px] bg-[var(--nx-surface-2)] px-2 py-0.5 text-[12px] font-bold text-[var(--nx-accent-ink)]">{simulador.horasDelta}%</span>
            </span>
            <input
              type="range"
              min={-50}
              max={20}
              step={5}
              value={simulador.horasDelta}
              onChange={(evento) => onSimulador({ horasDelta: Number(evento.target.value) })}
              className="radar-slider mt-2 w-full"
              aria-label={traduzir('reduzir_horas_extras', "Reduzir horas extras")}
            />
          </label>
        </div>

        <div className="mt-5 rounded-[14px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
          <p className="text-[12px] font-bold uppercase tracking-[1px] text-[var(--nx-ink-3)]">Preview do impacto</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {([
              { rotulo: 'Saúde', delta: preview.dSaude, bom: preview.dSaude >= 0 },
              { rotulo: 'Gargalo', delta: preview.dGargalo, bom: preview.dGargalo <= 0 },
              { rotulo: 'Burnout', delta: preview.dBurnout, bom: preview.dBurnout <= 0 },
            ]).map((item) => (
              <div key={item.rotulo} className="rounded-[10px] bg-[var(--nx-surface-3)] p-3">
                <p className="text-[12px] text-[var(--nx-ink-3)]">{item.rotulo}</p>
                <p
                  className="mt-1 text-[15px] font-bold"
                  style={{ color: preview.semBase ? 'var(--nx-ink-3)' : item.bom ? 'var(--nx-green)' : 'var(--nx-red)' }}
                >
                  {preview.semBase ? '—' : `${item.delta > 0 ? '+' : ''}${item.delta}%`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-[var(--nx-ink-2)]">
            {preview.semBase ? (
              <>
                Sem base real para projetar: o servidor ainda não entregou o nível atual dos
                indicadores desta empresa. Ajuste os sliders e use <strong>Aplicar Simulação</strong> —
                o cálculo é refeito no servidor, que responde se há dado suficiente.
              </>
            ) : (
              <>
                Projeção a partir do cenário atual medido (saúde {preview.saude}% • gargalo{' '}
                {preview.gargalo}% • burnout {preview.burnout}%). Os percentuais acima são a
                variação estimada em relação a esse cenário; <strong>Aplicar Simulação</strong>{' '}
                recalcula no servidor e é o resultado dele que vale.
              </>
            )}
          </p>
        </div>
        <button type="button" onClick={() => onAplicar(preview)} className={`${BTN_PRIMARY} mt-5 w-full`}>
          <Sparkles className="h-4 w-4" /> Aplicar Simulação
        </button>
      </div>
    </div>
  );
}

function ColabCard({ pessoa, onSelect }: { pessoa: Colaborador; onSelect: (pessoa: Colaborador) => void }) {
  const perfil = classificarDISC(pessoa);
  // Sem avaliação comportamental, o selo mostra "—" em vez de um perfil falso.
  const corPerfil = perfil.perfil ? DISC_COLORS[perfil.perfil] : C.dim;
  // O NEXUS OS não mede bem-estar. Quando não há dado, esta faixa mostra o
  // RISCO — que é derivado de absenteísmo, hora extra e disciplina, e portanto
  // é real. Mesmo componente, mesma classe, métrica honesta.
  const semBemEstar = pessoa.bemEstar === null;
  const valorBarra = semBemEstar ? pessoa.risco : numOu(pessoa.bemEstar);
  const corBarra = semBemEstar
    ? (pessoa.risco > 70 ? C.red : pessoa.risco > 40 ? C.amber : C.green)
    : (pessoa.bemEstar! > 75 ? C.green : pessoa.bemEstar! >= 50 ? C.amber : C.red);
  return (
    <article className="rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4 transition hover:scale-[1.02] hover:border-[var(--nx-border-strong)]">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--nx-accent)] text-[14px] font-bold text-[var(--nx-ink)] shadow-xs">
            {iniciais(pessoa.nome)}
          </span>
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--nx-surface)] ${
              pessoa.online ? 'bg-[var(--nx-green)]' : 'bg-[var(--nx-ink-3)]'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-[var(--nx-ink)]">{pessoa.nome}</p>
          <p className="truncate text-[12px] text-[var(--nx-ink-2)]">{pessoa.cargo}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--nx-ink-2)]">
              {pessoa.setor}
            </span>
            <span
              className="rounded-full border px-2.5 py-0.5 text-[12px] font-bold"
              style={{ color: corPerfil, backgroundColor: perfil.perfil ? `color-mix(in srgb, ${corPerfil} 14%, var(--nx-surface))` : 'rgba(var(--nx-ink-rgb) / 0.1)', borderColor: perfil.perfil ? `color-mix(in srgb, ${corPerfil} 32%, var(--nx-border))` : 'var(--nx-border)' }}
            >
              {perfil.perfil ? DISC_NOMES[perfil.perfil] : 'Sem perfil DISC'}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
        {pessoa.descricao} — {perfil.motivo}.
      </p>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[12px] text-[var(--nx-ink-2)]">
          <span>{semBemEstar ? 'Risco (derivado)' : 'Bem-estar'}</span>
          <span className="font-bold" style={{ color: corBarra }}>{txt(valorBarra, '%')}</span>
        </div>
        <ProgressBar valor={valorBarra} cor={corBarra} altura={6} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'Horas', valor: txt(Math.round(pessoa.sinais.horasMin / 60)) },
          { label: 'Faltas', valor: txt(pessoa.sinais.faltas) },
          { label: 'H. extra', valor: txt(Math.round(pessoa.sinais.horasExtrasMin / 60)) },
        ].map((metrica) => (
          <div key={metrica.label} className="rounded-[8px] bg-[var(--nx-surface-2)] p-[8px_10px] text-center">
            <p className="text-[12px] text-[var(--nx-ink-3)]">{metrica.label}</p>
            <p className="mt-0.5 text-[13px] font-bold text-[var(--nx-ink)]">{metrica.valor}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onSelect(pessoa)} className={`${BTN_GHOST} h-8 flex-1 px-2 text-[12px]`}>
          Ver perfil
        </button>
        <button type="button" onClick={() => onSelect(pessoa)} className={`${BTN_PRIMARY} h-8 px-3 text-[12px]`}>
          Plano
        </button>
      </div>
    </article>
  );
}

interface FiltrosDisc {
  setor: string;
  disc: PerfilDISC | 'Todos';
  busca: string;
}

const PERFIS_CARDS: Array<{ perfil: PerfilDISC; nome: string; tags: string; cor: string }> = [
  { perfil: 'D', nome: 'Dominância', tags: 'Desafiador • Direto • Decidido', cor: DISC_COLORS.D },
  { perfil: 'I', nome: 'Influência', tags: 'Comunicativo • Proativo • Otimista', cor: DISC_COLORS.I },
  { perfil: 'S', nome: 'Estabilidade', tags: 'Calmo • Paciente • Confiável', cor: DISC_COLORS.S },
  { perfil: 'C', nome: 'Conformidade', tags: 'Analítico • Preciso • Cauteloso', cor: DISC_COLORS.C },
];

function DiscTab({
  colaboradores,
  filtros,
  onFiltros,
  onSelect,
}: {
  colaboradores: Colaborador[];
  filtros: FiltrosDisc;
  onFiltros: (parcial: Partial<FiltrosDisc>) => void;
  onSelect: (pessoa: Colaborador) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {PERFIS_CARDS.map((item) => (
          <div
            key={item.perfil}
            className="rounded-[16px] border p-5 transition hover:scale-[1.02]"
            style={{ backgroundColor: `color-mix(in srgb, ${item.cor} 10%, var(--nx-surface))`, borderColor: `color-mix(in srgb, ${item.cor} 32%, var(--nx-border))` }}
          >
            <div className="flex items-center justify-between">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[15px] font-bold text-[var(--nx-ink)] shadow-xs"
                style={{ backgroundColor: `color-mix(in srgb, ${item.cor} 20%, var(--nx-surface))` }}
              >
                {item.perfil}
              </span>
              <span className="text-[12px] font-bold uppercase tracking-[1px]" style={{ color: item.cor }}>
                {(() => {
                  const total = colaboradores.filter((p) => p.disc).length;
                  const n = colaboradores.filter((p) => p.disc === item.perfil).length;
                  return percentualBase(colaboradores, item.perfil);
                })()}
              </span>
            </div>
            <p className="mt-3 text-[15px] font-bold text-[var(--nx-ink)]">{item.nome}</p>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-2)]">{item.tags}</p>
          </div>
        ))}
      </section>

      <section className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filtros.setor}
            onChange={(evento) => onFiltros({ setor: evento.target.value })}
            className={`${FIELD} min-w-[170px]`}
            aria-label={traduzir('filtrar_por_setor', "Filtrar por setor")}
          >
            <option value="Todos">Setor: todos</option>
            {[...new Set(colaboradores.map((c) => c.setor))].sort().map((nome) => (
              <option key={nome} value={nome}>{nome}</option>
            ))}
          </select>
          <select
            value={filtros.disc}
            onChange={(evento) => onFiltros({ disc: evento.target.value as FiltrosDisc['disc'] })}
            className={`${FIELD} min-w-[150px]`}
            aria-label={traduzir('filtrar_por_perfil_disc', "Filtrar por perfil DISC")}
          >
            <option value="Todos">Perfil: todos</option>
            <option value="D">D — Dominância</option>
            <option value="I">I — Influência</option>
            <option value="S">S — Estabilidade</option>
            <option value="C">C — Conformidade</option>
          </select>
          <div className="relative w-full min-w-[220px] sm:w-[280px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-ink-3)]" />
            <input
              value={filtros.busca}
              onChange={(evento) => onFiltros({ busca: evento.target.value })}
              placeholder={traduzir('buscar_por_nome_cargo_ou_setor', "Buscar por nome, cargo ou setor...")}
              className="h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] pl-9 pr-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:border-[var(--nx-accent)] focus:outline-none"
              aria-label={traduzir('buscar_colaborador', "Buscar colaborador")}
            />
          </div>
          <span className="text-[12px] text-[var(--nx-ink-3)]">{colaboradores.length} colaborador(es)</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {colaboradores.length === 0 && (
            <p className={`${INNER} col-span-full text-center text-[12px] text-[var(--nx-ink-3)]`}>
              Nenhum colaborador corresponde aos filtros selecionados.
            </p>
          )}
          {colaboradores.map((pessoa) => (
            <ColabCard key={pessoa.id} pessoa={pessoa} onSelect={onSelect} />
          ))}
        </div>
      </section>

      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Matriz DISC × Bem-estar</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
              Risco cruzado por perfil e nível de bem-estar — passe o mouse para ver conflito, desengajamento, burnout silencioso ou paralisia.
            </p>
          </div>
          <Layers className="h-4 w-4 text-[var(--nx-accent)]" />
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-[130px_repeat(4,minmax(0,1fr))] gap-2">
              <span />
              {(['D', 'I', 'S', 'C'] as PerfilDISC[]).map((perfil) => (
                <span key={perfil} className="text-center text-[12px] font-bold uppercase tracking-[1px]" style={{ color: DISC_COLORS[perfil] }}>
                  {perfil} — {DISC_NOMES[perfil]}
                </span>
              ))}
              {NIVEIS_MATRIZ.map((nivel) => (
                <div key={nivel.nome} className="contents">
                  <span className="flex items-center text-[12px] font-semibold text-[var(--nx-ink-2)]">
                    Bem-estar {nivel.nome}
                  </span>
                  {(['D', 'I', 'S', 'C'] as PerfilDISC[]).map((perfil) => {
                    const risco = riscoMatriz(SCORES_MATRIZ[perfil], nivel.bem, nivel.estresse);
                    const cor = risco.nivel === 'Alto' ? C.red : risco.nivel === 'Médio' ? C.amber : C.green;
                    return (
                      <div
                        key={`${nivel.nome}-${perfil}`}
                        title={`${risco.risco} (${risco.nivel}) — ${risco.descricao}`}
                        className="flex h-12 cursor-help flex-col items-center justify-center rounded-[10px] border text-[12px] font-bold"
                        style={{ backgroundColor: `${cor}22`, borderColor: `${cor}4d`, color: cor }}
                      >
                        {risco.risco}
                        <span className="text-[11px] font-semibold opacity-75">{risco.nivel}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const NIVEIS_MATRIZ = [
  { nome: 'Alto', bem: 85, estresse: 34 },
  { nome: 'Médio', bem: 66, estresse: 50 },
  { nome: 'Baixo', bem: 52, estresse: 62 },
  { nome: 'Crítico', bem: 38, estresse: 80 },
];

const SCORES_MATRIZ: Record<PerfilDISC, Record<PerfilDISC, number>> = {
  D: { D: 88, I: 42, S: 40, C: 44 },
  I: { D: 48, I: 86, S: 55, C: 45 },
  S: { D: 44, I: 52, S: 87, C: 56 },
  C: { D: 54, I: 40, S: 50, C: 90 },
};

function BemEstarTab({ kpis, kpisBase, colaboradores, onToast, onTreinamento }: { kpis: Kpis; kpisBase: Kpis; colaboradores: Colaborador[]; onToast: ToastFn; onTreinamento: (contexto: string, sugestao?: Record<string, any> | null) => void }) {
  // Ciclo 2: estado do card "Sugestões de Treinamento". Antes ele mostrava
  // três títulos fixos, sem cálculo nenhum por trás; agora guarda o que a IA
  // devolveu e, quando não devolve, o motivo.
  const [sugestaoTreinamento, setSugestaoTreinamento] = useState<Record<string, any> | null>(null);
  const [analisandoTreinamento, setAnalisandoTreinamento] = useState(false);
  const [motivoSemSugestao, setMotivoSemSugestao] = useState<string | null>(null);

  const pedirAnaliseTreinamento = useCallback(async () => {
    setAnalisandoTreinamento(true);
    setMotivoSemSugestao(null);
    try {
      const r = await api.post<any>('/rh/treinamentos/analisar', {});
      const d = (r as any).data ?? r;
      if (d?.sugestao) {
        setSugestaoTreinamento(d.sugestao);
      } else {
        // "Dados insuficientes" é RESPOSTA, não erro: o card escreve o motivo e
        // não mostra pauta nenhuma.
        setSugestaoTreinamento(null);
        setMotivoSemSugestao(d?.motivo ?? 'A IA não retornou sugestão.');
      }
    } catch (e: any) {
      setSugestaoTreinamento(null);
      setMotivoSemSugestao(e?.message ?? 'Não foi possível consultar a IA.');
    } finally {
      setAnalisandoTreinamento(false);
    }
  }, []);
  const { dados } = useRadar();
  const dadosSaudeMedia = dados.saudeMedia;
  const faltandoBemEstar = dados.faltando.find((f) => f.campo === 'bemEstar')?.motivo ?? null;
  // Só entram no gráfico as pessoas com ponto medido no período — um `null`
  // viraria um ponto solto sem significado. A correlação completa está na aba
  // Relatórios; aqui mostramos quem tem sinal real.
  const pontos = colaboradores
    .filter((p) => p.sinais.diasRegistrados > 0)
    .map((pessoa) => ({
      x: pessoa.sinais.horasMin,
      y: pessoa.sinais.faltas,
      z: Math.max(40, pessoa.risco),
      nome: pessoa.nome,
    }));

  return (
    <div className="space-y-4">

      {/* Ciclo 4 — Lideranca Empatica. Fica na aba Bem-estar, junto com o card de
          Sugestoes de Treinamento, como pedido. Nao cria aba nova. */}
      <LiderancaEmpaticPainel onToast={onToast} />
      <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={traduzir('enps', "eNPS")} value={txt(kpis.enps)} delta={deltaKpi(kpis.enps, kpisBase.enps)} positivo={kpis.enps === null ? undefined : kpis.enps >= numOu(kpisBase.enps)} hint={traduzir('variacao_enps', "Variação em relação à abertura da sessão")} />
        <KpiCard label={traduzir('turnover', "Turnover")} value={txt(kpis.turnover, '%')} delta={deltaKpi(kpis.turnover, kpisBase.turnover, 1)} positivo={kpis.turnover === null ? undefined : kpis.turnover <= numOu(kpisBase.turnover, Infinity)} hint={traduzir('variacao_turnover', "Variação em relação à abertura da sessão (menor é melhor)")} />
        <KpiCard label={traduzir('absenteismo', "Absenteísmo")} value={txt(kpis.absenteismo === null ? null : Number(kpis.absenteismo.toFixed(1)), '%')} delta={deltaKpi(kpis.absenteismo, kpisBase.absenteismo, 1)} positivo={kpis.absenteismo === null ? undefined : kpis.absenteismo <= numOu(kpisBase.absenteismo, Infinity)} hint={traduzir('variacao_absenteismo', "Variação em relação à abertura da sessão")} />
        <KpiCard label={traduzir('horas_extras', "Horas extras")} value={txt(kpis.extras, 'h')} delta={deltaKpi(kpis.extras, kpisBase.extras)} positivo={kpis.extras === null || kpisBase.extras === null ? undefined : kpis.extras <= kpisBase.extras} hint={traduzir('variacao_horas_extras', "Variação em relação à abertura da sessão")} />
        <KpiCard label={traduzir('media_bem_estar', "Média bem-estar")} value={txt(dadosSaudeMedia, '%')} delta="—" hint={faltandoBemEstar ?? traduzir('media_bem_estar_da_base', "Média da base de colaboradores")} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className={CARD}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Produtividade × Bem-estar</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
                Cada ponto é um colaborador; o tamanho representa o risco projetado.
              </p>
            </div>
            <Activity className="h-4 w-4 text-[var(--nx-accent)]" />
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: -8 }}>
                <CartesianGrid stroke={C.innerBorder} strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" name="Produtividade" unit="%" domain={[50, 100]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <YAxis type="number" dataKey="y" name="Bem-estar" unit="%" domain={[30, 100]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <ZAxis type="number" dataKey="z" range={[60, 260]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: C.border }}
                  contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }}
                />
                <Scatter name="Colaboradores" data={pontos} fill={C.primary} fillOpacity={0.75} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Leitura da IA</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Colaboradores com maior risco projetado no ciclo</p>
          <div className="mt-3 space-y-3">
            {[...colaboradores].sort((a, b) => b.risco - a.risco).slice(0, 4).map((pessoa) => {
              const cor = pessoa.risco > 70 ? C.red : pessoa.risco > 55 ? C.amber : C.green;
              return (
                <div key={pessoa.id} className={INNER}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {classificarDISC(pessoa).perfil
                        ? <DiscMini perfil={classificarDISC(pessoa).perfil!} />
                        : <span className="text-[12px] text-[var(--nx-ink-3)]">Sem perfil DISC</span>}
                      <span className="truncate text-[13px] font-semibold text-[var(--nx-ink)]">{pessoa.nome}</span>
                    </div>
                    <span className="shrink-0 text-[12px] font-bold" style={{ color: cor }}>Risco {pessoa.risco}%</span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[var(--nx-ink-2)]">
                    {pessoa.sinais.diasRegistrados} dia(s) de ponto • {Math.round(pessoa.sinais.horasMin / 60)}h • {pessoa.sinais.faltas} falta(s) • {Math.round(pessoa.sinais.horasExtrasMin / 60)}h extra
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--nx-ink-3)]">
            Quando a produtividade passa de 85% com bem-estar abaixo de 60%, o risco de burnout cresce de forma consistente no ciclo seguinte.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <div className={CARD}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-bold text-[var(--nx-ink)]">Sugestões de Treinamento</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
                Pauta sugerida pela IA a partir dos indicadores reais da empresa
              </p>
            </div>
            <BookOpen className="h-4 w-4 text-[var(--nx-accent)]" />
          </div>

          {/* Ciclo 2: o card deixou de mostrar três textos fixos.
              Ele pede a análise à IA e mostra o que ela devolveu — ou diz
              que não há dado suficiente. O layout é o mesmo; o conteúdo
              parou de ser ficção. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={pedirAnaliseTreinamento}
              disabled={analisandoTreinamento}
              className={`${BTN_PRIMARY} h-8 px-3 text-[12px] disabled:opacity-50`}
            >
              {analisandoTreinamento ? 'Analisando…' : sugestaoTreinamento ? 'Analisar de novo' : 'Analisar com IA'}
            </button>
            {sugestaoTreinamento && (
              <button
                type="button"
                onClick={() => onTreinamento('sugestão da IA', sugestaoTreinamento)}
                className={`${BTN_GHOST} h-8 px-3 text-[12px]`}
              >
                Agendar este treinamento
              </button>
            )}
          </div>

          {motivoSemSugestao ? (
            <p className="rounded-[12px] border border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
              {motivoSemSugestao} Nenhuma pauta é exibida sem dado real por trás — e nada foi
              gravado.
            </p>
          ) : sugestaoTreinamento ? (
            <div className="flex flex-col rounded-[14px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] p-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--nx-accent-2)]/20 text-[var(--nx-accent)]">
                <BookOpen className="h-4 w-4" />
              </span>
              <p className="mt-2 text-[12px] font-bold text-[var(--nx-ink)]">{sugestaoTreinamento.tema}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">{sugestaoTreinamento.objetivo}</p>
              {sugestaoTreinamento.publicoRecomendado && (
                <p className="mt-2 text-[12px] text-[var(--nx-ink-2)]">
                  <span className="font-bold text-[var(--nx-ink)]">Público: </span>
                  {sugestaoTreinamento.publicoRecomendado}
                </p>
              )}
              {sugestaoTreinamento.justificativa ? (
                <p className="mt-2 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-2.5 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
                  <span className="font-bold text-[var(--nx-ink)]">Base nos dados: </span>
                  {sugestaoTreinamento.justificativa}
                </p>
              ) : (
                <p className="mt-2 text-[12px] italic text-[var(--nx-ink-3)]">
                  A justificativa foi descartada: a IA citou número que não existe nos dados enviados.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.8px]" style={{ color: COR_PRIO[sugestaoTreinamento.prioridade] ?? COR_PRIO.MEDIA }}>
                  Prioridade {(sugestaoTreinamento.prioridade ?? '').toLowerCase()}
                </span>
                <span className="rounded-full border border-[var(--nx-border)] px-2 py-0.5 text-[12px] text-[var(--nx-ink-2)]">
                  {ROTULO_CATEGORIA_TREINAMENTO[sugestaoTreinamento.categoria] ?? sugestaoTreinamento.categoria}
                </span>
                {sugestaoTreinamento.duracaoMinutosSugerida && (
                  <span className="rounded-full border border-[var(--nx-border)] px-2 py-0.5 text-[12px] text-[var(--nx-ink-2)]">
                    {Math.floor(sugestaoTreinamento.duracaoMinutosSugerida / 60)}h
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onTreinamento('sugestão da IA', sugestaoTreinamento)}
                className={`${BTN_PRIMARY} mt-3 h-8 w-full px-3 text-[12px]`}
              >
                Agendar
              </button>
            </div>
          ) : (
            <p className="rounded-[12px] border border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
              Nenhuma análise pedida ainda. O botão acima pede à IA uma pauta a partir de
              atraso, hora extra, faltas e registros disciplinares desta empresa.
            </p>
          )}
        </div>
        <div className={CARD}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-bold text-[var(--nx-ink)]">Linha do Tempo do Cuidado</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Próximas ações de bem-estar</p>
            </div>
            <Calendar className="h-4 w-4 text-[var(--nx-accent)]" />
          </div>
          <div className="relative mt-4 pl-6">
            <span className="absolute bottom-2 left-[5px] top-2 w-px bg-[var(--nx-border)]" />
            {TIMELINE_BEM.map((evento, indice) => (
              <div key={evento.titulo} className="relative mb-5 last:mb-0">
                <span
                  className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-[var(--nx-surface-3)]"
                  style={{ backgroundColor: indice === 0 ? 'var(--nx-accent)' : 'var(--nx-border)' }}
                />
                <p className="text-[11px] font-bold uppercase tracking-[1px] text-[var(--nx-accent)]">{evento.quando}</p>
                <p className="mt-1 text-[12px] font-semibold text-[var(--nx-ink)]">{evento.titulo}</p>
                <p className="mt-0.5 text-[12px] text-[var(--nx-ink-2)]">{evento.detalhe}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// Ciclo 2 (decisão B): o array SUGESTOES_TREINAMENTO foi REMOVIDO de propósito.
// Ele mostrava três trainings fixos como "Recomendações por área com maior
// sinal de risco" sem cálculo nenhum por trás. O card agora pede a pauta à IA,
// a partir dos indicadores reais, e escreve "dados insuficientes" quando não há
// base. O LAYOUT do card não mudou — o que mudou foi ele parar de mentir.
//
// Cores e rótulos usados pelo card, que antes vinham do campo `cor` do array.
const COR_PRIO: Record<string, string> = { BAIXA: C.dim, MEDIA: C.amber, ALTA: C.red };
const ROTULO_CATEGORIA_TREINAMENTO: Record<string, string> = {
  COMUNICACAO: 'Comunicação', LIDERANCA: 'Liderança', ORGANIZACAO: 'Organização',
  SEGURANCA: 'Segurança', TECNICO: 'Técnico', ATENDIMENTO: 'Atendimento',
  GESTAO: 'Gestão', OUTRO: 'Outro',
};

const TIMELINE_BEM = [
  { quando: 'Hoje', titulo: 'Pesquisa de clima encerrada', detalhe: '87% de adesão • eNPS 72' },
  { quando: '3 dias', titulo: 'Grupo focal em Produção', detalhe: '6 participantes • foco em sobrecarga' },
  { quando: '7 dias', titulo: 'Devolutiva para gestores', detalhe: 'Plano de ação por área' },
  { quando: '21 dias', titulo: 'Reavaliação do Radar', detalhe: 'Comparativo com o ciclo anterior' },
];

/**
 * Catálogo de BADGES (conquistas).
 *
 * A lista de conquistas é fixa por decisão de política — o que NÃO é fixo é a
 * contagem: antes cada badge carregava um `count` inventado ("34 conquistas")
 * que não vinha de lugar nenhum. Agora a contagem sai de `RegistroGamificacao`
 * (agrupada por `regraId`), e badge sem registro aparece com 0.
 */
const CATALOGO_BADGES = [
  { regraId: 'prazo', emoji: '⏱️', nome: 'Entregador Pontual', criterio: '90%+ no prazo', cor: 'var(--nx-green)' },
  { regraId: 'zeroExtra', emoji: '💚', nome: 'Guardião do Equilíbrio', criterio: 'Zero hora extra por 4 semanas', cor: 'var(--nx-green)' },
  { regraId: 'feedback', emoji: '🤝', nome: 'Mentor', criterio: '10+ feedbacks positivos', cor: 'var(--nx-accent)' },
  { regraId: 'curso', emoji: '💡', nome: 'Inovador', criterio: '3+ ideias implementadas', cor: 'var(--nx-accent-2)' },
  { regraId: 'meta', emoji: '📣', nome: 'Comunicador', criterio: 'Comunicação 90%+', cor: 'var(--nx-amber)' },
  { regraId: 'objetivo', emoji: '🎯', nome: 'Foco Total', criterio: 'Meta batida em 3 meses', cor: 'var(--nx-red)' },
];


/**
 * Catálogo da loja de recompensas: saiu daqui.
 *
 * Antes esta lista era fixa no arquivo e o botão "Resgatar" só mostrava um aviso
 * de "não efetuado" — não gravava nada. Agora o catálogo vem de `Recompensa`, no
 * banco, e é gerenciado pelo `LojaRecompensasPainel` dentro desta mesma tela.
 */

function GamificacaoTab({
  equipes,
  registros,
  onToast,
  onComoFunciona,
}: {
  equipes: Equipe[];
  /** Registros de `RegistroGamificacao` — a única fonte de pontos. */
  registros: PlacarGamificacao['registros'];
  onToast: ToastFn;
  onComoFunciona: () => void;
}) {
  const semRegistros = registros.length === 0;
  // Conquistas contadas a partir de `regraId` — o que o RH realmente lançou.
  const conquistas = new Map<string, number>();
  for (const registro of registros) {
    if (!registro.regraId) continue;
    conquistas.set(registro.regraId, (conquistas.get(registro.regraId) ?? 0) + 1);
  }
  return (
    <div className="space-y-4">

      {/* Ciclo 4 — Loja de Recompensas. Entra AQUI, na aba de Gamificacao que ja existe, e nao numa aba nova. E o mesmo card que antes mostrava "Resgate nao efetuado" sem gravar nada. */}
      <LojaRecompensasPainel onToast={onToast} />
      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Gamificação Saudável</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
              Regras que premiam equilíbrio, colaboração e consistência — não apenas volume de entregas.
            </p>
          </div>
          <button type="button" onClick={onComoFunciona} className={BTN_GHOST}>
            <BookOpen className="h-3.5 w-3.5" />{traduzir('como_funciona', "Como funciona")}</button>
        </div>

        <div className="space-y-3">
          {equipes.map((equipe) => (
            <div
              key={equipe.nome}
              className="flex flex-wrap items-center gap-4 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-[18px] transition hover:scale-[1.01]"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[16px] font-bold"
                style={{ backgroundColor: `${equipe.cor}22`, color: equipe.cor }}
              >
                {equipe.temPontos ? equipe.posicao : '—'}
              </span>
              <div className="min-w-[150px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-bold text-[var(--nx-ink)]">{equipe.nome}</p>
                  {equipe.temPontos && (
                    <span
                      className="rounded-full border px-2.5 py-0.5 text-[12px] font-bold"
                      style={{ color: equipe.cor, backgroundColor: `${equipe.cor}1f`, borderColor: `${equipe.cor}4d` }}
                    >
                      {equipe.medalha}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--nx-ink-3)]">
                  {equipe.temPontos
                    ? `${equipe.pontos.toLocaleString('pt-BR')} pts`
                    : 'Sem registros de pontuação'}
                </p>
              </div>
              <div className="min-w-[190px] flex-1">
                <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--nx-ink-2)]">
                  <span>Meta saudável</span>
                  <span className="font-bold">{equipe.meta}%</span>
                </div>
                <ProgressBar valor={equipe.meta} cor={equipe.meta >= 85 ? C.green : equipe.meta >= 75 ? C.amber : C.red} altura={6} />
              </div>
              <AvatarStack pessoas={equipe.membros} max={5} />
            </div>
          ))}
          {equipes.length === 0 && (
            <SemDados mensagem="Nenhum setor com colaboradores cadastrados nesta empresa." />
          )}
        </div>
      </section>

      {/* Ciclo 5 — substitui a lista FIXA de 7 regras que vivia neste arquivo.
          Os valores 50/30/20/15/40/-20/-30 eram politica do NEXUS valendo para
          toda empresa, e o switch so mexia em estado do React. Agora a politica
          e da empresa, fica no banco e afeta o saldo de verdade. */}
      <PontuacaoConfigPainel onToast={onToast} />

      <section className={CARD}>
        <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Conquistas</h2>
        <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
          Catálogo do programa. A contagem vem dos registros de pontuação da empresa.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CATALOGO_BADGES.map((badge) => {
            const count = conquistas.get(badge.regraId) ?? 0;
            return (
              <div
                key={badge.regraId}
                className={`rounded-[14px] border p-4 text-center ${count > 0 ? 'border-[var(--nx-border)] bg-[var(--nx-surface-2)]' : 'border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-3)]'}`}
              >
                <span
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] text-[22px]"
                  style={{ backgroundColor: `color-mix(in srgb, ${badge.cor} 14%, var(--nx-surface))`, opacity: count > 0 ? 1 : 0.35 }}
                >
                  {badge.emoji}
                </span>
                <p className="mt-2 text-[12px] font-bold text-[var(--nx-ink)]">{badge.nome}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--nx-ink-3)]">{badge.criterio}</p>
                <span
                  className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold"
                  style={{ color: count > 0 ? badge.cor : 'var(--nx-ink-3)', backgroundColor: count > 0 ? `color-mix(in srgb, ${badge.cor} 12%, var(--nx-surface))` : 'var(--nx-surface-3)' }}
                >
                  {count} {count === 1 ? 'conquista' : 'conquistas'}
                </span>
              </div>
            );
          })}
        </div>
        {semRegistros && (
          <p className="mt-3 text-[12px] text-[var(--nx-ink-3)]">
            Nenhum registro em Gamificação: o placar aparece zerado até o RH lançar pontos.
          </p>
        )}
      </section>
    </div>
  );
}

type Periodo = '7d' | '30d' | '90d';

function RelatoriosTab({
  areasRisco,
  evolucao,
  correlacaoHoras,
  colaboradores,
  alertas,
  onExport,
  exportando,
  onToast,
}: {
  areasRisco: AreaRisco[];
  evolucao: PontoSerie[];
  correlacaoHoras: Array<{ horas: number; produtividade: number; equipe: string }>;
  colaboradores: Colaborador[];
  /**
   * Alertas REAIS do período, vindos de `GET /radar/resumo`. Entram na aba
   * para gerar as Sugestões Priorizadas a partir de fato, e não de texto
   * escrito no código.
   */
  alertas: Alerta[];
  onExport: (tipo: 'pdf' | 'csv', periodo: Periodo, setor: string) => void;
  /** 'pdf' | 'csv' enquanto o backend gera; null quando ocioso. */
  exportando: 'pdf' | 'csv' | null;
  onToast: ToastFn;
}) {
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [setor, setSetor] = useState('Todos');
  // Contagem de perfis registrada pelo RH — substitui os percentuais fixos
  // (22/31/28/19) que não correspondiam a ninguém.
  const discDados = discDistribuicao(colaboradores);
  // Setores que existem de fato nesta empresa, não a lista fixa de 6 nomes.
  const setoresReais = [...new Set(colaboradores.map((c) => c.setor))].sort();
  /**
   * Sugestões priorizadas DERIVADAS dos alertas reais do período.
   *
   * Cada item é um alerta que o backend detectou a partir dos indicadores: o
   * texto exibido é o `titulo` do próprio alerta, que já carrega o número que
   * o originou ("20 faltas no período", "4 produtos abaixo do mínimo"). Nada
   * aqui é redigido na tela.
   *
   * A ordenação é a mesma do backend (Alta → Média → Baixa) e a lista respeita
   * os filtros de período e setor que já existiam acima, de modo que o gestor
   * vê exatamente os alertas que discutiria com a equipe.
   *
   * Quando não há alerta, a lista fica vazia e a tela diz isso — nunca se
   * inventa recomendação para preencher espaço.
   */
  const sugestoesPriorizadas = useMemo(
    () =>
      alertas
        .slice()
        .sort(
          (a, b) =>
            ordemCriticidade(b.criticidade) - ordemCriticidade(a.criticidade) ||
            a.ref.localeCompare(b.ref),
        )
        .map((a) => ({
          ref: a.ref,
          prioridade: a.criticidade,
          texto: a.titulo,
          cor: a.cor,
        })),
    [alertas],
  );

  return (
    <div className="space-y-4">
      <section className={`${CARD} flex flex-wrap items-center gap-3`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['7d', '30d', '90d'] as Periodo[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPeriodo(item)}
              className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition ${
                periodo === item
                  ? 'border-[var(--nx-accent)] bg-[var(--nx-accent)] text-[var(--nx-ink)]'
                  : 'border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:border-[var(--nx-border-strong)]'
              }`}
            >
              {item === '7d' ? '7 dias' : item === '30d' ? '30 dias' : '90 dias'}
            </button>
          ))}
        </div>
        <select
          value={setor}
          onChange={(evento) => setSetor(evento.target.value)}
          className={`${FIELD} min-w-[170px]`}
          aria-label={traduzir('filtrar_relatorio_por_setor', "Filtrar relatório por setor")}
        >
          <option value="Todos">Setor: todos</option>
          {setoresReais.map((nome) => (
            <option key={nome} value={nome}>{nome}</option>
          ))}
        </select>
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={() => onExport('pdf', periodo, setor)}
          disabled={exportando !== null}
          className={`${BTN_PRIMARY} h-9 px-4 text-[12px]`}
        >
          {exportando === 'pdf' ? 'Gerando PDF…' : 'Export PDF'}
        </button>
        <button
          type="button"
          onClick={() => onExport('csv', periodo, setor)}
          disabled={exportando !== null}
          className={`${BTN_GHOST} h-9 px-4 text-[12px]`}
        >
          {exportando === 'csv' ? 'Gerando CSV…' : 'Export CSV'}
        </button>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Distribuição DISC</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Pessoas avaliadas por perfil comportamental (registro do RH)</p>
          <div className="mt-3 h-[280px]">
            {discDados.length === 0 ? (
              <SemDados altura="280px" mensagem="Nenhuma avaliação comportamental registrada pelo RH." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={discDados} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke={C.innerBorder} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="perfil" tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                  <YAxis allowDecimals={false} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                  <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} cursor={{ fill: 'rgba(var(--nx-ink-rgb) / 0.05)' }} />
                  <Bar dataKey="value" name="Pessoas" radius={[8, 8, 0, 0]}>
                    {discDados.map((item) => (
                      <Cell key={item.perfil} fill={item.cor} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Áreas com risco de burnout</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Probabilidade por área no período selecionado</p>
          <div className="mt-3 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={areasRisco} layout="vertical" margin={{ top: 8, right: 18, bottom: 4, left: 10 }}>
                <CartesianGrid stroke={C.innerBorder} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" unit="%" domain={[0, 100]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <YAxis type="category" dataKey="area" width={84} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.innerBorder} />
                <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} cursor={{ fill: 'rgba(var(--nx-ink-rgb) / 0.05)' }} />
                <Bar dataKey="risco" name="Risco" radius={[0, 8, 8, 0]}>
                  {areasRisco.map((item) => {
                    const cor = item.risco > 75 ? C.red : item.risco > 60 ? C.amber : C.green;
                    return <Cell key={item.area} fill={cor} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Evolução da saúde (90 dias)</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Saúde, produtividade e risco semana a semana</p>
          <div className="mt-3 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolucao} margin={{ top: 8, right: 16, bottom: 4, left: -18 }}>
                <CartesianGrid stroke={C.innerBorder} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="semana" tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <YAxis unit="%" domain={[0, 100]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} />
                <Legend formatter={(valor) => <span style={{ color: C.muted, fontSize: 12 }}>{valor}</span>} />
                <Line type="monotone" dataKey="saude" name="Saúde" stroke={C.green} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="produtividade" name="Produtividade" stroke={C.primary} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="risco" name="Risco" stroke={C.red} strokeWidth={2} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={CARD}>
          <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Correlação horas × produtividade</h2>
          <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Jornada semanal versus entrega por equipe</p>
          <div className="mt-3 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: -18 }}>
                <CartesianGrid stroke={C.innerBorder} strokeDasharray="3 3" />
                <XAxis type="number" dataKey="horas" name="Horas" unit="h" domain={[36, 60]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <YAxis type="number" dataKey="produtividade" name="Produtividade" unit="%" domain={[50, 100]} tick={{ fill: C.dim, fontSize: 12 }} stroke={C.innerBorder} />
                <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} />
                <Scatter name="Equipes" data={correlacaoHoras} fill={C.amber} fillOpacity={0.8} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Sugestões Priorizadas</h2>
            <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Ações recomendadas a partir dos indicadores do período</p>
          </div>
          <Target className="h-4 w-4 text-[var(--nx-accent)]" />
        </div>
        <div className="space-y-2">
          {sugestoesPriorizadas.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4 text-center text-[12px] text-[var(--nx-ink-3)]">
              Nenhuma situação exige ação no período selecionado: os indicadores não apontaram
              riscos nem gargalos acima do limite. Quando houver, a sugestão aparece aqui com o
              número que a originou.
            </p>
          ) : (
            sugestoesPriorizadas.map((item) => (
              <div key={item.ref} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="rounded-full border px-2.5 py-1 text-[12px] font-bold"
                    style={{ color: item.cor, backgroundColor: `color-mix(in srgb, ${item.cor} 12%, var(--nx-surface))`, borderColor: `color-mix(in srgb, ${item.cor} 32%, var(--nx-border))` }}
                  >
                    {item.prioridade}
                  </span>
                  <span className="text-[13px] text-[var(--nx-ink)]">{item.texto}</span>
                </div>
                <button
                  type="button"
                  onClick={() => avisoSemBackend(onToast, 'Ação não criada', item.texto)}
                  className={`${BTN_GHOST} h-8 px-3 text-[12px]`}
                >
                  Criar ação
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PerfilModal({
  pessoa,
  onClose,
  onPlano,
  onToast,
  onFeedback,
}: {
  pessoa: Colaborador;
  onClose: () => void;
  onPlano: (pessoa: Colaborador) => void;
  onToast: ToastFn;
  /** Ciclo 3: abre o registro de feedback de liderança. */
  onFeedback: (pessoa: Colaborador) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const perfil = classificarDISC(pessoa);
  const semDisc = pessoa.scores === null && pessoa.disc === null;
  // `riscoMatriz` cruza perfil × bem-estar; sem nenhum dos dois a matriz não
  // tem o que cruzar, então caímos no risco REAL derivado do ponto.
  const risco = semDisc
    ? { nivel: 'Baixo' as const, risco: `Risco derivado (${pessoa.risco}%)`, descricao: 'Derivado de absenteísmo, hora extra e registros disciplinares.' }
    : riscoMatriz(pessoa.scores!, numOu(pessoa.bemEstar), clamp(100 - numOu(pessoa.bemEstar), 0, 100));
  /**
   * Curva do modal. Substitui o `historico` sintético (12 pontos gerados com
   * `randInt` em torno de uma média inventada) por uma leitura direta do que a
   * pessoa TEM: dias com ponto contra os dias esperados. Sem registros no
   * período, a série fica vazia e o gráfico diz "aguardando ponto" — que é a
   * diferença entre "está saudável" e "não há medição".
   */
  const historicoPessoa = useMemo(() => {
    const s = pessoa.sinais;
    const esperados = Math.max(1, s.diasRegistrados + s.faltas);
    const presenca = esperados > 0 ? (s.diasRegistrados / esperados) * 100 : null;
    return presenca === null
      ? []
      : [
          { dia: 'Esperado', saude: 100 },
          { dia: 'Real', saude: Math.round(presenca) },
        ];
  }, [pessoa]);
  // Sem avaliação comportamental, os eixos vão `null` — e NÃO 0. Com 0 o
  // Recharts desenha um polígono achatado no centro, que se lê como "esta
  // pessoa pontua zero em D, I, S e C"; o que existe de verdade é "não há
  // medição". As legendas logo abaixo já mostravam "—" nesse caso: o gráfico
  // agora diz a mesma coisa que elas.
  const radarData = (['D', 'I', 'S', 'C'] as PerfilDISC[]).map((eixo) => ({
    eixo,
    valor: pessoa.scores ? pessoa.scores[eixo] : null,
  }));

  useModalAcessivel(dialogRef, onClose, closeRef);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil completo de ${pessoa.nome}`}
        className="radar-modal max-h-[90vh] w-full max-w-[760px] overflow-y-auto rounded-[24px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-7 shadow-2xl text-[var(--nx-ink)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-[var(--nx-accent)] text-[20px] font-bold text-[var(--nx-ink)] shadow-xs">
                {iniciais(pessoa.nome)}
              </span>
              <span
                className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-[var(--nx-surface)] ${
                  pessoa.online ? 'bg-[var(--nx-green)]' : 'bg-[var(--nx-ink-3)]'
                }`}
              />
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-[var(--nx-ink)]">{pessoa.nome}</h2>
              <p className="mt-0.5 text-[13px] text-[var(--nx-ink-2)]">{pessoa.cargo} • {pessoa.setor}</p>
              <span
                className="mt-2 inline-flex rounded-full border px-3 py-1 text-[12px] font-bold"
                style={{
                  color: perfil.perfil ? DISC_COLORS[perfil.perfil] : 'var(--nx-ink-3)',
                  backgroundColor: perfil.perfil ? `color-mix(in srgb, ${DISC_COLORS[perfil.perfil]} 14%, var(--nx-surface))` : 'rgba(var(--nx-ink-rgb) / 0.1)',
                  borderColor: perfil.perfil ? `color-mix(in srgb, ${DISC_COLORS[perfil.perfil]} 32%, var(--nx-border))` : 'var(--nx-border)',
                }}
              >
                {perfil.perfil ? `Perfil ${DISC_NOMES[perfil.perfil]} • ${perfil.perfil}` : 'Perfil não avaliado'}
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={traduzir('fechar_perfil', "Fechar perfil")}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] transition hover:text-[var(--nx-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke={C.innerBorder} />
                  <PolarAngleAxis dataKey="eixo" tick={{ fill: C.muted, fontSize: 12 }} />
                  <Radar
                    dataKey="valor"
                    stroke={perfil.perfil ? DISC_COLORS[perfil.perfil] : C.dim}
                    fill={perfil.perfil ? DISC_COLORS[perfil.perfil] : C.dim}
                    fillOpacity={0.35}
                  />
                  <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {(['D', 'I', 'S', 'C'] as PerfilDISC[]).map((eixo) => (
                <div key={eixo} className="rounded-[8px] bg-[var(--nx-surface-2)] p-2 text-center">
                  <p className="text-[12px] font-bold" style={{ color: DISC_COLORS[eixo] }}>{eixo}</p>
                  <p className="mt-0.5 text-[14px] font-bold text-[var(--nx-ink)]">{pessoa.scores ? pessoa.scores[eixo] : '—'}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--nx-ink-2)]">{pessoa.descricao}</p>
          </div>

          <div className="space-y-4">
            <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
              <div className="flex items-center justify-between text-[12px] text-[var(--nx-ink-2)]">
                <span>{pessoa.bemEstar === null ? 'Risco (derivado)' : 'Bem-estar'}</span>
                <span className="font-bold" style={{ color: pessoa.bemEstar === null ? (pessoa.risco > 70 ? C.red : pessoa.risco > 40 ? C.amber : C.green) : (pessoa.bemEstar > 75 ? C.green : pessoa.bemEstar >= 50 ? C.amber : C.red) }}>
                  {txt(pessoa.bemEstar === null ? pessoa.risco : pessoa.bemEstar, '%')}
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar
                  valor={pessoa.bemEstar === null ? pessoa.risco : numOu(pessoa.bemEstar)}
                  cor={pessoa.bemEstar === null ? (pessoa.risco > 70 ? C.red : pessoa.risco > 40 ? C.amber : C.green) : (pessoa.bemEstar > 75 ? C.green : pessoa.bemEstar >= 50 ? C.amber : C.red)}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: 'Horas no período', valor: txt(Math.round(pessoa.sinais.horasMin / 60)) },
                  { label: 'Faltas', valor: txt(pessoa.sinais.faltas) },
                  { label: 'H. extra', valor: txt(Math.round(pessoa.sinais.horasExtrasMin / 60)) },
                ].map((metrica) => (
                  <div key={metrica.label} className="rounded-[10px] bg-[var(--nx-surface-3)] p-2.5 text-center">
                    <p className="text-[11px] text-[var(--nx-ink-3)]">{metrica.label}</p>
                    <p className="mt-0.5 text-[13px] font-bold text-[var(--nx-ink)]">{metrica.valor}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
              <p className="text-[12px] font-bold uppercase tracking-[1px] text-[var(--nx-ink-3)]">Assiduidade no ciclo</p>
              <div className="mt-2 h-[80px]">
                {historicoPessoa.length === 0 ? (
                  <SemDados mensagem="Sem registros de ponto no período." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historicoPessoa} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                      <Line type="monotone" dataKey="saude" stroke={C.primary} strokeWidth={2} dot={false} />
                      <Tooltip contentStyle={{ background: 'var(--nx-surface)', border: `1px solid ${C.innerBorder}`, borderRadius: 10, fontSize: 12, color: 'var(--nx-ink)' }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
              <p className="text-[12px] font-bold uppercase tracking-[1px] text-[var(--nx-ink-3)]">Sinais do ciclo</p>
              <ul className="mt-2 space-y-2 text-[12px] text-[var(--nx-ink-2)]">
                <li className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]" />
                  {pessoa.pontuacao > 0
                    ? `${pessoa.pontuacao} ponto(s) em RegistroGamificacao.`
                    : 'Nenhum registro de pontuação ou reconhecimento no ciclo.'}
                </li>
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-amber)]" />
                  {pessoa.sinais.advertencias + pessoa.sinais.suspensoes} registro(s) disciplinar(es) no período.
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-green)]" />
                  {risco.risco} ({risco.nivel}) — {risco.descricao}
                </li>
              </ul>
            </div>

      {pessoa.planoDesenvolvimento ? (
        <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold uppercase tracking-[1px] text-[var(--nx-ink-3)]">Plano em andamento</p>
            <span className="rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-2 py-0.5 text-[12px] font-bold text-[var(--nx-ink-2)]">
              {pessoa.planoDesenvolvimento.status.replace('_', ' ').toLowerCase()}
            </span>
          </div>
          <p className="mt-2 text-[13px] font-bold capitalize text-[var(--nx-ink)]">
            {pessoa.planoDesenvolvimento.objetivo.toLowerCase().replace(/_/g, ' ')}
          </p>
          {pessoa.planoDesenvolvimento.prazo && (
            <p className="mt-0.5 text-[12px] text-[var(--nx-ink-3)]">Prazo {pessoa.planoDesenvolvimento.prazo}</p>
          )}
          {pessoa.planoDesenvolvimento.progresso.total > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-[var(--nx-ink-3)]">
                <span>Ações concluídas</span>
                <span className="font-bold text-[var(--nx-ink-2)]">
                  {pessoa.planoDesenvolvimento.progresso.concluidas}/{pessoa.planoDesenvolvimento.progresso.total}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--nx-surface-3)]">
                <div
                  className="h-full rounded-full bg-[var(--nx-accent)]"
                  style={{ width: `${pessoa.planoDesenvolvimento.progresso.percentual ?? 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-4">
          <p className="text-[12px] leading-relaxed text-[var(--nx-ink-2)]">
            {perfil.perfil
              ? 'Nenhum plano de desenvolvimento em aberto para esta pessoa.'
              : 'Sem avaliação DISC registrada, não há perfil sobre o qual montar um plano. Aplique o questionário na aba DISC de Relatórios.'}
          </p>
        </div>
      )}

            <button
              type="button"
              onClick={() => onFeedback(pessoa)}
              className={`${BTN_GHOST} w-full`}
            >
              <Star className="h-3.5 w-3.5" /> Enviar reconhecimento
            </button>
            <button
              type="button"
              onClick={() => onPlano(pessoa)}
              disabled={!perfil.perfil}
              title={perfil.perfil ? undefined : 'Avalie o perfil DISC primeiro.'}
              className={`${BTN_PRIMARY} mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Sparkles className="h-4 w-4" />
              {pessoa.planoDesenvolvimento ? 'Novo plano de desenvolvimento' : 'Criar Plano de Desenvolvimento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Id da avaliação DISC vigente de um colaborador.
 *
 * O plano de desenvolvimento se ancora numa avaliação real — é dela que sai o
 * snapshot do perfil. Devolve string vazia quando não há avaliação, e o modal
 * trata isso mostrando o motivo em vez de submeter um id inválido.
 */
function avaliacaoVigenteDe(pessoa: Colaborador): string {
  return pessoa.discAvaliacaoId ?? '';
}

function PlanoModal({
  alerta,
  onClose,
  onSalvar,
}: {
  alerta: Alerta;
  onClose: () => void;
  onSalvar: (plano: PlanoDeAcao, modo: 'criar' | 'atualizar') => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── CRIAR x ATUALIZAR ──────────────────────────────────────────────────────
  //
  // O backend tem DUAS rotas e a tela usava só uma: `POST /radar/acoes`
  // (cria) e `PATCH /radar/acoes/:id` (atualiza status e ações). Como o modal
  // sempre fazia POST, abrir "Ver Plano de Ação" num alerta que JÁ tinha plano
  // gravava um SEGUNDO plano para o mesmo alerta, e o `PATCH` nunca era
  // chamado — o plano ficavaABERTO para sempre, sem como concluir, cancelar
  // ou marcar uma ação como feita.
  //
  // Agora o modal abre no modo certo: quando `alerta.plano` existe e não foi
  // cancelado, ele EDITA aquele plano (PATCH); quando não existe, CRIA (POST).
  const planoExistente = alerta.plano && alerta.plano.status !== 'CANCELADA' ? alerta.plano : null;
  const modo: 'criar' | 'atualizar' = planoExistente ? 'atualizar' : 'criar';

  // As ações do plano saem das CAUSAS que o backend detectou (que já são
  // números reais) mais a sugestão do alerta — não de uma lista fixa.
  // Em modo de edição elas vêm do plano GRAVADO, para que o gestor edite o que
  // realmente está no banco em vez de recriar a lista do zero.
  const [acoes] = useState<string[]>(() => {
    if (planoExistente) {
      const textos = planoExistente.acoes.map((a) => a.texto).filter((t) => t.trim().length > 0);
      if (textos.length > 0) return textos;
    }
    return [
      ...alerta.causas.map((causa) => `Tratar: ${causa}`),
      alerta.sugestao,
    ].filter((t) => t.trim().length > 0);
  });

  // Nenhuma ação começa concluída na CRIAÇÃO. O valor anterior era `[0, 1]`
  // fixo, o que marcava as duas primeiras ações como feitas ANTES de o gestor
  // decidir qualquer coisa — e as gravava assim no banco, produzindo um plano
  // que já nascia com trabalho não feito dado por concluído. Na EDIÇÃO parte do
  // que já está gravado, que é a informação real.
  const [concluidas, setConcluidas] = useState<number[]>(() =>
    planoExistente
      ? planoExistente.acoes
          .map((a, indice) => (a.concluida ? indice : -1))
          .filter((i) => i >= 0)
      : [],
  );
  // Prazo padrão: HOJE + 30 dias, calculado na abertura do modal.
  //
  // Antes era a constante `'2026-10-30'` escrita no arquivo. Data fixa não é
  // neutra: ela envelhece. Depois de 30 de outubro o formulário passou a abrir
  // com um prazo já vencido, e o gestor podia salvar um plano de ação
  // retrodatado sem perceber.
  const [prazo, setPrazo] = useState(
    planoExistente?.prazo ?? (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const dia = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mes}-${dia}`;
    })(),
  );
  const [status, setStatus] = useState(planoExistente?.status ?? 'EM_ANDAMENTO');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useModalAcessivel(dialogRef, onClose);

  function alternar(indice: number) {
    setConcluidas((atual) => (atual.includes(indice) ? atual.filter((item) => item !== indice) : [...atual, indice]));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(
        {
          alerta,
          acoes: acoes.map((texto, indice) => ({ texto, concluida: concluidas.includes(indice) })),
          prazo: prazo || null,
          responsavel: null,
          status,
        },
        modo,
      );
    } catch (e: unknown) {
      // O erro FICA no modal: fechar o diálogo depois de a gravação falhar
      // fazia o gestor perder as marcações sem qualquer aviso.
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o plano de ação.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Plano de ação: ${alerta.titulo}`}
        tabIndex={-1}
        className="radar-modal max-h-[90vh] w-full max-w-[580px] overflow-y-auto rounded-[20px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6 shadow-2xl text-[var(--nx-ink)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: `${alerta.cor}22`, color: alerta.cor }}>
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Plano de Ação</h2>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-2)]">{alerta.titulo}</p>
              <p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">
                {alerta.criticidade} • {alerta.area} • {alerta.fato}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={traduzir('fechar_plano', "Fechar plano")} className="text-[var(--nx-ink-3)] transition hover:text-[var(--nx-ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">Causas detectadas</p>
          <ul className="mt-1.5 space-y-1 text-[12px] text-[var(--nx-ink-2)]">
            {alerta.causas.map((causa) => (
              <li key={causa} className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: alerta.cor }} />
                {causa}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-3 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">Ações do plano</p>
            <span className="text-[12px] font-bold text-[var(--nx-ink-2)]">{concluidas.length}/{acoes.length}</span>
          </div>
          <div className="mt-2 space-y-2">
            {acoes.map((acao, indice) => {
              const concluida = concluidas.includes(indice);
              return (
                <label
                  key={`${acao}-${indice}`}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-2.5 text-[12px] transition ${
                    concluida ? 'border-[var(--nx-accent)]/40 bg-[color-mix(in_srgb,var(--nx-accent)_12%,transparent)] text-[var(--nx-ink)]' : 'border-[var(--nx-border)] text-[var(--nx-ink-2)] hover:border-[var(--nx-border-strong)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={concluida}
                    onChange={() => alternar(indice)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--nx-accent)]"
                  />
                  <span className={concluida ? 'line-through opacity-70' : ''}>{acao}</span>
                </label>
              );
            })}
          </div>
        </div>

        {modo === 'atualizar' && (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">
              {traduzir('status_do_plano', 'Status do plano')}
            </span>
            <select
              value={status}
              onChange={(evento) =>
                setStatus(evento.target.value as 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA')
              }
              className="h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]"
            >
              <option value="ABERTA">Aberta</option>
              <option value="EM_ANDAMENTO">Em andamento</option>
              <option value="CONCLUIDA">Concluída</option>
              <option value="CANCELADA">Cancelada</option>
            </select>
          </label>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">{traduzir('responsavel', "Responsável")}</span>
            <p className="flex h-10 items-center rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 text-[12px] text-[var(--nx-ink-3)]">
              {modo === 'atualizar' && planoExistente?.responsavelId
                ? 'Responsável definido no momento da criação'
                : 'Definido automaticamente pelo usuário que criou o plano'}
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-ink-3)]">{traduzir('prazo', "Prazo")}</span>
            <input
              type="date"
              value={prazo}
              onChange={(evento) => setPrazo(evento.target.value)}
              className="h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-3)] px-3 text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]"
            />
          </label>
        </div>

        {erro && (
          <p role="alert" className="mt-3 rounded-[10px] border border-[color-mix(in_srgb,var(--nx-red)_30%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-red)_10%,var(--nx-surface))] px-3 py-2 text-[12px] text-[var(--nx-red)]">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onClose} className={`${BTN_GHOST} flex-1`}>{traduzir('cancelar', "Cancelar")}</button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || acoes.length === 0}
            className={`${BTN_PRIMARY} flex-1 disabled:cursor-wait disabled:opacity-60`}
          >
            <CheckCircle2 className="h-4 w-4" />{' '}
            {salvando
              ? 'Salvando…'
              : modo === 'atualizar'
                ? 'Salvar plano de ação'
                : 'Criar Plano de Ação'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComoFuncionaModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAcessivel(dialogRef, onClose);
  const exemplo = pontosGamificacao(6, 3, 5, 4, 1, 1, 1);
  const itens = [
    { e: '🏆', t: 'Entrega no prazo', d: '+50 pts por entrega consistente' },
    { e: '💚', t: 'Zero hora extra', d: '+30 pts por semana equilibrada' },
    { e: '🤝', t: 'Colaboração', d: '+20 feedback • +15 ajuda' },
    { e: '🎓', t: 'Desenvolvimento', d: '+40 pts por curso concluído' },
  ];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={traduzir('como_funciona', "Como funciona")} tabIndex={-1} className="radar-modal max-h-[90vh] w-full max-w-[580px] overflow-y-auto rounded-[20px] border border-[var(--nx-border)] bg-[var(--nx-surface)] p-6 shadow-2xl text-[var(--nx-ink)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--nx-accent-2)]/15 text-[var(--nx-accent-ink)]"><Trophy className="h-5 w-5" /></span>
            <div><h2 className="text-[15px] font-bold text-[var(--nx-ink)]">Como funciona a Gamificação Saudável</h2><p className="mt-1 text-[12px] text-[var(--nx-ink-3)]">Premia equilíbrio, colaboração e consistência.</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label={traduzir('fechar', "Fechar")} className="text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-2">{itens.map((r) => (<div key={r.t} className="flex items-center gap-3 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3"><span className="text-[18px]">{r.e}</span><div><p className="text-[13px] font-bold text-[var(--nx-ink)]">{r.t}</p><p className="text-[12px] text-[var(--nx-ink-2)]">{r.d}</p></div></div>))}</div>
        <div className="mt-3 rounded-[10px] border border-[var(--nx-accent)]/30 bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] p-3"><p className="text-[12px] font-bold uppercase tracking-[0.8px] text-[var(--nx-accent-ink)]">Fórmula</p><p className="mt-1 text-[12px] text-[var(--nx-ink)] leading-relaxed">pontos = entregas×50 + zeroExtra×30 + feedback×20 + ajuda×15 + curso×40 − atraso×30 − extras×20. Ex: {exemplo} pts.</p></div>
        <button type="button" onClick={onClose} className={`${BTN_PRIMARY} mt-4 w-full`}>Entendi, voltar</button>
      </div>
    </div>
  );
}

/**
 * Wrapper: só monta o `RadarProvider`.
 *
 * Não passa mais seed. A tela nasceu como protótipo com 12 colaboradores e 8
 * alertas inventados no próprio arquivo; isso foi removido — agora tudo vem de
 * `GET /radar/resumo`, e sem dado a tela assume "Dados insuficientes para
 * análise" em vez de preencher com número plausível.
 *
 * O provider não emite elemento nenhum: o DOM renderizado é idêntico ao
 * aprovado.
 */
export default function RadarOrganizacionalPage() {
  return (
    <RadarProvider>
      <RadarConteudo />
    </RadarProvider>
  );
}

function RadarConteudo() {
  const { dados, carregando, erro, semDados, recarregar, versao: tentativaResumo } = useRadar();

  // Os KPIs vêm do servidor e não são mexidos no navegador. A caminhada
  // aleatória de 5 em 5 segundos que existia aqui foi REMOVIDA: ela alterava
  // números sem origem, dentro de um módulo cuja proposta é mostrar dado real.
  const kpis = dados.kpis;
  const heatmap = dados.heatmap;
  const listaColaboradores = dados.colaboradores;
  const listaAlertas = dados.alertas;
  const listaAreasRisco = dados.areasRisco;
  const listaEquipes = dados.equipes;
  const heatmapSetores = dados.heatmapSetores;
  const heatmapSemanas = dados.heatmapSemanas;

  /**
   * Base dos deltas: o que o servidor entregou na PRIMEIRA carga desta sessão.
   *
   * Antes o delta comparava com `KPIS_INICIAIS` (147 extras, 87% produtividade)
   * — números escritos no arquivo. O delta era, portanto, a diferença entre o
   * dado real e um número inventado, e a tela mostrava "variação" onde nada
   * tinha variado. Agora a base é o próprio dado, e um `useRef` garante que ela
   * não se mova junto com as recargas — do contrário o delta seria sempre zero.
   */
  const kpisBaseRef = useRef<Kpis | null>(null);
  if (kpisBaseRef.current === null && !carregando) kpisBaseRef.current = dados.kpis;
  const kpisBase = kpisBaseRef.current ?? dados.kpis;

  const [aba, setAba] = useState<TabKey>('visao');
  const [indice, setIndice] = useState(0);
  const [iaPendente, setIAPend] = useState(false);
  const [simPendente, setSimPendente] = useState(false);
  const [iaResposta, setIaResposta] = useState<string | null>(null);
  const [exportando, setExportando] = useState<'pdf' | 'csv' | null>(null);
  const [busca, setBusca] = useState('');
  const [fAlertas, setFAlertas] = useState<FiltrosAlertas>({ criticidade: 'Todas', tipo: 'Todos', status: 'Todos', busca: '' });
  const [fDisc, setFDisc] = useState<{ setor: string; disc: PerfilDISC | 'Todos'; busca: string }>({ setor: 'Todos', disc: 'Todos', busca: '' });
  // Começa em neutralidade: a página não deve abrir anunciando ganho que
  // ninguém configurou. Os deltas só saem de zero quando o usuário mexe nos sliders.
  const [sim, setSim] = useState<SimuladorState>({ prodAdd: 0, vendasAdd: 0, horasDelta: 0 });
  const [colabSel, setColabSel] = useState<Colaborador | null>(null);
  /**
   * Pessoa para quem o Plano de Desenvolvimento está sendo montado. Fica
   * separado de `colabSel` porque são duas telas empilhadas: abrir o plano não
   * fecha o perfil, para o gestor poder voltar e conferir o que leu.
   */
  const [planoDesenvolvimentoPessoa, setPlanoDesenvolvimentoPessoa] = useState<Colaborador | null>(null);
  /**
   * Ciclo 2: modal de treinamento. Guarda o contexto (de qual alerta veio) e a
   * sugestão da IA, se o gestor veio pelo card "Sugestões de Treinamento".
   */
  const [treinamentoAberto, setTreinamentoAberto] = useState<{ contexto: string; sugestao: Record<string, any> | null } | null>(null);
  /**
   * Ciclo 3: feedback de liderança para a pessoa aberta no PerfilModal.
   */
  const [feedbackAberto, setFeedbackAberto] = useState<Colaborador | null>(null);
  const abrirTreinamento = useCallback((contexto: string, sugestao: Record<string, any> | null = null) => {
    setTreinamentoAberto({ contexto, sugestao });
  }, []);
  const [planoAlerta, setPlanoAlerta] = useState<Alerta | null>(null);
  const [comoAberto, setComoAberto] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [registrosGamificacao, setRegistrosGamificacao] = useState<PlacarGamificacao>({ registros: [], totalPontos: 0, porSetor: [] });
  const toastId = useRef(0);

  // Placar de gamificação: rota própria, porque os registros alimentam as
  // conquistas por regra e não cabem no resumo. Busca uma vez e de novo
  // quando o resumo recarrega, para os dois ficarem coerentes.
  useEffect(() => {
    let vivo = true;
    lerGamificacao()
      .then((p) => { if (vivo) setRegistrosGamificacao(p); })
      // Falha aqui não é fatal: a aba de gamificação mostra "aguardando
      // registros" e o restante do Radar continua funcionando.
      .catch(() => { if (vivo) setRegistrosGamificacao({ registros: [], totalPontos: 0, porSetor: [] }); });
    return () => { vivo = false; };
  }, [tentativaResumo]);

  const removerToast = useCallback((id: number) => {
    setToasts((atual) => atual.filter((t) => t.id !== id));
  }, []);
  const notificar: ToastFn = useCallback((titulo, mensagem, tipo = 'ok') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((atual) => [...atual.slice(-3), { id, titulo, mensagem, tipo }]);
    window.setTimeout(() => removerToast(id), 3200);
  }, [removerToast]);

  useEffect(() => {
    const corAnterior = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'var(--nx-canvas)';
    return () => { document.body.style.backgroundColor = corAnterior; };
  }, []);

  // Ciclo 5: as regras de pontuação saíram daqui. A política da empresa é
  // configurada no painel e vive no banco — não em `localStorage` do navegador,
  // que só guardava uma preferência de tela e valia igual para todo mundo.
  async function exportarRel(tipo: 'pdf' | 'csv', per: string, setor: string) {
    setExportando(tipo);
    try {
      const { nome } = await exportarRelatorio(tipo, {
        periodoInicio: per || undefined,
        periodoFim: per || undefined,
        setor: setor === 'Todos' ? undefined : setor,
      });
      notificar(`Relatório ${tipo.toUpperCase()} gerado`, `${nome} • dados de ${dados.periodo ? `${dados.periodo.inicio} a ${dados.periodo.fim}` : 'período padrão'}`);
    } catch (e) {
      notificar('Exportação falhou', (e as Error)?.message ?? 'O backend não conseguiu gerar o relatório.', 'warn');
    } finally {
      setExportando(null);
    }
  }

  // A caminhada aleatória dos KPIs foi removida: ela mudava número a cada 5s
  // sem nenhuma origem. O que muda o KPI agora é o gestor, recarregando a tela
  // depois de um lançamento novo no módulo de origem.

  const alertasFiltrados = useMemo(() => listaAlertas.filter((a) =>
    (fAlertas.criticidade === 'Todas' || a.criticidade === fAlertas.criticidade) &&
    (fAlertas.tipo === 'Todos' || a.tipo === fAlertas.tipo) &&
    (fAlertas.status === 'Todos' || a.status === fAlertas.status) &&
    (fAlertas.busca.trim() === '' || `${a.titulo} ${a.area}`.toLowerCase().includes(fAlertas.busca.trim().toLowerCase()))
  ), [fAlertas, listaAlertas]);

  const colabFiltrados = useMemo(() => {
    const qTopo = busca.trim().toLowerCase();
    const q = fDisc.busca.trim().toLowerCase();
    return listaColaboradores.filter((p) => {
      if (fDisc.setor !== 'Todos' && p.setor !== fDisc.setor) return false;
      if (fDisc.disc !== 'Todos' && classificarDISC(p).perfil !== fDisc.disc) return false;
      const hay = `${p.nome} ${p.cargo ?? ''} ${p.setor}`.toLowerCase();
      if (qTopo !== '' && !hay.includes(qTopo)) return false;
      if (q !== '' && !hay.includes(q)) return false;
      return true;
    });
  }, [fDisc, busca, listaColaboradores]);
  function irAba(key: TabKey, i: number) { setAba(key); setIndice(i); }
  function aoTeclarTabs(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const prox = (indice + dir + TABS.length) % TABS.length;
    const t = TABS[prox];
    setAba(t.key); setIndice(prox);
    window.setTimeout(() => { document.getElementById(`tab-${t.key}`)?.focus(); }, 0);
  }
  async function analisarIA() {
    // Rota real: POST /radar/ia. O backend monta o contexto a partir dos dados
    // desta empresa e só então chama o Gemini. Se não houver base, ele mesmo
    // responde que não há dado suficiente — não preenchemos com texto solto.
    setIAPend(true);
    try {
      const r = await perguntarRadar(
        'Qual é a maior risco organizacional desta empresa agora, com base nos dados registrados no período? Cite os números que sustentam a leitura.',
        dados.periodo ?? undefined,
      );
      if (r.semBase) {
        notificar('Sem base para análise', r.resposta, 'warn');
      } else {
        setIaResposta(r.resposta);
        irAba('preditivo', 1);
      }
    } catch (e) {
      notificar('IA indisponível', (e as Error)?.message ?? 'Falha ao consultar a IA do Radar.', 'warn');
    } finally {
      setIAPend(false);
    }
  }

  async function aplicarSim(p: PreviewSimulacao) {
    // O preview da tela parte do nível REAL que o servidor entregou em
    // `/radar/resumo`, mas os COEFICIENTES dos deltas são uma estimativa local.
    // Então reenviamos os parâmetros para o servidor refazer o cálculo: quando
    // os dois divergirem, quem vale é o servidor — e é o resultado dele que a
    // tela mostra.
    setSimPendente(true);
    try {
      const r = await rodarSimulacao({
        prodAdd: sim.prodAdd,
        vendasAdd: sim.vendasAdd,
        horasDelta: sim.horasDelta,
        periodoInicio: dados.periodo?.inicio,
        periodoFim: dados.periodo?.fim,
      });
      if (!r.suficiente) {
        notificar('Simulação não calculada', r.motivo ?? SEM_DADOS, 'warn');
        return;
      }
      const c = r.cenario!;
      notificar(
        'Simulação calculada no servidor',
        `Saúde ${c.saude}% • gargalo ${c.gargalo}% • burnout ${c.burnout}%` +
        (r.pressupostos.length ? ` • ${r.pressupostos.length} pressuposto(s).` : ''),
      );
    } catch (e) {
      notificar('Simulação indisponível', (e as Error)?.message ?? 'Falha ao simular.', 'warn');
    } finally {
      setSimPendente(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-[var(--nx-canvas)] p-[28px_32px] text-[var(--nx-ink)]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-[260px] max-w-[560px] flex-1">
          <p className="text-[12px] font-bold uppercase tracking-[1.6px] text-[var(--nx-ink-3)]">Organizacional • Radar • V2</p>
          <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-[var(--nx-ink)]">Radar Organizacional • Saúde &amp; Comportamento</h1>
          <div className="mt-2 h-[3px] w-20 rounded-full bg-gradient-to-r from-[var(--nx-accent)] to-[var(--nx-accent-2)]" />
          <p
            className="mt-3 text-[13px] text-[var(--nx-ink-2)]"
            title={dados.faltando.length > 0 ? dados.faltando.map((f) => `${f.campo}: ${f.motivo}`).join(' • ') : undefined}
          >
            Análise preditiva de burnout, gargalos, clima e perfis DISC •{' '}
            {carregando
              ? 'carregando dados da empresa…'
              : semDados
                ? SEM_DADOS
                : erro
                  ? 'falha ao consultar o banco'
                  : `${listaColaboradores.length} colaborador(es) • ${dados.base.registrosPonto} registro(s) de ponto • ${dados.periodo ? `${dados.periodo.inicio} a ${dados.periodo.fim}` : 'período padrão'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-[20px] border border-[color-mix(in_srgb,var(--nx-green)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-green)_10%,var(--nx-surface))] px-3 py-1.5 text-[12px] font-bold text-[var(--nx-green)]"><Heart className="h-3.5 w-3.5" /> Saúde {txt(dados.saudeMedia, '%')}</span>
          <span className="inline-flex items-center gap-2 rounded-[20px] border border-[color-mix(in_srgb,var(--nx-amber)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-amber)_10%,var(--nx-surface))] px-3 py-1.5 text-[12px] font-bold text-[var(--nx-amber)]"><AlertTriangle className="h-3.5 w-3.5" /> Risco médio • {listaAreasRisco.length} áreas</span>
          <span className="inline-flex items-center gap-2 rounded-[20px] border border-[var(--nx-border)] bg-[var(--nx-accent-2)]/10 px-3 py-1.5 text-[12px] font-bold text-[var(--nx-accent)]"><Trophy className="h-3.5 w-3.5" /> Badges {txt(dados.totalBadges)}</span>
          <span
            className={`inline-flex items-center gap-2 rounded-[20px] border px-3 py-1.5 text-[12px] font-bold ${
              erro
                ? 'border-[var(--nx-border)] bg-[var(--nx-accent-2)]/20 text-[var(--nx-red)]'
                : carregando
                  ? 'border-[var(--nx-border)] bg-[var(--nx-accent-2)]/20 text-[var(--nx-amber)]'
                  : 'border-[var(--nx-border)] bg-[var(--nx-accent-2)]/20 text-[var(--nx-green)]'
            }`}
            title={erro ?? dados.faltando.length > 0 ? dados.faltando.map((f) => `${f.campo}: ${f.motivo}`).join(' • ') : undefined}
          >
            <Fingerprint className="h-3.5 w-3.5" />
            {carregando ? 'Carregando…' : erro ? 'Falha na fonte' : 'Fonte: banco'}
            {!carregando && !erro && (
              <button type="button" onClick={recarregar} className="ml-1 underline decoration-dotted underline-offset-2 hover:opacity-80" title="Recarregar do banco">
                ↻
              </button>
            )}
          </span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-ink-3)]" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={traduzir('buscar_colaborador_area_ou_alerta', "Buscar colaborador, área ou alerta...")} aria-label={traduzir('buscar_no_radar', "Buscar no radar")} className="h-11 w-[340px] max-w-full rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] pl-9 pr-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:border-[var(--nx-accent)] focus:outline-none" />
          </div>
          <button type="button" onClick={analisarIA} className={`${BTN_PRIMARY} h-11`}><Brain className="h-4 w-4" /> IA Analisar</button>
        </div>
      </header>

      <div aria-label={traduzir('secoes_do_radar', "Seções do Radar")} role="tablist" aria-orientation="horizontal" onKeyDown={aoTeclarTabs} className="mb-6 mt-6 flex w-fit max-w-full flex-wrap gap-1.5 overflow-x-auto rounded-[14px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-1.5">
        {TABS.map((t, i) => {
          const ativo = aba === t.key;
          const Icone = t.icon;
          return (
            <button key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={ativo} aria-controls={`radar-panel-${t.key}`} tabIndex={ativo ? 0 : -1} onClick={() => irAba(t.key, i)} className={`inline-flex items-center gap-2 rounded-[10px] px-[18px] py-[9px] text-[12px] font-bold transition ${ativo ? 'bg-[var(--nx-accent)] text-[var(--nx-ink)] shadow-sm' : 'text-[var(--nx-ink-2)] hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]'}`}>
              <Icone className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      <main>
        {aba === 'visao' && (
          <div id="radar-panel-visao" role="tabpanel" aria-labelledby="tab-visao">
            <VisaoGeralTab kpis={kpis} kpisBase={kpisBase} heatmap={heatmap} heatmapSetores={heatmapSetores} heatmapSemanas={heatmapSemanas} alertas={listaAlertas.slice(0, 3)} colaboradores={listaColaboradores} areasRisco={listaAreasRisco} onPlano={(a) => setPlanoAlerta(a)} onTreinamento={(ctx) => abrirTreinamento(ctx)} onToast={notificar} onIrPreditivo={() => irAba('preditivo', 1)} />
          </div>
        )}
        {aba === 'preditivo' && (
          <div id="radar-panel-preditivo" role="tabpanel" aria-labelledby="tab-preditivo">
            <PreditivoTab alertas={alertasFiltrados} filtros={fAlertas} onFiltros={(p) => setFAlertas((f) => ({ ...f, ...p }))} onPlano={(a) => setPlanoAlerta(a)} simulador={sim} onSimulador={(p) => setSim((s) => ({ ...s, ...p }))} onAplicar={aplicarSim} nivelSimulacao={dados.nivelSimulacao} />
          </div>
        )}
        {aba === 'disc' && (
          <div id="radar-panel-disc" role="tabpanel" aria-labelledby="tab-disc">
            <DiscTab colaboradores={colabFiltrados} filtros={fDisc} onFiltros={(p) => setFDisc((f) => ({ ...f, ...p }))} onSelect={(p) => setColabSel(p)} />
          </div>
        )}
        {aba === 'bem' && (
          <div id="radar-panel-bem" role="tabpanel" aria-labelledby="tab-bem">
            <BemEstarTab kpis={kpis} kpisBase={kpisBase} colaboradores={listaColaboradores} onToast={notificar} onTreinamento={abrirTreinamento} />
          </div>
        )}
        {aba === 'gam' && (
          <div id="radar-panel-gam" role="tabpanel" aria-labelledby="tab-gam">
            {/* Ciclo 5 — os critérios da empresa vêm do banco, com a política que ELA
          configurou. A lista fixa de regras e o toggle em localStorage saíram:
          nenhuma das duas gravava nada, e a mesma política valia para todas as
          empresas do NEXUS. */}
      <GamificacaoTab equipes={listaEquipes} registros={registrosGamificacao.registros} onToast={notificar} onComoFunciona={() => setComoAberto(true)} />
          </div>
        )}
        {aba === 'rel' && (
          <div id="radar-panel-rel" role="tabpanel" aria-labelledby="tab-rel">
            <RelatoriosTab areasRisco={listaAreasRisco} evolucao={dados.evolucao} correlacaoHoras={dados.correlacaoHoras} colaboradores={listaColaboradores} alertas={alertasFiltrados} exportando={exportando} onExport={exportarRel}
              onToast={notificar}
            />
          </div>
        )}
      </main>

      {colabSel && (
        <PerfilModal
          pessoa={colabSel}
          onClose={() => setColabSel(null)}
          onPlano={(pessoa) => {
            // O plano de desenvolvimento abre com o perfil em foco; o
            // PerfilModal fica montado atrás para o gestor voltar sem
            // perder o contexto de quem ele está avaliando.
            setPlanoDesenvolvimentoPessoa(pessoa);
          }}
          onToast={notificar}
          onFeedback={(pessoa) => setFeedbackAberto(pessoa)}
        />
      )}
      {feedbackAberto && (
        <FeedbackLiderancaModal
          funcionarioId={feedbackAberto.id}
          funcionarioNome={feedbackAberto.nome}
          cargo={feedbackAberto.cargo}
          lideranca={cargoIndicaLideranca(feedbackAberto.cargo)}
          aoFechar={() => setFeedbackAberto(null)}
          aoSalvar={() => {
            setFeedbackAberto(null);
            notificar('Feedback registrado', `Conversa com ${feedbackAberto.nome} gravada.`);
          }}
        />
      )}
      {planoDesenvolvimentoPessoa && (
        <PlanoDesenvolvimentoModal
          funcionarioId={planoDesenvolvimentoPessoa.id}
          funcionarioNome={planoDesenvolvimentoPessoa.nome}
          avaliacaoId={avaliacaoVigenteDe(planoDesenvolvimentoPessoa)}
          perfil={classificarDISC(planoDesenvolvimentoPessoa).perfil}
          scores={planoDesenvolvimentoPessoa.scores}
          aoFechar={() => setPlanoDesenvolvimentoPessoa(null)}
          aoSalvar={({ id }) => {
            setPlanoDesenvolvimentoPessoa(null);
            notificar('Plano de desenvolvimento criado', `Registrado a partir da avaliação DISC de ${planoDesenvolvimentoPessoa.nome}.`);
            recarregar();
            void id;
          }}
        />
      )}
      {treinamentoAberto && (
        <TreinamentoModal
          sugestao={treinamentoAberto.sugestao}
          aoFechar={() => setTreinamentoAberto(null)}
          aoSalvar={(t) => {
            setTreinamentoAberto(null);
            notificar('Treinamento criado', `"${t.titulo}" registrado. Preencha a lista de presença depois.`);
            recarregar();
          }}
        />
      )}
      {planoAlerta && (
        <PlanoModal
          alerta={planoAlerta}
          onClose={() => setPlanoAlerta(null)}
          onSalvar={async (plano, modo) => {
            const { alerta, acoes, prazo } = plano;
            // As DUAS rotas reais do backend, escolhidas pelo estado do alerta:
            //   POST  /radar/acoes      -> cria (alerta ainda sem plano)
            //   PATCH /radar/acoes/:id  -> atualiza status e ações do plano existente
            // O erro NÃO é engolido aqui: o modal precisa mostrá-lo para o gestor
            // não perder o que marcou achando que gravou.
            if (modo === 'atualizar' && alerta.plano) {
              // `prazo` vai junto: o campo é editável nesta tela, e antes o
              // PATCH aceitava só `status`/`acoes` — a data digitada era
              // descartada em silêncio e a rota devolvia 200 normalmente.
              await atualizarPlanoDeAcao(alerta.plano.id, {
                status: plano.status,
                acoes,
                prazo: prazo || null,
              });
              setPlanoAlerta(null);
              notificar(
                'Plano de ação atualizado',
                `${acoes.filter((a) => a.concluida).length}/${acoes.length} ação(ões) concluídas • ${alerta.area}`,
              );
              recarregar();
              return;
            }
            await criarPlanoDeAcao({
              alertaRef: alerta.ref,
              alertaTitulo: alerta.titulo,
              funcionarioId: alerta.funcionarioId,
              acoes,
              prazo,
            });
            setPlanoAlerta(null);
            notificar('Plano de ação salvo', `${acoes.length} ação(ões) • ${alerta.area} • ${alerta.ref}`);
            recarregar();
          }}
        />
      )}
      {comoAberto && <ComoFuncionaModal onClose={() => setComoAberto(false)} />}

      <ToastStack toasts={toasts} onDismiss={removerToast} />

      <style jsx global>{`
        /* O bloco :root que existia aqui (--nx-canvas: var(--nx-canvas) etc.) foi
           removido: auto-referência é inválido em CSS e nenhuma das variáveis
           era consumida em lugar nenhum do módulo. */
        .radar-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: var(--nx-border);
          outline: none;
        }
        .radar-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--nx-accent);
          border: 2px solid var(--nx-surface);
          cursor: pointer;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--nx-accent) 40%, transparent);
        }
        .radar-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--nx-accent);
          border: 2px solid var(--nx-surface);
          cursor: pointer;
        }
        .radar-modal { animation: radarIn 0.22s ease-out; }
        @keyframes radarIn {
          from { opacity: 0; transform: translateY(10px) scale(0.99); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .radar-toast { animation: radarSlideIn 0.3s ease-out; }
        @keyframes radarSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .radar-toast-progress { animation: radarToastBar 2.8s linear forwards; }
        @keyframes radarToastBar {
          from { width: 100%; }
          to { width: 0%; }
        }
        .radar-heat { transition: transform 0.15s ease; }
        .radar-bar { transition: width 0.35s ease, background-color 0.35s ease; }
      `}</style>
    </div>
  );
}


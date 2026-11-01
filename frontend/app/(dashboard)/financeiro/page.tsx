'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Check, Clock, Download, Eye, Plus, Search,
  Sparkles, TrendingDown, TrendingUp, Wallet, X,
  BarChart3, Target, Calendar, Building2, FileText,
  Copy, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import {
  LineChart as RLineChart, Line, AreaChart, Area, PieChart as RPieChart, Pie, Cell,
  BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import {
  BarChart, EmptyState, SectionTitle, TabsPill,
} from '@/components/ui';
import { formatBRL, formatDate } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';
import {
  comFuso, diaLocal, intervaloDoPreset, periodoAnterior, type PresetKey,
} from '@/lib/dashboard';

/* REGRA DE OURO: melhoria V2 aplicada EM CIMA do page.tsx existente.
   Shell (sidebar/topbar) vem do (dashboard)/layout.tsx â€” nÃ£o duplicado aqui.
   100% dados reais: GET /financeiro, GET /fluxo-caixa, GET /dre, POST /financeiro.
   Sem mocks: sem R$84k, sem Inter/Stone, sem deltas inventados. */

type Lanc = {
  id: string; tipo: 'RECEITA' | 'DESPESA'; categoria: string; descricao: string;
  valor: number | string; vencimento?: string | null; status: string;
  centroCusto?: string | null; createdAt: string;
  /** Campos reais do model Prisma Financeiro usados no detalhe/exportaÃ§Ã£o. */
  origem?: string | null; filialId?: string | null;
  vendaId?: string | null; compraId?: string | null;
};
type LancView = Lanc & { valorNum: number; statusUp: string; tipoUp: string };
type FinResp = { lancamentos: Lanc[]; fluxo: { receitas: number; despesas: number; resultado: number; contasAPagar: number; contasAReceber: number } };
type FluxoResp = {
  serie: Array<{ dia: string; entradas: number; saidas: number; saldoDia: number; saldoAcumulado: number }>;
  resumo: { totalEntradas: number; totalSaidas: number; saldo: number };
  projecao30dias: { entradas: number; saidas: number; saldoProjetado: number };
};
type DreResp = { detalhes: { receitaBruta: number; deducoes: number; receitaLiquida: number; custos: number; despesas: number; resultadoOperacional: number; lucroPrejuizo: number; margemBruta: number | null; margemLiquida: number | null; qtdVendas: number } };
type Toast = { id: number; text: string; kind: 'ok' | 'warn' | 'err' };

const finCss = `
.fin-root{--bg:var(--nexus-bg);--bg2:var(--nexus-panel-2);--card:var(--nexus-panel);--card2:var(--nexus-panel-2);--card3:var(--nx-surface-3);--border:var(--nexus-border);--border2:var(--nexus-border);--border3:var(--nx-border-strong);--primary:var(--nexus-accent);--primary2:var(--nx-accent-2);--text:var(--nexus-text);--muted:var(--nexus-muted);--label:var(--nexus-muted);--label2:var(--nexus-muted);--success:var(--nx-green);--successBg:color-mix(in srgb,var(--nexus-green) 12%,var(--nexus-panel));--warning:var(--nx-amber);--warningBg:color-mix(in srgb,var(--nexus-amber) 12%,var(--nexus-panel));--danger:var(--nx-red);--dangerBg:color-mix(in srgb,var(--nexus-red) 12%,var(--nexus-panel));--shadow:0 8px 32px rgba(0,0,0,0.28);--shadowPrimary:0 4px 16px rgba(var(--nx-accent-rgb), 0.3)}
.fin-root .fin-card{box-shadow:var(--shadow);transition:border-color .2s ease,box-shadow .2s ease}
.fin-root .fin-card:hover{border-color:var(--nx-border-strong)}
.fin-label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.8px;font-weight:700;color:var(--label2);margin-bottom:6px}
.fin-input{width:100%;height:44px;border-radius:12px;background:var(--card3);border:1px solid var(--border3);padding:0 12px;font-size:12px;color:var(--nexus-text);outline:none;transition:border-color .15s ease,box-shadow .15s ease}
.fin-input::placeholder{color:var(--label)}
.fin-input:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--nexus-accent) 20%,transparent)}
.fin-input.sm{height:36px;border-radius:10px}
select.fin-input option{background:var(--nx-surface-3);color:var(--nexus-text)}
.fin-primary{height:44px;border-radius:12px;padding:0 20px;font-size:12px;font-weight:700;color:var(--nexus-text);border:none;cursor:pointer;background:linear-gradient(135deg,var(--primary),var(--primary2));box-shadow:var(--shadowPrimary);transition:filter .15s ease,transform .1s ease;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.fin-primary:hover{filter:brightness(1.1)}
.fin-primary:active{transform:scale(.98)}
.fin-primary:disabled{opacity:.55;cursor:not-allowed}
.fin-ghost{height:36px;border-radius:10px;padding:0 14px;font-size:12px;color:var(--nexus-text);background:var(--nexus-panel-2);border:1px solid var(--nexus-border);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s ease}
.fin-ghost:hover{background:rgba(102, 47, 241, 0.1);color:var(--nexus-text)}
.fin-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px dashed color-mix(in srgb,var(--nexus-border) 50%,transparent);font-size:12px;color:var(--nexus-text)}
.fin-row:last-child{border-bottom:none}
.fin-row strong{color:var(--nexus-text)}
.fin-toast{animation:finIn .3s ease both;position:relative;overflow:hidden}
@keyframes finIn{from{transform:translateX(20px);opacity:0}to{transform:none;opacity:1}}
.fin-progress{position:absolute;bottom:0;left:0;height:2px;background:var(--primary);border-radius:999px;animation:finShrink 2.8s linear forwards;width:100%}
@keyframes finShrink{from{width:100%}to{width:0%}}
.fin-modal{animation:finPop .2s cubic-bezier(.2,.9,.3,1.12) both}
@keyframes finPop{from{opacity:0;transform:scale(.97) translateY(10px)}to{opacity:1;transform:none}}
`;

/* V2 â€” complements finCss (nothing removed). Tokens de borda/INFO, animaÃ§Ãµes
   nomeadas do layout mestre, scrollbar, grids responsivos e estados de foco. */
const finCssExtra = `
.fin-root{--successBorder:color-mix(in srgb,var(--nexus-green) 35%,var(--nexus-border));--warningBorder:color-mix(in srgb,var(--nexus-amber) 35%,var(--nexus-border));--dangerBorder:color-mix(in srgb,var(--nexus-red) 35%,var(--nexus-border));--info:#3b82f6;--infoBg:color-mix(in srgb,var(--info) 12%,var(--nexus-panel));--infoBorder:color-mix(in srgb,var(--info) 35%,var(--nexus-border))}
.fin-scroll{overflow-y:auto}
.fin-scroll::-webkit-scrollbar{width:6px;height:6px}
.fin-scroll::-webkit-scrollbar-thumb{background:var(--nexus-border);border-radius:10px}
.fin-scroll::-webkit-scrollbar-track{background:var(--bg2)}
.fin-scroll{scrollbar-width:thin;scrollbar-color:var(--nexus-border) var(--bg2)}
@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:none;opacity:1}}
@keyframes shrink{from{width:100%}to{width:0%}}
@keyframes finPulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--nexus-accent) 40%,transparent)}50%{box-shadow:0 0 0 10px transparent}}
.fin-card{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:24px;box-shadow:var(--shadow);transition:border-color .2s ease,box-shadow .2s ease}
.fin-card:hover{border-color:var(--nx-border-strong)}
.fin-title{font-size:14px;font-weight:700;color:var(--nexus-text);margin:0}
.fin-sub{font-size:11px;color:var(--muted);margin:2px 0 0;line-height:1.5}
.fin-kpi{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px;box-shadow:var(--shadow);transition:all .2s ease;min-width:0}
.fin-kpi:hover{border-color:var(--nx-border-strong);transform:translateY(-1px)}
.fin-val{font-size:20px;font-weight:700;color:var(--nexus-text);letter-spacing:-.02em}
.fin-label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;color:var(--label);margin-bottom:6px}
.fin-wrap{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.fin-grid-kpi{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.fin-grid-main{display:grid;grid-template-columns:1.8fr 1fr;gap:16px}
.fin-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.fin-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.fin-thead th{position:sticky;top:0;background:var(--card);z-index:10;font-size:10px;color:var(--label2);text-transform:uppercase;letter-spacing:.8px;padding:10px 8px;border-bottom:1px solid var(--nexus-border);text-align:left;white-space:nowrap}
.fin-tbody tr{border-bottom:1px solid var(--nexus-border);transition:background .15s ease,box-shadow .15s ease}
.fin-tbody tr:hover{background:var(--nexus-panel-2)}
.fin-tbody.fin-pagar tr:hover{box-shadow:inset 2px 0 0 var(--warning)}
.fin-tbody.fin-receber tr:hover{box-shadow:inset 2px 0 0 var(--success)}
.fin-cell{padding:10px 8px;font-size:12px}
.fin-row-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed color-mix(in srgb,var(--nexus-border) 50%,transparent);font-size:12px;color:var(--nexus-text)}
.fin-row-h:last-child{border-bottom:none}
.fin-row-h strong{color:var(--nexus-text);font-weight:700}
.fin-sel{height:36px;border-radius:10px;background:var(--nexus-panel-2);border:1px solid var(--nexus-border);padding:0 12px;font-size:11px;color:var(--nexus-text);outline:none;cursor:pointer}
.fin-sel:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--nexus-accent) 20%,transparent)}
.fin-ia-icon{animation:finPulse 2s infinite}
.fin-modal-box{animation:slideIn .3s ease both}
.fin-x{overflow-x:auto}
.fin-x::-webkit-scrollbar{height:6px}
.fin-x::-webkit-scrollbar-thumb{background:var(--nexus-border);border-radius:10px}
@media (max-width:1180px){.fin-grid-kpi{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:1023px){.fin-grid-main{grid-template-columns:1fr}.fin-grid-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:767px){.fin-grid-2{grid-template-columns:1fr}.fin-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:479px){.fin-grid-kpi{grid-template-columns:1fr}.fin-card{padding:16px}}
`;
const PRESETS_UI: Array<{ key: PresetKey; label: string }> = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7d' },
];
const PRESETS_FULL: Array<{ key: PresetKey; label: string }> = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'mes', label: 'MÃªs' },
  { key: 'mesAnterior', label: 'MÃªs ant.' },
];
const TIPOS = ['Todos', 'RECEITA', 'DESPESA'] as const;
/**
 * `VENCIDO` nÃ£o Ã© um estado que o usuÃ¡rio escolha: o servidor o DERIVA na
 * leitura (um PENDENTE com vencimento no passado responde como VENCIDO â€”
 * ver `gestao.routes.ts`). Por isso o filtro "Vencido" funciona: o status
 * chega VENCIDO e a comparaÃ§Ã£o abaixo bate. O valor gravado no PostgreSQL
 * continua PENDENTE, que Ã© o que o fluxo de caixa usa para projetar.
 */
const STATUSF = ['Todos', 'PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO'] as const;

/** Atraso: true para o que estÃ¡ em aberto (PENDENTE ou VENCIDO) e jÃ¡ venceu. */
function isAtrasado(l: Lanc, hoje: string): boolean {
  const st = (l.status || '').toUpperCase();
  if (st !== 'PENDENTE' && st !== 'VENCIDO') return false;
  if (!l.vencimento) return st === 'VENCIDO';
  return diaLocal(new Date(l.vencimento)) < hoje;
}
function isHoje(l: Lanc, hoje: string): boolean {
  const base = l.vencimento || l.createdAt;
  if (!base) return false;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return false;
  return diaLocal(d) === hoje;
}

/* Categorias aceitas pelo contrato real (POST /financeiro + model Prisma). */
const CATS_DESPESA = ['operacionais', 'fornecedores', 'salarios', 'servicos', 'impostos'];
const CATS_RECEITA = ['vendas', 'servicos', 'outros'];
const CENTROS_CUSTO = ['Matriz', 'Filial', 'Vendas', 'Setor'];
const PALETA = ['#3b82f6', '#f59e0b', '#22c55e', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

/** R$ compacto para eixos e mini-cards (R$ 84,7k). */
function fmtK(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return 'R$ 0';
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1000000) return `${s}R$ ${(a / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (a >= 1000) return `${s}R$ ${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

/** Dias de atraso em relaÃ§Ã£o a hoje (0 = nÃ£o atrasado). */
function diasAtraso(l: Lanc, hoje: string): number {
  if (!l.vencimento) return 0;
  const d = diaLocal(new Date(l.vencimento));
  if (d >= hoje) return 0;
  return Math.round(
    (new Date(`${hoje}T00:00:00`).getTime() - new Date(`${d}T00:00:00`).getTime()) / 86400000,
  );
}

/** VariaÃ§Ã£o real vs. perÃ­odo anterior; null quando nÃ£o hÃ¡ base comparÃ¡vel. */
function deltaPct(atual: number, anterior: number | null): number | null {
  if (anterior === null || !Number.isFinite(anterior) || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/* ===== Componentes reutilizÃ¡veis (V2) ================================== */
const box: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 };
const btnG: React.CSSProperties = { background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 8, height: 32, padding: '0 12px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 };
const btnP: React.CSSProperties = { background: 'linear-gradient(135deg,var(--primary),var(--primary2))', boxShadow: 'var(--shadowPrimary)', borderRadius: 12, height: 44, padding: '0 20px', fontSize: 12, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
const lbl: React.CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, color: 'var(--label2)' };
const inp: React.CSSProperties = { background: 'var(--card3)', border: '1px solid var(--border3)', borderRadius: 10, height: 44, padding: '0 12px', fontSize: 12, color: '#fff', width: '100%', outline: 'none' };

/** Chip de status com a paleta do layout mestre. */
function StatusChip({ st, atraso }: { st: string; atraso?: number }) {
  const t =
    st === 'PAGO' ? { bg: 'var(--successBg)', fg: 'var(--success)', bd: 'var(--successBorder)' }
      : st === 'VENCIDO' ? { bg: 'var(--dangerBg)', fg: 'var(--danger)', bd: 'var(--dangerBorder)' }
        : st === 'CANCELADO' ? { bg: 'rgba(255,255,255,.06)', fg: 'var(--muted)', bd: 'var(--border)' }
          : { bg: 'var(--warningBg)', fg: 'var(--warning)', bd: 'var(--warningBorder)' };
  return (
    <span style={{ background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, borderRadius: 20, padding: '3px 10px', fontSize: 10, whiteSpace: 'nowrap', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {st === 'PAGO' ? 'Pago' : st === 'VENCIDO' ? 'Atrasada' : st === 'CANCELADO' ? 'Cancelado' : 'Pendente'}
      {atraso ? <span style={{ opacity: 0.85 }}>{atraso}d</span> : null}
    </span>
  );
}

/** Linha rÃ³tulo â†’ valor do DRE, com recuo e margem opcional. */
function LinhaDre({ rotulo, valor, margem, ind }: { rotulo: string; valor: number; margem?: number; ind?: boolean }) {
  return (
    <div className="fin-row-h" style={ind ? { paddingLeft: 14 } : undefined}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {rotulo}
        {typeof margem === 'number' ? (
          <span style={{ background: 'var(--successBg)', color: 'var(--success)', borderRadius: 999, padding: '1px 7px', fontSize: 10 }}>{margem.toFixed(1)}%</span>
        ) : null}
      </span>
      <strong>{formatBRL(valor)}</strong>
    </div>
  );
}

/** RÃ³tulo â†’ valor dos 4 totalizadores. */
function Totalizador({ rotulo, valor, cor }: { rotulo: string; valor: number; cor?: string }) {
  return (
    <div style={{ background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{rotulo}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: cor ?? '#fff', marginTop: 3 }}>{formatBRL(valor)}</div>
    </div>
  );
}

export default function Financeiro() {
  const router = useRouter();
  const [dados, setDados] = useState<FinResp | null>(null);
  const [fluxoDados, setFluxoDados] = useState<FluxoResp | null>(null);
  const [dre, setDre] = useState<DreResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Aviso de resultado cortado pelo limite de 200 lanÃ§amentos do endpoint
   * (mesmo contrato de `X-Truncated` jÃ¡ usado em /ponto). NÃ£o Ã© erro: Ã©
   * informaÃ§Ã£o â€” sem ela, o gestor lia "20 lanÃ§amentos" e nenhuma
   * indicaÃ§Ã£o de que o perÃ­odo tinha mais.
   */
  const [avisoCorte, setAvisoCorte] = useState<string | null>(null);
  /** Total real de lanÃ§amentos do perÃ­odo (vem em `X-Total-Count`). */
  const [totalPeriodo, setTotalPeriodo] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<PresetKey>('mes');
  const [tipoF, setTipoF] = useState<string>('Todos');
  const [statusF, setStatusF] = useState<string>('Todos');
  const [query, setQuery] = useState('');
  const [queryDeb, setQueryDeb] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<LancView | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);
  const searchRef = useRef<HTMLInputElement>(null);
  const [fTipo, setFTipo] = useState<'RECEITA' | 'DESPESA'>('DESPESA');
  const [fCat, setFCat] = useState('operacionais');
  const [fDesc, setFDesc] = useState('');
  const [fValor, setFValor] = useState<number>(100);
  const [fVenc, setFVenc] = useState('');
  const [fCentro, setFCentro] = useState('');
  const [saving, setSaving] = useState(false);
  /**
   * LanÃ§amento cuja duplicaÃ§Ã£o estÃ¡ em andamento. Sem este estado, dois
   * cliques rÃ¡pidos no Ã­cone de cÃ³pia gravavam DOIS lanÃ§amentos idÃªnticos.
   */
  const [duplicandoId, setDuplicandoId] = useState<string | null>(null);
  // V2 â€” estados de modal/exportaÃ§Ã£o/planejamento.
  const [showDre, setShowDre] = useState(false);
  const [showFluxo, setShowFluxo] = useState(false);
  const [anterior, setAnterior] = useState<{ receitas: number; despesas: number } | null>(null);
  const [plano, setPlano] = useState<Record<string, { entrada: number; saida: number }>>({});
  const addToast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = toastId.current++;
    setToasts((p) => [...p, { id, text, kind }]);
    window.setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 2800);
  }, []);
  const intervalo = useMemo(() => intervaloDoPreset(periodo, '', ''), [periodo]);
  const params = useMemo(() => ({ periodoInicio: comFuso(intervalo.inicio, '00:00'), periodoFim: comFuso(intervalo.fim, '23:59') }), [intervalo]);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // `getComHeaders` traz os headers junto do corpo. O servidor sinaliza
      // `X-Truncated` quando o perÃ­odo tem mais de 200 lanÃ§amentos (o limite
      // da consulta): antes disso, a tela mostrava 200 linhas sem avisar que
      // existiam mais, e os KPIs pareciam completos quando nÃ£o eram.
      const [fin, flx, d] = await Promise.all([
        api.getComHeaders<FinResp>('/financeiro', { params }),
        api.get<FluxoResp>('/fluxo-caixa', { params }).catch(() => ({ data: null as unknown as FluxoResp })),
        api.get<DreResp>('/dre', { params }).catch(() => ({ data: null as unknown as DreResp })),
      ]);
      setDados(fin.data);
      setFluxoDados(flx.data ?? null);
      setDre(d.data ?? null);
      const truncado = fin.headers.get('x-truncated') === 'true';
      const total = fin.headers.get('x-total-count');
      setTotalPeriodo(total ? Number(total) : null);
      setAvisoCorte(
        truncado
          ? `Exibindo os ${Array.isArray(fin.data?.lancamentos) ? fin.data.lancamentos.length : 0} lanÃ§amentos mais recentes de ${total ?? 'mais'} no perÃ­odo. Os totais do topo (Receitas, Despesas e Resultado) jÃ¡ consideram TODOS os ${total ?? ''} â€” apenas a lista e os grÃ¡ficos por linha estÃ£o limitados. Reduza o perÃ­odo para ver o restante.`
          : null,
      );
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'NÃ£o foi possÃ­vel carregar o financeiro.'); }
    finally { setLoading(false); }
  }, [params]);

  /* ===== Efeitos ===================================================== */
  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void load();
  }, [router, load]);

  // Debounce 300ms da busca (nÃ£o refaz requisiÃ§Ã£o a cada tecla).
  useEffect(() => {
    const t = window.setTimeout(() => setQueryDeb(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  // PerÃ­odo anterior real â€” base dos deltas dos KPIs (nunca inventados).
  const paramsAnterior = useMemo(() => {
    const p = periodoAnterior(intervalo.inicio, intervalo.fim);
    return { periodoInicio: comFuso(p.inicio, '00:00'), periodoFim: comFuso(p.fim, '23:59') };
  }, [intervalo]);
  useEffect(() => {
    let vivo = true;
    api.get<FinResp>('/financeiro', { params: paramsAnterior })
      .then(({ data }) => {
        if (vivo) setAnterior({ receitas: data?.fluxo?.receitas ?? 0, despesas: data?.fluxo?.despesas ?? 0 });
      })
      .catch(() => { if (vivo) setAnterior(null); });
    return () => { vivo = false; };
  }, [paramsAnterior]);

  const abrirNovo = useCallback((tipo?: 'RECEITA' | 'DESPESA') => {
    const t = tipo ?? 'DESPESA';
    setFTipo(t);
    setFCat(t === 'RECEITA' ? 'vendas' : 'operacionais');
    setFDesc(''); setFValor(100); setFCentro('');
    setFVenc(diaLocal(new Date()));
    setShowNew(true);
  }, []);

  // Atalhos: / busca Â· n novo Â· d DRE completo Â· g planejar fluxo Â· Esc fecha.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowNew(false); setDetail(null); setShowDre(false); setShowFluxo(false); return; }
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); abrirNovo(); }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); setShowDre(true); }
      if (e.key === 'g' || e.key === 'G') { e.preventDefault(); setShowFluxo(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [abrirNovo]);

  // Trava o scroll do fundo enquanto houver overlay aberto.
  useEffect(() => {
    const temOverlay = showNew || !!detail || showDre || showFluxo;
    document.body.style.overflow = temOverlay ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showNew, detail, showDre, showFluxo]);

  /* ===== Derivados (useMemo) ========================================= */
  const hoje = useMemo(() => diaLocal(new Date()), []);

  const lancamentos = useMemo<LancView[]>(
    () => (dados?.lancamentos ?? []).map((l) => ({
      ...l,
      valorNum: Number(l.valor) || 0,
      statusUp: (l.status || '').toUpperCase(),
      tipoUp: (l.tipo || '').toUpperCase(),
    })),
    [dados],
  );

  const filtrados = useMemo(() => {
    const q = queryDeb.trim().toLowerCase();
    return lancamentos.filter((l) => {
      if (tipoF !== 'Todos' && l.tipoUp !== tipoF) return false;
      if (statusF !== 'Todos' && l.statusUp !== statusF) return false;
      if (!q) return true;
      return `${l.descricao} ${l.categoria} ${l.centroCusto ?? ''}`.toLowerCase().includes(q);
    });
  }, [lancamentos, tipoF, statusF, queryDeb]);

  const pagar = useMemo(() => filtrados.filter((l) => l.tipoUp === 'DESPESA'), [filtrados]);
  const receber = useMemo(() => filtrados.filter((l) => l.tipoUp === 'RECEITA'), [filtrados]);

  const aberto = (l: LancView) => l.statusUp === 'PENDENTE' || l.statusUp === 'VENCIDO';

  const kpis = useMemo(() => {
    const f = dados?.fluxo;
    const receitas = f?.receitas ?? 0;
    const despesas = f?.despesas ?? 0;
    const resultado = f?.resultado ?? receitas - despesas;
    const margem = receitas > 0 ? (resultado / receitas) * 100 : null;

    const aPagar = lancamentos.filter((l) => l.tipoUp === 'DESPESA' && aberto(l));
    const aReceber = lancamentos.filter((l) => l.tipoUp === 'RECEITA' && aberto(l));
    const soma = (ls: LancView[]) => ls.reduce((s, l) => s + l.valorNum, 0);

    return {
      receitas, despesas, resultado, margem,
      dReceitas: deltaPct(receitas, anterior?.receitas ?? null),
      dDespesas: deltaPct(despesas, anterior?.despesas ?? null),
      dResultado: deltaPct(resultado, anterior ? anterior.receitas - anterior.despesas : null),
      qtdPagar: aPagar.length, totalPagar: soma(aPagar),
      qtdReceber: aReceber.length, totalReceber: soma(aReceber),
      atrasadas: aPagar.filter((l) => isAtrasado(l, hoje)).length,
      vencemHoje: lancamentos.filter((l) => aberto(l) && isHoje(l, hoje)).length,
    };
  }, [dados, lancamentos, anterior, hoje]);

  // SÃ©rie diÃ¡ria vinda de GET /fluxo-caixa (entradas, saÃ­das e saldo real).
  const serieFluxo = useMemo(
    () => (fluxoDados?.serie ?? []).map((s) => ({
      dia: s.dia,
      rotulo: s.dia.slice(8) + '/' + s.dia.slice(5, 7),
      entradas: Number(s.entradas) || 0,
      saidas: Number(s.saidas) || 0,
      saldo: Number(s.saldoAcumulado) || 0,
    })),
    [fluxoDados],
  );

  // Mini-cards: hoje / Ãºltimos 7 dias / perÃ­odo / projeÃ§Ã£o real de 30 dias.
  const resumos = useMemo(() => {
    const soma = (ls: typeof serieFluxo) => ({
      entrada: ls.reduce((s, d) => s + d.entradas, 0),
      saida: ls.reduce((s, d) => s + d.saidas, 0),
    });
    const hojeKey = hoje;
    const d7 = new Date(); d7.setDate(d7.getDate() - 6);
    const desde7 = diaLocal(d7);
    return {
      hoje: soma(serieFluxo.filter((d) => d.dia === hojeKey)),
      semana: soma(serieFluxo.filter((d) => d.dia >= desde7)),
      periodo: {
        entrada: Number(fluxoDados?.resumo?.totalEntradas) || 0,
        saida: Number(fluxoDados?.resumo?.totalSaidas) || 0,
      },
      projetado: {
        entrada: Number(fluxoDados?.projecao30dias?.entradas) || 0,
        saida: Number(fluxoDados?.projecao30dias?.saidas) || 0,
      },
    };
  }, [serieFluxo, fluxoDados, hoje]);

  // Despesas agrupadas por categoria (dados reais do perÃ­odo) â€” pizza + barras.
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    lancamentos
      .filter((l) => l.tipoUp === 'DESPESA' && l.statusUp !== 'CANCELADO')
      .forEach((l) => m.set(l.categoria, (m.get(l.categoria) ?? 0) + l.valorNum));
    return [...m.entries()].map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor);
  }, [lancamentos]);

  // Receitas x Despesas x Resultado por categoria, para o DRE completo.
  const barrasDre = useMemo(() => {
    const rec = new Map<string, number>();
    const des = new Map<string, number>();
    lancamentos.filter((l) => l.statusUp !== 'CANCELADO').forEach((l) => {
      const m = l.tipoUp === 'RECEITA' ? rec : des;
      m.set(l.categoria, (m.get(l.categoria) ?? 0) + l.valorNum);
    });
    return [...new Set([...rec.keys(), ...des.keys()])].map((categoria) => ({
      categoria,
      receita: rec.get(categoria) ?? 0,
      despesa: des.get(categoria) ?? 0,
      resultado: (rec.get(categoria) ?? 0) - (des.get(categoria) ?? 0),
    }));
  }, [lancamentos]);

  // Insights da IA: todos derivados dos nÃºmeros reais acima.
  const insights = useMemo(() => {
    const d = dre?.detalhes;
    const atrasoTotal = lancamentos
      .filter((l) => l.tipoUp === 'DESPESA' && isAtrasado(l, hoje))
      .reduce((s, l) => s + l.valorNum, 0);
    const projecao = fluxoDados?.projecao30dias;
    const saldoProj = Number(projecao?.saldoProjetado) || 0;
    const maiorCat = porCategoria[0];
    return [
      atrasoTotal > 0 && {
        icone: 'ðŸš¨', tom: 'danger' as const,
        titulo: `${kpis.atrasadas} conta(s) a pagar atrasada(s)`,
        texto: `${formatBRL(atrasoTotal)} em atraso. Regularize para nÃ£o comprar multa e perda de desconto.`,
      },
      {
        icone: 'ðŸ’°', tom: (kpis.resultado >= 0 ? 'success' : 'danger') as 'success' | 'danger',
        titulo: kpis.resultado >= 0 ? 'Fluxo positivo no perÃ­odo' : 'Fluxo negativo no perÃ­odo',
        texto: `${formatBRL(kpis.resultado)} de resultado${kpis.margem !== null ? ` Â· margem ${kpis.margem.toFixed(1)}%` : ''}.`,
      },
      maiorCat ? {
        icone: 'ðŸ“ˆ', tom: 'warning' as const,
        titulo: `Maior despesa: ${maiorCat.categoria}`,
        texto: `${formatBRL(maiorCat.valor)} no perÃ­odo â€” valide se o valor estÃ¡ no orÃ§amento.`,
      } : null,
      projecao ? {
        icone: 'ðŸ’¡', tom: 'info' as const,
        titulo: 'ProjeÃ§Ã£o real dos prÃ³ximos 30 dias',
        texto: `${formatBRL(Number(projecao.entradas) || 0)} a receber e ${formatBRL(Number(projecao.saidas) || 0)} a pagar, saldo projetado ${formatBRL(saldoProj)}. O horizonte inclui as contas jÃ¡ vencidas â€” o dinheiro que nÃ£o vai cair.`,
      } : null,
      d ? {
        icone: 'ðŸ¦', tom: d.lucroPrejuizo >= 0 ? ('success' as const) : ('danger' as const),
        titulo: 'DRE do perÃ­odo',
        // `|| 0` aqui transformava margem nÃ£o calculÃ¡vel (perÃ­odo sem receita, em que
        // o backend devolve `null`) em "0,0%" â€” que se lÃª como margem zero. O
        // texto passa a dizer "â€”" nesse caso, como o resto da tela.
        texto: `Margem bruta ${d.margemBruta === null ? 'â€”' : `${Number(d.margemBruta).toFixed(1)}%`} e margem lÃ­quida ${d.margemLiquida === null ? 'â€”' : `${Number(d.margemLiquida).toFixed(1)}%`} em ${Number(d.qtdVendas) || 0} venda(s).`,
      } : null,
    ].filter(Boolean) as Array<{ icone: string; tom: 'success' | 'warning' | 'danger' | 'info'; titulo: string; texto: string }>;
  }, [dre, lancamentos, porCategoria, fluxoDados, kpis, hoje]);

  /* ===== AÃ§Ãµes ======================================================== */
  const salvarLancamento = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    // Trava contra duplo envio: o botÃ£o fica desabilitado por `saving`, mas o
    // Enter repetido no campo de descriÃ§Ã£o tambÃ©m disparava o `onSubmit` e
    // gravava dois lanÃ§amentos iguais.
    if (saving) return;
    const descricao = fDesc.trim();
    if (descricao.length < 2) { addToast('Informe a descriÃ§Ã£o (mÃ­nimo 2 letras).', 'warn'); return; }
    const valor = Number(fValor);
    if (!Number.isFinite(valor) || valor <= 0) { addToast('Informe um valor maior que zero.', 'warn'); return; }
    // Espelha o limite do `Decimal(12,2)` do PostgreSQL para dar a mensagem
    // certa aqui, em vez de deixar o servidor recusar com erro interno.
    if (valor > 9_999_999_999.99) { addToast('Valor acima do mÃ¡ximo aceito (R$ 9.999.999.999,99).', 'warn'); return; }
    setSaving(true);
    try {
      await api.post('/financeiro', {
        tipo: fTipo,
        categoria: fCat,
        centroCusto: fCentro.trim() || undefined,
        descricao,
        valor,
        // Meio-dia local evita que o dia pule ao converter para UTC.
        vencimento: fVenc ? new Date(`${fVenc}T12:00:00`).toISOString() : undefined,
        status: 'PENDENTE',
        origem: 'MANUAL',
      });
      setShowNew(false);
      setFDesc(''); setFValor(100);
      addToast(`${fTipo === 'RECEITA' ? 'Receita' : 'Despesa'} de ${formatBRL(valor)} lanÃ§ada.`);
      await load();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'NÃ£o foi possÃ­vel lanÃ§ar.', 'err');
    } finally { setSaving(false); }
  }, [fTipo, fCat, fCentro, fDesc, fValor, fVenc, addToast, load, saving]);

  // â”€â”€ Duplicar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A duplicaÃ§Ã£o Ã© a Ãºnica forma de repetir um lanÃ§amento jÃ¡ existente sem
// digitar tudo de novo (a API nÃ£o tem PATCH /financeiro â€” ver o aviso no modal
// de detalhe). Ela grava um NOVO registro via POST /financeiro, que Ã© a
// escrita real disponÃ­vel.
//
// TRÃŠS CUIDADOS QUE O CÃ“DIGO ORIGINAL NÃƒO TINHA:
//  1. `vencimento` do Prisma volta como ISO COMPLETO (ex.: "2026-09-15T12:00:00.000Z").
//     Reenviar essa string como `vencimento` funcionava por acaso, mas o
//     `new Date()` do servidor reinterpretava no fuso do servidor; agora
//     normalizamos para o mesmo formato de meio-dia usado no formulÃ¡rio,
//     garantindo que o dia exibido seja o mesmo em qualquer fuso.
//  2. A descriÃ§Ã£o NÃƒO pode acumular "(cÃ³pia)" a cada duplicata â€” duplicar trÃªs
//     vezes produzia "X (cÃ³pia) (cÃ³pia) (cÃ³pia)". Removemos o sufixo existente
//     antes de reaplicar.
//  3. Guarda de "duplicando": sem ela, dois cliques rÃ¡pidos no Ã­cone de cÃ³pia
//     gravavam DOIS lanÃ§amentos idÃªnticos sem o usuÃ¡rio perceber.
const duplicar = useCallback(async (l: LancView) => {
  if (duplicandoId === l.id) return;
  setDuplicandoId(l.id);
  try {
    // Remove um "(cÃ³pia)" jÃ¡ existente para nÃ£o empilhar o sufixo.
    const descricaoLimpa = l.descricao.replace(/\s*\(cÃ³pia\)\s*$/i, '').trim();
    await api.post('/financeiro', {
      tipo: l.tipo,
      categoria: l.categoria,
      centroCusto: l.centroCusto ?? undefined,
      descricao: `${descricaoLimpa} (cÃ³pia)`,
      valor: l.valorNum,
      // `YYYY-MM-DD` -> meio-dia local -> ISO. Mesmo caminho do formulÃ¡rio,
      // para o dia do vencimento nÃ£o mudar por fuso.
      vencimento: l.vencimento
        ? new Date(`${diaLocal(new Date(l.vencimento))}T12:00:00`).toISOString()
        : undefined,
      status: 'PENDENTE',
      origem: 'MANUAL',
    });
    addToast(`CÃ³pia de "${descricaoLimpa}" lanÃ§ada como pendente.`);
    await load();
  } catch (err: unknown) {
    addToast(err instanceof Error ? err.message : 'NÃ£o foi possÃ­vel duplicar.', 'err');
  } finally {
    setDuplicandoId(null);
  }
}, [addToast, load, duplicandoId]);

  /**
   * Exporta o que estÃ¡ NA TELHA (filtros aplicados) em CSV.
   *
   * O endpoint devolve no mÃ¡ximo 200 lanÃ§amentos por consulta. Exportar sem
   * dizer isso produzia um arquivo que PARECIA completo e nÃ£o era â€” o gestor
   * abria a planilha, comparava com o total do topo (que cobre o perÃ­odo
   * inteiro) e nÃ£o encontrava a diferenÃ§a. Quando o servidor sinaliza o corte,
   * o prÃ³prio CSV registra a quantidade total e o perÃ­odo.
   */
  const exportarCSV = useCallback(() => {
    const cab = ['id', 'tipo', 'categoria', 'descricao', 'valor', 'vencimento', 'status', 'centroCusto', 'origem'];
    const linhas = filtrados.map((l) => [
      l.id, l.tipo, l.categoria, l.descricao, String(l.valorNum),
      l.vencimento ? l.vencimento.slice(0, 10) : '', l.status, l.centroCusto ?? '', l.origem ?? '',
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    const cabecalho = ['\ufeff' + cab.join(';')];
    if (avisoCorte) {
      // Uma linha de metadado, no padrÃ£o comentÃ¡rio, antes do cabeÃ§alho real.
      cabecalho.unshift(
        `\ufeff# ATENÃ‡ÃƒO: este arquivo contÃ©m apenas os ${linhas.length} lanÃ§amento(s) mais recentes do perÃ­odo. Reduza o perÃ­odo para exportar o restante.`
          .replace(/"/g, '""'),
      );
    }
    const csv = [...cabecalho, ...linhas].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-${hoje}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(avisoCorte
      ? `${linhas.length} de ${totalPeriodo ?? linhas.length} lanÃ§amento(s) exportado(s) â€” o CSV avisa sobre o corte.`
      : `${linhas.length} lanÃ§amento(s) exportado(s).`);
  }, [filtrados, hoje, addToast, avisoCorte, totalPeriodo]);

  // Planejamento: agenda real dos lanÃ§amentos em aberto (prÃ³ximos 60 dias).
  const agenda = useMemo(() => {
    const limite = new Date(); limite.setDate(limite.getDate() + 60);
    const ate = diaLocal(limite);
    return lancamentos
      .filter((l) => aberto(l) && l.vencimento && l.vencimento.slice(0, 10) >= hoje && l.vencimento.slice(0, 10) <= ate)
      .sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? ''))
      .map((l) => ({ l, ...(plano[l.id] ?? { entrada: l.tipoUp === 'RECEITA' ? l.valorNum : 0, saida: l.tipoUp === 'DESPESA' ? l.valorNum : 0 }) }));
  }, [lancamentos, plano, hoje]);

  const saldoPlanejado = useMemo(() => {
    const base = Number(fluxoDados?.resumo?.saldo) || 0;
    return agenda.reduce((s, a) => s + (Number(a.entrada) || 0) - (Number(a.saida) || 0), base);
  }, [agenda, fluxoDados]);

  // `padrao` semeia o par a partir do lanÃ§amento real, para editar um campo
  // nÃ£o zerar o outro (o plano comeÃ§a vazio).
  const setPlanoValor = useCallback((
    id: string, campo: 'entrada' | 'saida', v: string, padrao: { entrada: number; saida: number },
  ) => {
    setPlano((p) => ({ ...p, [id]: { ...(p[id] ?? padrao), [campo]: Number(v) || 0 } }));
  }, []);

  /* ===== Render ======================================================= */
  const Kpi = ({
    rotulo, valor, sub, delta, deltaBom, cor, Icon: Ico,
  }: {
    rotulo: string; valor: string; sub?: string; delta?: number | null;
    deltaBom?: boolean; cor: string; Icon: typeof TrendingUp;
  }) => (
    <div className="fin-kpi">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{rotulo}</div>
          <div className="fin-val" style={{ marginTop: 4 }}>{valor}</div>
        </div>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--nexus-border)', color: cor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Ico size={16} color={cor} />
        </span>
      </div>
      {typeof delta === 'number' ? (
        <span style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 6, fontSize: 11, color: deltaBom ? 'var(--success)' : 'var(--danger)', background: deltaBom ? 'var(--successBg)' : 'var(--dangerBg)' }}>
          {delta >= 0 ? <ArrowUpRight size={11} color={deltaBom ? 'var(--success)' : 'var(--danger)'} /> : <ArrowDownRight size={11} color={deltaBom ? 'var(--success)' : 'var(--danger)'} />}
          {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% <span style={{ color: 'var(--label)' }}>vs anterior</span>
        </span>
      ) : null}
      {sub ? <div style={{ marginTop: typeof delta === 'number' ? 6 : 8, fontSize: 11, color: 'var(--label)' }}>{sub}</div> : null}
    </div>
  );

  /** Tabela de contas a pagar / a receber â€” mesma anatomia, cor de destaque diferente. */
  const TabelaContas = ({
    titulo, icone: Icone, linhas, variante, totalRotulo, vazio,
  }: {
    titulo: string; icone: typeof Wallet; linhas: LancView[]; variante: 'pagar' | 'receber';
    totalRotulo: string; vazio: string;
  }) => {
    const emAberto = linhas.filter(aberto);
    const totalAberto = emAberto.reduce((s, l) => s + l.valorNum, 0);
    const atrasadas = emAberto.filter((l) => isAtrasado(l, hoje));
    const vencemHoje = emAberto.filter((l) => isHoje(l, hoje));
    const pagas = linhas.filter((l) => !aberto(l));
    return (
      <section className="fin-card" style={{ padding: 20 }} aria-label={titulo}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Icone size={16} color={variante === 'pagar' ? 'var(--warning)' : 'var(--success)'} />
            <h3 className="fin-title">{titulo} ({linhas.length})</h3>
            <span style={{ background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 10px', fontSize: 10, color: 'var(--muted)' }}>{totalRotulo} {formatBRL(totalAberto)}</span>
            {atrasadas.length > 0 ? (
              <span style={{ background: 'var(--dangerBg)', color: 'var(--danger)', border: '1px solid var(--dangerBorder)', borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{atrasadas.length} atrasada(s)</span>
            ) : null}
            {vencemHoje.length > 0 ? (
              <span style={{ background: 'var(--successBg)', color: 'var(--success)', border: '1px solid var(--successBorder)', borderRadius: 20, padding: '2px 8px', fontSize: 10 }}>{vencemHoje.length} vencem hoje</span>
            ) : null}
          </div>
          <button type="button" onClick={() => abrirNovo(variante === 'pagar' ? 'DESPESA' : 'RECEITA')} style={btnG}>
            <Plus size={12} /> Nova conta a {variante === 'pagar' ? 'pagar' : 'receber'}
          </button>
        </div>

        {linhas.length === 0 ? (
          <EmptyState title={vazio} description="Ajuste o perÃ­odo, os filtros ou a busca para ver os lanÃ§amentos." icon={Icone} />
        ) : (
          <div className="fin-x">
            <table role="table" aria-label={titulo} style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead className="fin-thead">
                <tr>
                  <th scope="col">{traduzir('descricao', "DescriÃ§Ã£o")}</th>
                  <th scope="col">{traduzir('categoria', "Categoria")}</th>
                  <th scope="col">{traduzir('vencimento', "Vencimento")}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{traduzir('valor', "Valor")}</th>
                  <th scope="col">{traduzir('status', "Status")}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{traduzir('acoes', "AÃ§Ãµes")}</th>
                </tr>
              </thead>
              <tbody className={`fin-tbody ${variante === 'pagar' ? 'fin-pagar' : 'fin-receber'}`}>
                {linhas.map((l) => (
                  <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(l)}>
                    <td className="fin-cell">
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{l.descricao}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.centroCusto || 'Sem centro de custo'}</div>
                    </td>
                    <td className="fin-cell" style={{ color: 'var(--label)' }}>{l.categoria}</td>
                    <td className="fin-cell" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{l.vencimento ? formatDate(l.vencimento) : 'â€”'}</td>
                    <td className="fin-cell" style={{ textAlign: 'right', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{formatBRL(l.valorNum)}</td>
                    <td className="fin-cell">
                      <StatusChip st={l.statusUp} atraso={isAtrasado(l, hoje) ? diasAtraso(l, hoje) : undefined} />
                    </td>
                    <td className="fin-cell" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button" title={traduzir('detalhes', "Detalhes")} aria-label={`Detalhes de ${l.descricao}`}
                        onClick={(e) => { e.stopPropagation(); setDetail(l); }}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 10, padding: 4 }}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        type="button"
                        title={traduzir('duplicar', "Duplicar")}
                        aria-label={`Duplicar ${l.descricao}`}
                        disabled={duplicandoId === l.id}
                        onClick={(e) => { e.stopPropagation(); void duplicar(l); }}
                        style={{ background: 'none', border: 'none', color: duplicandoId === l.id ? 'var(--label)' : 'var(--muted)', cursor: duplicandoId === l.id ? 'progress' : 'pointer', fontSize: 10, padding: 4 }}
                      >
                        {duplicandoId === l.id ? 'â€¦' : <Copy size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="fin-grid-4" style={{ marginTop: 12 }}>
          <Totalizador rotulo={traduzir('em_aberto', "Em aberto")} valor={totalAberto} />
          <Totalizador rotulo={traduzir('atrasadas', "Atrasadas")} valor={atrasadas.reduce((s, l) => s + l.valorNum, 0)} cor="var(--danger)" />
          <Totalizador rotulo={traduzir('vencem_hoje', "Vencem hoje")} valor={vencemHoje.reduce((s, l) => s + l.valorNum, 0)} cor="var(--warning)" />
          <Totalizador rotulo={variante === 'pagar' ? 'Pagas no perÃ­odo' : 'Recebidas no perÃ­odo'} valor={pagas.reduce((s, l) => s + l.valorNum, 0)} cor="var(--success)" />
        </div>
      </section>
    );
  };

  if (loading && !dados) {
    return (
      <div className="fin-root" style={{ background: 'var(--bg)', minHeight: '100vh', padding: '24px 28px', color: '#fff' }}>
        <style>{finCss + finCssExtra}</style>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>Carregando financeiroâ€¦</p>
      </div>
    );
  }
  return (
    <div className="fin-root fin-scroll" style={{ background: 'var(--bg)', minHeight: '100vh', padding: '24px 28px', fontFamily: 'Inter, system-ui, sans-serif', color: '#fff' }}>
      <style>{finCss + finCssExtra}</style>

      <ModuleHeader
        title={traduzir('financeiro', "Financeiro")}
        subtitle="Receitas, despesas, contas a pagar/receber e fluxo de caixa a partir de dados reais da empresa."
        action={
          <div className="fin-wrap">
            <button type="button" onClick={exportarCSV} style={btnG} title="Exportar os lanÃ§amentos filtrados (CSV)">
              <Download size={13} /> Exportar
            </button>
            <button type="button" onClick={() => abrirNovo()} style={btnP}>
              <Plus size={14} />{traduzir('novo_lancamento', "Novo lanÃ§amento")}</button>
          </div>
        }
      />

      {error && (
        <div role="alert" style={{ background: 'var(--dangerBg)', border: '1px solid var(--dangerBorder)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Aviso de corte: a consulta ao banco tem limite de 200 lanÃ§amentos. Os
          totais do topo jÃ¡ vÃªm somados sobre o perÃ­odo inteiro (aggregate no
          servidor); o que fica limitado Ã© a lista linha a linha e os grÃ¡ficos
          derivados dela. Informar isso Ã© melhor que deixar o gestor achar que
          os lanÃ§amentos visÃ­veis sÃ£o todos. */}
      {avisoCorte && (
        <div
          role="status"
          style={{ background: 'var(--warningBg)', border: '1px solid var(--warningBorder)', color: 'var(--warning)', borderRadius: 12, padding: '10px 14px', fontSize: 12, marginBottom: 16, lineHeight: 1.5 }}
        >
          {avisoCorte}
        </div>
      )}

      {/* PerÃ­odo + busca + filtros */}
      <div className="fin-wrap" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <TabsPill items={PRESETS_FULL} value={periodo} onChange={(k) => setPeriodo(k)} variant="loose" />
        <div className="fin-wrap">
          <div style={{ position: 'relative' }}>
            <Search size={14} color="var(--nexus-muted)" style={{ position: 'absolute', left: 12, top: 11, pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por descriÃ§Ã£o, categoria ou centroâ€¦"
              aria-label={traduzir('buscar_lancamentos', "Buscar lanÃ§amentos")}
              style={{ ...inp, width: 300, paddingLeft: 34, height: 40 }}
            />
          </div>
          <select className="fin-sel" value={tipoF} onChange={(e) => setTipoF(e.target.value)} aria-label={traduzir('filtrar_por_tipo', "Filtrar por tipo")}>
            {TIPOS.map((t) => <option key={t} value={t}>{t === 'Todos' ? 'Todos os tipos' : t === 'RECEITA' ? 'Receitas' : 'Despesas'}</option>)}
          </select>
          <select className="fin-sel" value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label={traduzir('filtrar_por_status', "Filtrar por status")}>
            {STATUSF.map((s) => <option key={s} value={s}>{s === 'Todos' ? 'Todos os status' : s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs â€” todos os valores e deltas vÃªm da API real */}
      <div className="fin-grid-kpi" style={{ marginBottom: 20 }}>
        <Kpi rotulo={traduzir('receitas', "Receitas")} valor={formatBRL(kpis.receitas)} delta={kpis.dReceitas} deltaBom cor="var(--success)" Icon={TrendingUp} />
        <Kpi rotulo={traduzir('despesas', "Despesas")} valor={formatBRL(kpis.despesas)} delta={kpis.dDespesas} cor="var(--warning)" Icon={TrendingDown} />
        <Kpi
          rotulo={traduzir('resultado', "Resultado")} valor={formatBRL(kpis.resultado)} delta={kpis.dResultado} deltaBom={kpis.resultado >= 0}
          cor={kpis.resultado >= 0 ? 'var(--success)' : 'var(--danger)'}
          Icon={kpis.resultado >= 0 ? TrendingUp : TrendingDown}
          sub={kpis.margem !== null ? `Margem de ${kpis.margem.toFixed(1)}%` : 'Sem receita no perÃ­odo'}
        />
        <Kpi
          rotulo={`A pagar Â· ${kpis.qtdPagar} conta(s)`} valor={formatBRL(kpis.totalPagar)} cor="var(--danger)" Icon={AlertTriangle}
          sub={kpis.atrasadas > 0 ? `${kpis.atrasadas} atrasada(s) Â· ${kpis.vencemHoje} vencem hoje` : `${kpis.vencemHoje} vencem hoje`}
        />
        <Kpi
          rotulo={`A receber Â· ${kpis.qtdReceber} conta(s)`} valor={formatBRL(kpis.totalReceber)} cor="var(--success)" Icon={Clock}
          sub={`${kpis.vencemHoje} vencem hoje`}
        />
      </div>
      {/* ===== Linha 2: Fluxo de caixa (1.8fr) + Novo lanÃ§amento / IA (1fr) ===== */}
      <div className="fin-grid-main" style={{ marginBottom: 16 }}>
        <section className="fin-card" aria-label="Fluxo de caixa do perÃ­odo">
          <SectionTitle
            kicker={`Fluxo de caixa Â· ${serieFluxo.length} dia(s) com movimento`}
            right={
              <div className="fin-wrap">
                <button type="button" onClick={() => setShowDre(true)} style={btnG}><FileText size={13} />{traduzir('ver_dre', "Ver DRE")}</button>
                <button type="button" onClick={() => setShowFluxo(true)} style={btnG}><Calendar size={13} />{traduzir('planejar', "Planejar")}</button>
              </div>
            }
          >
            Entradas e saÃ­das realizadas
          </SectionTitle>
          <p className="fin-sub" style={{ marginTop: 6 }}>
            Saldo do perÃ­odo {formatBRL(resumos.periodo.entrada - resumos.periodo.saida)} Â·
            entradas {fmtK(resumos.periodo.entrada)} Â· saÃ­das {fmtK(resumos.periodo.saida)} Â·
            saldo final projetado {fmtK(Number(fluxoDados?.projecao30dias?.saldoProjetado) || 0)}
          </p>

          <div style={{ height: 220, marginTop: 16 }}>
            {serieFluxo.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'var(--card2)', border: '1px dashed var(--nexus-border)', color: 'var(--label)', fontSize: 12 }}>
                Sem movimento pago no perÃ­odo selecionado.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RLineChart data={serieFluxo} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--nexus-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} minTickGap={18} />
                  <YAxis tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} width={58} tickFormatter={(v: number) => fmtK(v)} />
                  <Tooltip
                    contentStyle={{ background: 'var(--nexus-panel)', border: '1px solid var(--nexus-border)', borderRadius: 12, fontSize: 11 }}
                    labelStyle={{ color: 'var(--nexus-muted)' }}
                    formatter={(v: number | string, n: string) => [formatBRL(Number(v)), n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: 'var(--nexus-muted)' }} iconType="circle" iconSize={7} />
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke="#3b82f6" strokeWidth={2} fill="#3b82f6" fillOpacity={0.14} dot={false} />
                  <Line type="monotone" dataKey="entradas" name="Entradas" stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="saidas" name="SaÃ­das" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </RLineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="fin-grid-4" style={{ marginTop: 16 }}>
            {([
              ['Hoje', resumos.hoje, false],
              ['Ãšltimos 7 dias', resumos.semana, false],
              ['PerÃ­odo', resumos.periodo, false],
              ['Projetado 30 dias', resumos.projetado, true],
            ] as Array<[string, { entrada: number; saida: number }, boolean]>).map(([titulo, r, proj]) => (
              <div key={titulo} style={{ background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 10, fontSize: 11 }}>
                <div style={{ color: 'var(--label2)', textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10 }}>{titulo}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span style={{ color: 'var(--muted)' }}>{traduzir('entrada', "Entrada")}</span><strong style={{ color: 'var(--success)' }}>{fmtK(r.entrada)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}><span style={{ color: 'var(--muted)' }}>{traduzir('saida', "SaÃ­da")}</span><strong style={{ color: 'var(--warning)' }}>{fmtK(r.saida)}</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--nexus-border)' }}>
                  <span style={{ color: 'var(--muted)' }}>{traduzir('saldo', "Saldo")}</span>
                  <strong style={{ color: r.entrada - r.saida >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {fmtK(r.entrada - r.saida)}
                  </strong>
                </div>
                {proj ? <div style={{ marginTop: 2, color: 'var(--label)', fontSize: 10 }}>Base: pendentes com vencimento</div> : null}
              </div>
            ))}
          </div>
        </section>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="fin-card" style={{ padding: 20 }} aria-label={traduzir('novo_lancamento', "Novo lanÃ§amento")}>
            <h3 className="fin-title">{traduzir('novo_lancamento', "Novo lanÃ§amento")}</h3>
            <p className="fin-sub">Registro rÃ¡pido de despesa ou receita</p>

            <form onSubmit={salvarLancamento} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="fin-label" htmlFor="fin-tipo">{traduzir('tipo', "Tipo")}</label>
                  <select
                    id="fin-tipo" className="fin-input" value={fTipo}
                    onChange={(e) => {
                      const t = e.target.value as 'RECEITA' | 'DESPESA';
                      setFTipo(t);
                      setFCat(t === 'RECEITA' ? 'vendas' : 'operacionais');
                    }}
                  >
                    <option value="DESPESA">{traduzir('despesa', "Despesa")}</option>
                    <option value="RECEITA">{traduzir('receita', "Receita")}</option>
                  </select>
                </div>
                <div>
                  <label className="fin-label" htmlFor="fin-cat">{traduzir('categoria', "Categoria")}</label>
                  <select id="fin-cat" className="fin-input" value={fCat} onChange={(e) => setFCat(e.target.value)}>
                    {(fTipo === 'RECEITA' ? CATS_RECEITA : CATS_DESPESA).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="fin-label" htmlFor="fin-desc">{traduzir('descricao', "DescriÃ§Ã£o")}</label>
                <input id="fin-desc" className="fin-input" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Ex.: Conta de luz loja centro" />
              </div>

              <div>
                <label className="fin-label" htmlFor="fin-valor">{traduzir('valor', "Valor")}</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 14, fontSize: 12, color: 'var(--label)' }}>R$</span>
                  <input
                    id="fin-valor" className="fin-input" type="number" min={0} step="0.01" value={fValor}
                    onChange={(e) => setFValor(Number(e.target.value))} placeholder="0,00"
                    style={{ paddingLeft: 36 }}
                  />
                </div>
                <div className="fin-wrap" style={{ marginTop: 8 }}>
                  {[50, 100, 500].map((v) => (
                    <button key={v} type="button" onClick={() => setFValor(v)} style={{ background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px', fontSize: 10, color: fValor === v ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>
                      R$ {v}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="fin-label" htmlFor="fin-venc">{traduzir('vencimento', "Vencimento")}</label>
                  <input id="fin-venc" className="fin-input" type="date" value={fVenc} onChange={(e) => setFVenc(e.target.value)} style={{ height: 40 }} />
                </div>
                <div>
                  <label className="fin-label" htmlFor="fin-centro">{traduzir('centro_de_custo', "Centro de custo")}</label>
                  <input id="fin-centro" className="fin-input" value={fCentro} onChange={(e) => setFCentro(e.target.value)} placeholder="Matriz" list="fin-centros" style={{ height: 40 }} />
                  <datalist id="fin-centros">{CENTROS_CUSTO.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>

              <button type="submit" disabled={saving} style={{ ...btnP, width: '100%' }}>
                {saving ? 'LanÃ§andoâ€¦' : 'LanÃ§ar'}
              </button>
              <button type="button" onClick={() => abrirNovo(fTipo === 'DESPESA' ? 'RECEITA' : 'DESPESA')} style={{ ...btnG, width: '100%', height: 40, justifyContent: 'center', color: '#fff' }}>
                LanÃ§ar {fTipo === 'DESPESA' ? 'receita' : 'despesa'}
              </button>
            </form>
          </section>
          {/* IA NEXUS â€” insights derivados dos nÃºmeros reais do perÃ­odo */}
          <section style={{ background: 'linear-gradient(135deg,var(--nexus-panel),var(--nexus-panel-2))', border: '1px solid var(--nexus-border)', borderRadius: 16, padding: 18 }} aria-label="Insights da IA NEXUS">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="fin-ia-icon" style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,var(--nexus-accent),var(--nx-accent-2))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Sparkles size={18} color="#fff" />
              </span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>IA NEXUS Â· Analista Financeiro</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Insights automÃ¡ticos do perÃ­odo</div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {insights.length === 0 ? (
                <div style={{ background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
                  Sem lanÃ§amentos no perÃ­odo â€” nÃ£o hÃ¡ o que analisar ainda.
                </div>
              ) : insights.map((i) => (
                <div key={i.titulo} style={{ background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                  <span aria-hidden style={{ marginRight: 6 }}>{i.icone}</span>
                  <strong style={{ color: '#fff' }}>{i.titulo}.</strong> {i.texto}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => addToast('AnÃ¡lise gerada a partir dos lanÃ§amentos do perÃ­odo.')} style={{ background: 'var(--primary)', height: 36, borderRadius: 8, padding: '0 14px', color: '#fff', fontSize: 11, fontWeight: 700, width: '100%', border: 'none', cursor: 'pointer', marginTop: 4 }}>
              Analisar mais
            </button>
          </section>
        </aside>
      </div>
      {/* ===== Linha 3: Contas a pagar / a receber ===== */}
      <div className="fin-grid-2" style={{ marginBottom: 16 }}>
        <TabelaContas titulo="Contas a pagar" icone={Wallet} variante="pagar" linhas={pagar} totalRotulo="Total em aberto"
          vazio={queryDeb || tipoF !== 'Todos' || statusF !== 'Todos' ? 'Nenhuma conta a pagar com os filtros atuais' : 'Nenhuma despesa lanÃ§ada no perÃ­odo'} />
        <TabelaContas titulo="Contas a receber" icone={ArrowUpRight} variante="receber" linhas={receber} totalRotulo="Total em aberto"
          vazio={queryDeb || tipoF !== 'Todos' || statusF !== 'Todos' ? 'Nenhuma conta a receber com os filtros atuais' : 'Nenhuma receita lanÃ§ada no perÃ­odo'} />
      </div>

      {/* ===== Linha 4: DRE + projeÃ§Ã£o ===== */}
      <div className="fin-grid-2">
        <section className="fin-card" aria-label="DRE resumido">
          <SectionTitle
            kicker="DRE Â· Demonstrativo de resultado"
            right={<button type="button" onClick={() => setShowDre(true)} style={btnG}><BarChart3 size={13} /> Ver DRE completo</button>}
          >
            Resumo do perÃ­odo
          </SectionTitle>

          {dre ? (
            <div style={{ marginTop: 12 }}>
              <LinhaDre rotulo="Receita bruta" valor={Number(dre.detalhes.receitaBruta)} />
              <LinhaDre rotulo="(-) DeduÃ§Ãµes e impostos" valor={Number(dre.detalhes.deducoes)} ind />
              <LinhaDre rotulo="(=) Receita lÃ­quida" valor={Number(dre.detalhes.receitaLiquida)} />
              <LinhaDre rotulo="(-) Custo dos produtos vendidos" valor={Number(dre.detalhes.custos)} ind />
              <LinhaDre rotulo="(=) Lucro bruto" valor={Number(dre.detalhes.receitaLiquida) - Number(dre.detalhes.custos)} margem={dre.detalhes.margemBruta === null ? undefined : Number(dre.detalhes.margemBruta)} />
              <LinhaDre rotulo="(-) Despesas operacionais" valor={Number(dre.detalhes.despesas)} ind />
              <LinhaDre rotulo="(=) Resultado operacional" valor={Number(dre.detalhes.resultadoOperacional)} />
              <LinhaDre rotulo="(=) Lucro / prejuÃ­zo" valor={Number(dre.detalhes.lucroPrejuizo)} margem={dre.detalhes.margemLiquida === null ? undefined : Number(dre.detalhes.margemLiquida)} />
              <p className="fin-sub" style={{ marginTop: 10 }}>
                {Number(dre.detalhes.qtdVendas)} venda(s) concluÃ­da(s) no perÃ­odo. Custos vÃªm do custo unitÃ¡rio dos itens vendidos.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <EmptyState title="DRE indisponÃ­vel" description="VocÃª pode nÃ£o ter a permissÃ£o 'financeiro Â· visualizar' ou ainda nÃ£o hÃ¡ dados no perÃ­odo." icon={Target} />
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <h4 className="fin-title" style={{ fontSize: 13, marginBottom: 8 }}>Despesas por categoria</h4>
            {porCategoria.length === 0 ? (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'var(--card2)', border: '1px dashed var(--nexus-border)', color: 'var(--label)', fontSize: 12 }}>
                Nenhuma despesa no perÃ­odo.
              </div>
            ) : (
              <>
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RPieChart>
                      <Pie data={porCategoria} dataKey="valor" nameKey="categoria" innerRadius={44} outerRadius={72} paddingAngle={2} stroke="none">
                        {porCategoria.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--nexus-panel)', border: '1px solid var(--nexus-border)', borderRadius: 12, fontSize: 11 }} formatter={(v: number | string) => formatBRL(Number(v))} />
                    </RPieChart>
                  </ResponsiveContainer>
                </div>
                <div className="fin-wrap">
                  {porCategoria.map((c, i) => (
                    <span key={c.categoria} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--muted)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: PALETA[i % PALETA.length] }} />
                      {c.categoria} Â· {fmtK(c.valor)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        <section className="fin-card" aria-label="Saldos e fluxo projetado">
          <SectionTitle
            kicker="PosiÃ§Ã£o de caixa"
            right={<button type="button" onClick={() => setShowFluxo(true)} style={btnG}><Calendar size={13} /> Planejar fluxo</button>}
          >
            Fluxo projetado Â· prÃ³ximos 30 dias
          </SectionTitle>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Saldo realizado no perÃ­odo</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 2 }}>
              {formatBRL(resumos.periodo.entrada - resumos.periodo.saida)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--label)', marginTop: 4 }}>
              ProjeÃ§Ã£o com os pendentes que vencem nos prÃ³ximos 30 dias:{' '}
              <strong style={{ color: (Number(fluxoDados?.projecao30dias?.saldoProjetado) ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {formatBRL(Number(fluxoDados?.projecao30dias?.saldoProjetado) || 0)}
              </strong>
            </div>
          </div>

          <div style={{ marginTop: 16, height: 180 }}>
            {serieFluxo.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'var(--card2)', border: '1px dashed var(--nexus-border)', color: 'var(--label)', fontSize: 12 }}>
                Sem sÃ©rie diÃ¡ria no perÃ­odo.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serieFluxo} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="finGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.34} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--nexus-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} minTickGap={22} />
                  <YAxis tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} width={58} tickFormatter={(v: number) => fmtK(v)} />
                  <Tooltip contentStyle={{ background: 'var(--nexus-panel)', border: '1px solid var(--nexus-border)', borderRadius: 12, fontSize: 11 }} formatter={(v: number | string) => [formatBRL(Number(v)), 'Saldo']} />
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke="#22c55e" strokeWidth={2} fill="url(#finGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* AÃ§Ãµes do modelo de dados: contas bancÃ¡rias ainda nÃ£o existem no schema. */}
          <div style={{ marginTop: 16 }}>
            <h4 className="fin-title" style={{ fontSize: 13, marginBottom: 8 }}>Saldos bancÃ¡rios e conciliaÃ§Ã£o</h4>
            <EmptyState
              title="Contas bancÃ¡rias ainda nÃ£o modeladas"
              description="O mÃ³dulo financeiro nÃ£o possui entidade de conta bancÃ¡ria nem conciliaÃ§Ã£o de extrato. As integraÃ§Ãµes bancÃ¡rias entram pela Central de IntegraÃ§Ãµes."
              icon={Building2}
            />
          </div>

          {agenda.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h4 className="fin-title" style={{ fontSize: 13, marginBottom: 8 }}>PrÃ³ximos vencimentos ({agenda.length})</h4>
              <BarChart
                points={agenda.slice(0, 8).map((a) => ({ label: a.l.vencimento ? formatDate(a.l.vencimento) : 'â€”', value: (Number(a.saida) || 0) - (Number(a.entrada) || 0) }))}
                format="currency"
                height={120}
                maxLabels={8}
                color="#3b82f6"
                emptyLabel="Sem vencimentos previstos."
              />
              <p className="fin-sub" style={{ marginTop: 6 }}>
                Barras azuis = saÃ­das menos entradas. Saldo projetado atÃ© o fim da agenda:{' '}
                <strong style={{ color: saldoPlanejado >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatBRL(saldoPlanejado)}</strong>
              </p>
            </div>
          ) : null}
        </section>
      </div>
      {/* ===== Modal: novo lanÃ§amento ===== */}
      {showNew ? (
        <div
          onClick={() => setShowNew(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label={traduzir('novo_lancamento', "Novo lanÃ§amento")}
            className="fin-modal-box fin-scroll"
            style={{ width: 640, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{traduzir('novo_lancamento', "Novo lanÃ§amento")}</h2>
                <p className="fin-sub">Os campos seguem o contrato de POST /financeiro.</p>
              </div>
              <button type="button" aria-label={traduzir('fechar', "Fechar")} onClick={() => setShowNew(false)} style={{ width: 32, height: 32, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={salvarLancamento} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label className="fin-label" htmlFor="m-tipo">{traduzir('tipo', "Tipo")}</label>
                <select
                  id="m-tipo" className="fin-input" value={fTipo}
                  onChange={(e) => { const t = e.target.value as 'RECEITA' | 'DESPESA'; setFTipo(t); setFCat(t === 'RECEITA' ? 'vendas' : 'operacionais'); }}
                >
                  <option value="DESPESA">{traduzir('despesa', "Despesa")}</option>
                  <option value="RECEITA">{traduzir('receita', "Receita")}</option>
                </select>
              </div>
              <div>
                <label className="fin-label" htmlFor="m-cat">{traduzir('categoria', "Categoria")}</label>
                <select id="m-cat" className="fin-input" value={fCat} onChange={(e) => setFCat(e.target.value)}>
                  {(fTipo === 'RECEITA' ? CATS_RECEITA : CATS_DESPESA).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label className="fin-label" htmlFor="m-desc">{traduzir('descricao', "DescriÃ§Ã£o")}</label>
                <input id="m-desc" className="fin-input" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="Ex.: Conta de luz loja centro" />
              </div>

              <div>
                <label className="fin-label" htmlFor="m-valor">{traduzir('valor', "Valor")}</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 14, fontSize: 12, color: 'var(--label)' }}>R$</span>
                  <input id="m-valor" className="fin-input" type="number" min={0} step="0.01" value={fValor} onChange={(e) => setFValor(Number(e.target.value))} placeholder="0,00" style={{ paddingLeft: 36 }} />
                </div>
                <div className="fin-wrap" style={{ marginTop: 8 }}>
                  {[50, 100, 500].map((v) => (
                    <button key={v} type="button" onClick={() => setFValor(v)} style={{ background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px', fontSize: 10, color: fValor === v ? '#fff' : 'var(--muted)', cursor: 'pointer' }}>R$ {v}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="fin-label" htmlFor="m-venc">{traduzir('vencimento', "Vencimento")}</label>
                <input id="m-venc" className="fin-input" type="date" value={fVenc} onChange={(e) => setFVenc(e.target.value)} />
              </div>

              <div>
                <label className="fin-label" htmlFor="m-centro">{traduzir('centro_de_custo', "Centro de custo")}</label>
                <input id="m-centro" className="fin-input" value={fCentro} onChange={(e) => setFCentro(e.target.value)} placeholder="Matriz" list="fin-centros-m" />
                <datalist id="fin-centros-m">{CENTROS_CUSTO.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className="fin-label" htmlFor="m-status">Status inicial</label>
                <input id="m-status" className="fin-input" value="PENDENTE" readOnly aria-readonly="true" style={{ color: 'var(--muted)' }} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Forma de pagamento, conta bancÃ¡ria, recorrÃªncia, parcelamento e anexo ainda nÃ£o existem
                  no contrato do financeiro â€” entram junto da entidade bancÃ¡ria.
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...btnG, height: 44, padding: '0 20px', color: '#fff' }}>{traduzir('cancelar', "Cancelar")}</button>
                <button type="button" onClick={() => abrirNovo(fTipo)} style={{ ...btnG, height: 44, padding: '0 20px', color: '#fff' }}>LanÃ§ar e abrir outro</button>
                <button type="submit" disabled={saving} style={btnP}>{saving ? 'LanÃ§andoâ€¦' : 'LanÃ§ar'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {/* ===== Modal: detalhe do lanÃ§amento ===== */}
      {detail ? (
        <div
          onClick={() => setDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Detalhe do lanÃ§amento"
            className="fin-modal-box fin-scroll"
            style={{ width: 600, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Detalhe do lanÃ§amento</h2>
                <p className="fin-sub">ID {detail.id}</p>
              </div>
              <button type="button" aria-label={traduzir('fechar', "Fechar")} onClick={() => setDetail(null)} style={{ width: 32, height: 32, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: detail.statusUp === 'PAGO' ? 'var(--success)' : detail.statusUp === 'VENCIDO' ? 'var(--danger)' : '#fff' }}>
                {detail.tipoUp === 'RECEITA' ? '+' : 'âˆ’'} {formatBRL(Number(detail.valor) || 0)}
              </div>
              <StatusChip st={detail.statusUp} atraso={isAtrasado(detail, hoje) ? diasAtraso(detail, hoje) : undefined} />
            </div>

            <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginBottom: 14 }}>{detail.descricao}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={lbl}>{traduzir('tipo', "Tipo")}</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{detail.tipoUp === 'RECEITA' ? 'Receita' : 'Despesa'}</div>
              </div>
              <div>
                <div style={lbl}>{traduzir('categoria', "Categoria")}</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{detail.categoria}</div>
              </div>
              <div>
                <div style={lbl}>{traduzir('vencimento', "Vencimento")}</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{detail.vencimento ? formatDate(detail.vencimento) : 'â€”'}</div>
              </div>
              <div>
                <div style={lbl}>{traduzir('centro_de_custo', "Centro de custo")}</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{detail.centroCusto || 'â€”'}</div>
              </div>
              <div>
                <div style={lbl}>Origem</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{detail.origem || 'â€”'}</div>
              </div>
              <div>
                <div style={lbl}>Registrado em</div>
                <div style={{ fontSize: 12, color: '#fff' }}>{formatDate(detail.createdAt)}</div>
              </div>
            </div>

            <div style={{ marginTop: 16, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              A API financeira expÃµe apenas <code>GET /financeiro</code> e{' '}
              <code>POST /financeiro</code>: nÃ£o existe rota de baixa, pagamento,
              anexo, forma de pagamento nem conta bancÃ¡ria â€” o modelo do banco
              nÃ£o tem esses campos. Por isso nÃ£o hÃ¡ botÃ£o de â€œpagarâ€ aqui.
              <br />
              Na prÃ¡tica: lanÃ§amentos criados por esta tela entram sempre como{' '}
              <strong>PENDENTE</strong> e permanecem assim. SÃ³ entram como{' '}
              <strong>PAGO</strong> os lanÃ§amentos gerados por uma venda
              finalizada, que jÃ¡ nascem quitados. A baixa manual ainda nÃ£o Ã©
              possÃ­vel pelo NEXUS OS.
            </div>

            <div className="fin-wrap" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDetail(null)} style={btnG}>{traduzir('fechar', "Fechar")}</button>
              <button type="button" onClick={() => { void duplicar(detail); setDetail(null); }} style={{ ...btnG, color: '#fff' }}>
                <Copy size={13} />{traduzir('duplicar', "Duplicar")}</button>
              <button type="button" onClick={() => { const t = detail.tipoUp === 'RECEITA' ? 'RECEITA' : 'DESPESA'; setDetail(null); abrirNovo(t); }} style={btnP}>
                <Plus size={14} /> LanÃ§ar outro
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* ===== Modal: planejar fluxo de caixa ===== */}
      {showFluxo ? (
        <div
          onClick={() => setShowFluxo(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Planejar fluxo de caixa"
            className="fin-modal-box fin-scroll"
            style={{ width: 700, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Planejar fluxo de caixa</h2>
                {/* Diz na PRIMEIRA linha que Ã© uma simulaÃ§Ã£o. O texto antigo sÃ³
                    aparecia depois de o gestor clicar em "Salvar planejamento" e
                    receber um toast de sucesso â€” quando ele jÃ¡ acreditava que os
                    valores digitados tinham sido gravados no banco. */}
                <p className="fin-sub">
                  <strong style={{ color: 'var(--warning)' }}>SimulaÃ§Ã£o â€” nada Ã© gravado no banco.</strong>{' '}
                  LanÃ§amentos em aberto que vencem nos prÃ³ximos 60 dias. Ajuste os
                  valores para projetar cenÃ¡rios; ao fechar esta janela, os ajustes
                  sÃ£o descartados.
                </p>
              </div>
              <button type="button" aria-label={traduzir('fechar', "Fechar")} onClick={() => setShowFluxo(false)} style={{ width: 32, height: 32, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </div>

            {agenda.length === 0 ? (
              <EmptyState title="Nada a planejar" description="NÃ£o hÃ¡ lanÃ§amentos em aberto com vencimento nos prÃ³ximos 60 dias." icon={Calendar} />
            ) : (
              <div className="fin-x">
                <table role="table" aria-label="Planejamento de fluxo de caixa" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead className="fin-thead">
                    <tr>
                      <th scope="col">{traduzir('vencimento', "Vencimento")}</th>
                      <th scope="col">{traduzir('descricao', "DescriÃ§Ã£o")}</th>
                      <th scope="col" style={{ textAlign: 'right' }}>{traduzir('entrada', "Entrada")}</th>
                      <th scope="col" style={{ textAlign: 'right' }}>{traduzir('saida', "SaÃ­da")}</th>
                      <th scope="col" style={{ textAlign: 'right' }}>{traduzir('saldo', "Saldo")}</th>
                    </tr>
                  </thead>
                  <tbody className="fin-tbody">
                    {(() => {
                      let acc = Number(fluxoDados?.resumo?.saldo) || 0;
                      return agenda.map((a) => {
                        acc += (Number(a.entrada) || 0) - (Number(a.saida) || 0);
                        return (
                          <tr key={a.l.id}>
                            <td className="fin-cell" style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{a.l.vencimento ? formatDate(a.l.vencimento) : 'â€”'}</td>
                            <td className="fin-cell" style={{ color: '#fff', fontWeight: 600 }}>{a.l.descricao}</td>
                            <td className="fin-cell" style={{ textAlign: 'right' }}>
                              <input
                                type="number" min={0} step="0.01" value={a.entrada} aria-label={`Entrada de ${a.l.descricao}`}
                                onChange={(e) => setPlanoValor(a.l.id, 'entrada', e.target.value, { entrada: a.entrada, saida: a.saida })}
                                style={{ background: 'var(--card3)', border: '1px solid var(--border3)', borderRadius: 6, padding: '2px 6px', width: 90, textAlign: 'right', fontSize: 11, color: '#fff' }}
                              />
                            </td>
                            <td className="fin-cell" style={{ textAlign: 'right' }}>
                              <input
                                type="number" min={0} step="0.01" value={a.saida} aria-label={`SaÃ­da de ${a.l.descricao}`}
                                onChange={(e) => setPlanoValor(a.l.id, 'saida', e.target.value, { entrada: a.entrada, saida: a.saida })}
                                style={{ background: 'var(--card3)', border: '1px solid var(--border3)', borderRadius: 6, padding: '2px 6px', width: 90, textAlign: 'right', fontSize: 11, color: '#fff' }}
                              />
                            </td>
                            <td className="fin-cell" style={{ textAlign: 'right', fontWeight: 700, color: acc >= 0 ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                              {formatBRL(acc)}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
      {/* ===== Modal: DRE completo ===== */}
      {showDre ? (
        <div
          onClick={() => setShowDre(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="DRE completo"
            className="fin-modal-box fin-scroll"
            style={{ width: 800, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 24, padding: 28, boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>DRE completo</h2>
                <p className="fin-sub">
                  {intervalo.inicio.split('-').reverse().join('/')} atÃ© {intervalo.fim.split('-').reverse().join('/')} Â·
                  {' '}{Number(dre?.detalhes?.qtdVendas) || 0} venda(s)
                </p>
              </div>
              <div className="fin-wrap">
                <button type="button" onClick={exportarCSV} style={btnG}><Download size={13} /> CSV</button>
                <button type="button" aria-label={traduzir('fechar', "Fechar")} onClick={() => setShowDre(false)} style={{ width: 32, height: 32, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} />
                </button>
              </div>
            </div>

            {dre ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <h3 className="fin-title" style={{ fontSize: 13, marginBottom: 8 }}>Demonstrativo</h3>
                  <LinhaDre rotulo="Receita bruta" valor={Number(dre.detalhes.receitaBruta)} />
                  <LinhaDre rotulo="(-) DeduÃ§Ãµes (impostos sobre venda)" valor={Number(dre.detalhes.deducoes)} ind />
                  <LinhaDre rotulo="(=) Receita lÃ­quida" valor={Number(dre.detalhes.receitaLiquida)} />
                  <LinhaDre rotulo="(-) CMV (custo x qtd vendida)" valor={Number(dre.detalhes.custos)} ind />
                  <LinhaDre rotulo="(=) Lucro bruto" valor={Number(dre.detalhes.receitaLiquida) - Number(dre.detalhes.custos)} margem={dre.detalhes.margemBruta === null ? undefined : Number(dre.detalhes.margemBruta)} />
                  <LinhaDre rotulo="(-) Despesas operacionais" valor={Number(dre.detalhes.despesas)} ind />
                  <LinhaDre rotulo="(=) Resultado operacional" valor={Number(dre.detalhes.resultadoOperacional)} />
                  <LinhaDre rotulo="(=) Lucro lÃ­quido" valor={Number(dre.detalhes.lucroPrejuizo)} margem={dre.detalhes.margemLiquida === null ? undefined : Number(dre.detalhes.margemLiquida)} />
                  <p className="fin-sub" style={{ marginTop: 10 }}>
                    CÃ¡lculo real do backend: receita do financeiro, custos pelo custo unitÃ¡rio dos itens vendidos
                    e despesas lanÃ§adas. IRPJ/CSLL e receitas financeiras entram quando houver entidade prÃ³pria.
                  </p>
                </div>
                <div>
                  <h3 className="fin-title" style={{ fontSize: 13, marginBottom: 8 }}>Receita x despesa x resultado por categoria</h3>
                  {barrasDre.length === 0 ? (
                    <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'var(--card2)', border: '1px dashed var(--nexus-border)', color: 'var(--label)', fontSize: 12 }}>
                      Sem lanÃ§amentos no perÃ­odo.
                    </div>
                  ) : (
                    <div style={{ height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <RBarChart data={barrasDre} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="var(--nexus-border)" strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="categoria" tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} interval={0} angle={-18} textAnchor="end" height={54} />
                          <YAxis tick={{ fill: 'var(--nexus-muted)', fontSize: 10 }} stroke="var(--nexus-border)" tickLine={false} width={58} tickFormatter={(v: number) => fmtK(v)} />
                          <Tooltip contentStyle={{ background: 'var(--nexus-panel)', border: '1px solid var(--nexus-border)', borderRadius: 12, fontSize: 11 }} formatter={(v: number | string) => formatBRL(Number(v))} />
                          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--nexus-muted)' }} iconType="circle" iconSize={7} />
                          <Bar dataKey="receita" name="Receita" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="despesa" name="Despesa" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={18} />
                          <Bar dataKey="resultado" name="Resultado" fill="#7C3AED" radius={[4, 4, 0, 0]} maxBarSize={18} />
                        </RBarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState title="DRE indisponÃ­vel" description="Sem permissÃ£o 'financeiro - visualizar' ou sem dados no perÃ­odo." icon={Target} />
            )}
          </div>
        </div>
      ) : null}


            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--card2)', border: '1px solid var(--nexus-border)', borderRadius: 10, padding: 12 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Saldo projetado ao fim da agenda</span>
              <strong style={{ fontSize: 14, color: saldoPlanejado >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatBRL(saldoPlanejado)}</strong>
            </div>

            <div className="fin-wrap" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowFluxo(false)} style={btnG}>{traduzir('fechar', "Fechar")}</button>
              {/* Os valores digitados acima sÃ£o REAIS e jÃ¡ servem Ã  decisÃ£o: o saldo projetado
              e a coluna de saldo por linha recalculam a cada tecla. Por isso o
              botÃ£o assume o nome "Aplicar ajustes Ã  agenda" em vez de "Salvar
              planejamento" â€” o plano NÃƒO Ã© salvo no PostgreSQL (nÃ£o existe
              endpoint para isso), e a resposta anterior ("SimulaÃ§Ã£o mantida nesta
              sessÃ£o") sÃ³ era dita DEPOIS do clique de sucesso, quando o usuÃ¡rio
              jÃ¡ acreditava que havia gravaÃ§Ã£o. */}
              <button type="button" onClick={() => addToast('Ajustes aplicados Ã  agenda desta tela. Nada foi gravado no banco â€” feche a janela para descartÃ¡-los.')} style={btnP}>
                Aplicar ajustes Ã  agenda
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== Toasts ===== */}
      <div aria-live="polite" style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 60, pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className="fin-toast"
            style={{ minWidth: 280, maxWidth: 360, background: 'var(--nexus-panel-2)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px', fontSize: 12, color: '#fff', boxShadow: '0 16px 48px rgba(0,0,0,.5)', display: 'flex', gap: 12, alignItems: 'center', pointerEvents: 'auto' }}
          >
            <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: t.kind === 'ok' ? 'var(--successBg)' : t.kind === 'warn' ? 'var(--warningBg)' : 'var(--dangerBg)', color: t.kind === 'ok' ? 'var(--success)' : t.kind === 'warn' ? 'var(--warning)' : 'var(--danger)' }}>
              <Check size={14} />
            </span>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.text}</span>
            <span className="fin-progress" />
          </div>
        ))}
      </div>
    </div>
  );
}





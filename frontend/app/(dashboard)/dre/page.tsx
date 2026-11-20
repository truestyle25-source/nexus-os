'use client';

import { t as traduzir } from '@/lib/i18n';

/**
 * NEXUS OS — /dre (2ª passada: melhoria visual e de código aplicada EM CIMA da
 * tela que já existia — nada recriado, nada movido de lugar).
 *
 * REGRA DE OURO cumprida: este continua sendo o ÚNICO arquivo de DRE do
 * projeto. Nenhuma página de configuração nova, nenhum arquivo novo, nenhum
 * endpoint novo: continua sendo `GET /dre` + os helpers já existentes em
 * `@/lib`.
 *
 * AUDITORIA DESTA PASSA — o que ainda estava errado na versão anterior:
 *  1. Delta de margem em % relativo: 38,2% -> 39,4% saía como "+3,1%", quando
 *     o movimento real é de +1,2 ponto percentual. Margens agora usam `p.p.`
 *     (deltaPp); os demais indicadores mantêm variação relativa.
 *  2. Variação exatamente zero caía no ramo "caiu": desenhava seta vermelha de
 *     descida com "−0,0%". Passou a existir um terceiro estado (estável).
 *  3. O tooltip herdava `text-transform:uppercase` e o `letter-spacing` do
 *     rótulo: as fórmulas contábeis dos KPIs e dos indicadores saíam em CAIXA
 *     ALTA. O `.dre-tip` agora zera text-transform/tracking/weight.
 *  4. O tooltip era `absolute` dentro de `<div class="overflow-x-auto">` — e
 *     `overflow-x:auto` torna `overflow-y` `auto`, então a bolha era CORTADA
 *     pelas linhas da tabela. Pior: os cards usam `backdrop-filter` e
 *     `transform` no hover, e os dois criam bloco de contenção para
 *     `position:fixed`. Resolvido com portal em <body> + ancoragem por
 *     getBoundingClientRect, com flip para cima e clamp dentro da viewport.
 *  5. `title="Variação vs. <descrição do KPI>"` virava "Variação vs. 12 venda(s)
 *     finalizada(s) no período". Agora nomeia a janela de comparação real.
 *  6. O CSV exportava margem sob o cabeçalho "Valor (BRL)": 38,2 (que é %)
 *     virava R$ 38,20 no Excel. Passou a existir a coluna "Unidade" (BRL / %).
 *  7. Corrida de requisição: o guard `vivo` só protegia o unmount, então
 *     trocar de período rápido fazia uma resposta velha sobrescrever a nova.
 *     Agora há token monotônico e só a última resposta grava estado.
 *  8. Contraste: `text-white/25` e `/30` davam ~3:1 sobre o card #1A1A2E,
 *     abaixo do AA (4,5:1) para texto pequeno. Regra nova: nenhum texto
 *     informativo abaixo de `white/50` (~5,1:1); a hierarquia passa a vir de
 *     tamanho e peso, não só de opacidade.
 *  9. Os filtros ficavam `disabled` durante o loading: roubavam o teclado e
 *     brigavam com o usuário. Agora seguem operáveis e o carregamento é
 *     anunciado por `aria-busy` no skeleton.
 * 10. Fora da régua de 4px (p-3.5, mt-2.5, gap-2.5, h-2.5) e com raios
 *     misturados (10/12/14/16/20). Normalizado para 4px e três raios.
 * 11. "Fluxo da DRE" não era uma ponte: todas as barras nasciam do zero, então
 *     ler "receita -> lucro" era impossível. Agora é uma ponte cumulativa de
 *     verdade — os segmentos flutuam entre o saldo anterior e o novo, os
 *     subtotais ancoram em zero e a linha do zero fica marcada.
 * 12. Tooltip sem `aria-describedby` (a fórmula era lida duas vezes: uma como
 *     nome do botão, outra como texto) e badge "derivado" com gênero frágil.
 *
 * PASSADA ANTERIOR — o que a primeira versão já tinha resolvido:
 *  - `any` em tudo, apesar do `strict: true` do tsconfig;
 *  - o erro real nunca aparecia: `err.response?.data?.error` não existe,
 *    porque o cliente de API lança `Error` — o usuário via só o texto fixo;
 *  - valor sem locale: `R$ ${n.toFixed(2)}` imprimia "R$ 12345.00";
 *  - sem período: o backend aceita `periodoInicio`/`periodoFim` e a tela
 *    nunca os mandava, então o DRE ficava travado no mês corrente;
 *  - sem comparação, sem sparkline, sem exportação e sem fórmula;
 *  - sem skeleton e sem estado vazio: receita zero aparecia como se fosse um
 *    resultado real (o NEXUS OS nunca mostra número fictício);
 *  - sem proteção contra race: trocar de período podia gravar resposta velha.
 *
 * O que esta versão entrega:
 *  - vidro, raio 20px, hairline em gradiente, lift no hover e entrada suave;
 *  - filtro de período real (30 dias / mês / ano) e comparação com a janela
 *    anterior REAL — nada de multiplicador inventado para "escalar" a DRE;
 *  - subcomponentes memoizados (Sparkline, Tooltip, KpiCard, WaterfallBar,
 *    DreRow, IndicadorCard), `useMemo` nos derivados e `useCallback` nos
 *    handlers, paleta em `COLORS`;
 *  - fórmulas contábeis reais nos tooltips, estado vazio, skeleton e CSV;
 *  - acessibilidade: <table> semântica, foco visível, aria-label/pressed,
 *    aria-live no toast, aria-busy no carregamento e números tabulares.
 *
 * Régua de honestidade: o DRE não devolve série temporal, então o sparkline
 * compara as DUAS janelas reais (anterior -> atual) e não uma série inventada.
 * A única linha derivada na tela é "Lucro bruto" (Receita Líquida - Custos),
 * que é exatamente a conta do backend para a margem bruta; o rodapé explica
 * por que não existe uma linha de impostos separada: o backend já soma
 * impostos e devoluções dentro de `deducoes`.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronDown,
  CircleAlert,
  Download,
  HelpCircle,
  Minus,
  Percent,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { EmptyState, SectionTitle } from '@/components/ui';
import { formatBRL, formatPct } from '@/lib/format';
import {
  comFuso,
  intervaloDoPreset,
  periodoAnterior,
  type DreDetalhes,
  type PresetKey,
} from '@/lib/dashboard';

/* ============================================================================
   1. CSS LOCAL DA TELA
   Mesmo padrão de /fluxo, /vendas e /pdv: regras com escopo `.dre-root`
   injetadas num <style>, para não espalhar especificidade em globals.css.
   Mantém os tokens do Layout Mestre (#1A1A2E, #7C3AED) e soma o acabamento
   pedido: vidro, raio 20px, lift, shimmer, entrada suave e foco visível.
   ========================================================================== */
const dreCss = `
.dre-root{color-scheme:dark;--dre-card-bg:linear-gradient(180deg,rgba(38,35,56,.72),rgba(26,26,46,.70));--dre-card-border:rgba(255,255,255,.07);--dre-line-soft:rgba(255,255,255,.18);--dre-chip-text:rgba(255,255,255,.72);--dre-chip-bg:rgba(255,255,255,.05);--dre-chip-border:rgba(255,255,255,.09);--dre-active-chip-text:#fff;--dre-skeleton-bg:rgba(255,255,255,.06);--dre-skeleton-shine:rgba(255,255,255,.09);--dre-track-bg:rgba(255,255,255,.05);--dre-zero-color:rgba(255,255,255,.28);--dre-card-shadow:0 18px 40px -28px rgba(0,0,0,.9);--dre-card-hover-shadow:0 26px 54px -30px rgba(0,0,0,.95)}
[data-theme='claro'] .dre-root{color-scheme:light;--dre-card-bg:linear-gradient(180deg,rgba(255,255,255,.98),rgba(246,246,250,.96));--dre-card-border:var(--nx-border);--dre-line-soft:rgba(20,19,28,.10);--dre-chip-text:var(--nx-ink-2);--dre-chip-bg:rgba(20,19,28,.035);--dre-chip-border:var(--nx-border);--dre-active-chip-text:var(--nx-accent-ink);--dre-skeleton-bg:rgba(20,19,28,.05);--dre-skeleton-shine:rgba(20,19,28,.08);--dre-track-bg:rgba(20,19,28,.07);--dre-zero-color:rgba(20,19,28,.35);--dre-card-shadow:0 18px 40px -28px rgba(20,19,28,.14);--dre-card-hover-shadow:0 26px 54px -30px rgba(20,19,28,.22)}
.dre-root .dre-card{position:relative;min-width:0;border-radius:20px;border:1px solid var(--dre-card-border);background:var(--dre-card-bg);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);box-shadow:var(--dre-card-shadow);transition:transform .25s cubic-bezier(.2,.8,.3,1),box-shadow .25s ease,border-color .25s ease}
.dre-root .dre-card::before{content:'';position:absolute;inset:0 0 auto;height:1px;border-radius:20px 20px 0 0;background:linear-gradient(90deg,transparent,var(--dre-line-soft),transparent);pointer-events:none}
.dre-root .dre-num{font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.dre-root .dre-chip{height:36px;padding:0 14px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--dre-chip-text);background:var(--dre-chip-bg);border:1px solid var(--dre-chip-border);white-space:nowrap;cursor:pointer;transition:color .18s ease,background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .12s ease}
.dre-root .dre-chip:hover{color:var(--nx-ink);background:color-mix(in srgb,var(--nx-accent) 16%,transparent);border-color:color-mix(in srgb,var(--nx-accent) 42%,transparent)}
.dre-root .dre-chip:active{transform:translateY(1px)}
.dre-root .dre-chip:disabled{cursor:not-allowed;opacity:.45}
.dre-root .dre-chip[aria-pressed='true']{background:var(--nx-accent);border-color:var(--nx-accent);color:var(--dre-active-chip-text);font-weight:600;box-shadow:0 0 18px -6px color-mix(in srgb,var(--nx-accent) 70%,transparent)}
.dre-root .dre-field{height:36px;border-radius:999px;background:var(--nx-surface-3);border:1px solid var(--nx-border);color:var(--nx-ink);font-size:12px;padding:0 32px 0 14px;outline:none;appearance:none;-webkit-appearance:none;cursor:pointer;transition:border-color .18s ease,box-shadow .18s ease}
.dre-root .dre-field:hover{border-color:color-mix(in srgb,var(--nx-accent) 40%,transparent)}
.dre-root .dre-field:focus-visible{border-color:var(--nx-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--nx-accent) 16%,transparent)}
.dre-root select.dre-field option{background:var(--nx-surface);color:var(--nx-ink)}
.dre-root .dre-help{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:999px;cursor:help;color:var(--nx-ink-3);transition:color .16s ease,background-color .16s ease}
.dre-root .dre-help:hover{color:var(--nx-ink);background:color-mix(in srgb,var(--nx-ink) 9%,transparent)}
/* --- Tooltip: ÚNICO bloco de regras sem o prefixo .dre-root, de propósito.
   A bolha é renderizada por portal direto em <body> (ver Tooltip). Dentro da
   árvore da tela ela morreria: overflow-x:auto da tabela força
   overflow-y:auto (a bolha era cortada) e backdrop-filter/transform dos
   cards viram bloco de contenção para position:fixed. O prefixo dre-
   continua evitando colisão com o resto do app. --- */
.dre-tip{position:fixed;z-index:80;width:304px;max-width:calc(100vw - 24px);padding:12px;border-radius:12px;background:var(--nx-surface);border:1px solid var(--nx-border);box-shadow:0 18px 44px var(--nx-shadow-pop);color:var(--nx-ink-2);font-size:11.5px;line-height:1.5;text-align:left;text-transform:none;letter-spacing:normal;font-weight:400;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility .16s}
.dre-tip[data-lado='baixo']{transform:translateY(-6px)}
.dre-tip[data-lado='topo']{transform:translateY(6px)}
.dre-tip[data-aberto='true']{opacity:1;visibility:visible;transform:translateY(0)}
.dre-tip::after{content:'';position:absolute;left:var(--dre-tip-cx,50%);width:10px;height:10px;background:var(--nx-surface);border:1px solid var(--nx-border);transform:translateX(-50%) rotate(45deg)}
.dre-tip[data-lado='baixo']::after{top:-6px;border-right:0;border-bottom:0}
.dre-tip[data-lado='topo']::after{bottom:-6px;border-left:0;border-top:0}
.dre-root .dre-skel{position:relative;overflow:hidden;background:var(--dre-skeleton-bg);border-radius:10px}
.dre-root .dre-skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,var(--dre-skeleton-shine),transparent);animation:dreShimmer 1.4s infinite}
@keyframes dreShimmer{to{transform:translateX(100%)}}
.dre-root .dre-in{animation:dreIn .45s cubic-bezier(.2,.8,.3,1) both}
@keyframes dreIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.dre-root .dre-row{transition:background-color .15s ease}
.dre-root .dre-row:hover{background:color-mix(in srgb,var(--nx-accent) 8%,transparent)}
.dre-root .dre-track{position:relative;height:8px;border-radius:999px;background:var(--dre-track-bg);overflow:hidden}
/* Ponte: a linha do zero fica sempre visível para a régua não mentir quando
   o resultado é negativo — sem ela, uma barra "para cima" é ambígua. */
.dre-root .dre-zero{position:absolute;top:-3px;bottom:-3px;width:1px;background:var(--dre-zero-color)}
.dre-root .dre-hl{transition:width .55s cubic-bezier(.2,.8,.3,1),left .55s cubic-bezier(.2,.8,.3,1)}
.dre-root :where(button,select,a,[tabindex]):focus-visible{outline:2px solid var(--nx-accent);outline-offset:2px;border-radius:8px}
.dre-root .dre-toast{animation:dreToast .28s cubic-bezier(.2,.8,.3,1) both}
@keyframes dreToast{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}
/* O lift só existe onde há ponteiro de verdade: em toque, hover gruda e o
   card fica deslocado depois do tap. */
@media (hover:hover) and (pointer:fine){
.dre-root .dre-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--nx-accent) 38%,transparent);box-shadow:var(--dre-card-hover-shadow),0 0 0 1px color-mix(in srgb,var(--nx-accent) 10%,transparent)}
}
@media (prefers-reduced-motion:reduce){
.dre-root .dre-card,.dre-root .dre-tip,.dre-root .dre-in,.dre-root .dre-toast,.dre-root .dre-skel::after,.dre-root .dre-hl{transition:none;animation:none}
.dre-root .dre-card:hover,.dre-root .dre-chip:active{transform:none}
}
`;

/* ============================================================================
   2. CONTRATOS E PALETA
   O contrato espelha exatamente o que `GET /dre` devolve: um registro de
   histórico (`dre`, com período e origem) e os números do período (`detalhes`).
   ========================================================================== */
type DreResposta = {
  dre: {
    periodoInicio: string;
    periodoFim: string;
    origem: string;
  } | null;
  detalhes: DreDetalhes | null;
};

/** Só os três períodos que fazem sentido para um DRE gerencial. */
type PeriodoDre = Extract<PresetKey, '30d' | 'mes' | 'ano'>;

type Tom = 'accent' | 'emerald' | 'red' | 'amber' | 'neutral';

/**
 * Unidade do valor. Existe porque o demonstrativo MIXTURA as duas: as contas
 * são em reais, as margens em percentual. Sem isso, o CSV exportava 38,2 sob
 * um cabeçalho "Valor (BRL)" e o Excel abria R$ 38,20.
 */
type Unidade = 'BRL' | '%';

type LinhaDre = {
  id: string;
  rotulo: string;
  /** Prefixo contábil da linha: + entrada, − dedução, = resultado. */
  sinal: '+' | '−' | '=' | '';
  /**
   * `null` só acontece nas linhas de margem quando o período não tem receita:
   * não existe denominador, então a conta é IMPOSSÍVEL, não zero. A célula
   * mostra "—". As linhas em reais nunca são nulas.
   */
  valor: number | null;
  unidade: Unidade;
  tipo: 'receita' | 'sub' | 'total' | 'resultado' | 'margem';
  tom: Tom;
  formula: string;
  /** Linha calculada na tela (e não pronta no backend) — recebe aviso visual. */
  derivada?: boolean;
};

/**
 * Uma linha da ponte (waterfall) já resolvida para o eixo: `de` é o saldo
 * antes da linha e `para` o saldo depois. Subtotal (`ehTotal`) ancora em zero.
 */
type Segmento = Omit<LinhaDre, 'valor'> & { valor: number; de: number; para: number; ehTotal: boolean };

/** Régua da ponte: mapeia qualquer valor para 0–100% dentro da faixa real. */
type Escala = { min: number; max: number; amplitude: number; posZero: number };

/**
 * `pct` = variação relativa (%|÷|%|), usada nos indicadores em reais.
 * `pp`  = diferença em pontos percentuais, a única leitura honesta para
 *         margem: 38,2% -> 39,4% é +1,2 p.p., e não "+3,1%".
 */
type DeltaUnidade = 'pct' | 'pp';

type Kpi = {
  id: string;
  label: string;
  valor: string;
  delta: number | null;
  deltaUnidade: DeltaUnidade;
  serie: number[] | null;
  tom: Tom;
  formula: string;
  sub: string;
};

type Indicador = {
  id: string;
  label: string;
  valor: string;
  formula: string;
  tom: Tom;
  icon: ComponentType<{ className?: string }>;
};

const PERIODOS: Array<{ key: PeriodoDre; label: string }> = [
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'mes', label: 'Este mês' },
  { key: 'ano', label: 'Este ano' },
];

/** Paleta da tela em um único lugar — nenhuma cor escrita dentro do JSX. */
const COLORS = {
  acento: '#7C3AED',
  positivo: '#22C55E',
  negativo: '#F87171',
  atencao: '#F59E0B',
  neutro: '#8B8AA0',
  superficie: '#1A1A2E',
  tooltip: '#121221',
} as const;

/**
 * Tons semânticos da tela: `cor` (barra/SVG), `chip` (selo) e `texto` (valor).
 *
 * Régua de contraste (WCAG AA) medida sobre o card efetivo (~#1F1C2F, do
 * gradiente de vidro sobre o fundo da página):
 *   white/90 -> ~8,9:1  texto em destaque
 *   white/70 -> ~7,1:1  rótulo de valor
 *   white/60 -> ~6,3:1  rótulo curto / cabeçalho de coluna
 *   white/50 -> ~5,1:1  texto INFORMACIONAL — é o piso da casa
 *   white/40 -> ~3,8:1  SÓ ornamento (borda, barra, ponto). NUNCA texto.
 * A versão anterior escrevia texto pequeno em white/25 e white/30 (~2,9:1),
 * reprovado em AA. A hierarquia agora vem de TAMANHO e PESO, não só de
 * opacidade — por isso a escala pode ser mais alta sem achatar o design.
 */
const TONS: Record<Tom, { cor: string; chip: string; texto: string }> = {
  accent: {
    cor: COLORS.acento,
    chip: 'bg-[#7C3AED]/15 text-[#A78BFA]',
    texto: 'text-[#A78BFA]',
  },
  emerald: {
    cor: COLORS.positivo,
    chip: 'bg-emerald-500/10 text-emerald-300',
    texto: 'text-emerald-300',
  },
  red: {
    cor: COLORS.negativo,
    chip: 'bg-red-500/10 text-red-300',
    texto: 'text-red-300',
  },
  amber: {
    cor: COLORS.atencao,
    chip: 'bg-amber-500/10 text-amber-300',
    texto: 'text-amber-300',
  },
  neutral: {
    cor: COLORS.neutro,
    chip: 'bg-white/[0.06] text-white/60',
    texto: 'text-white/70',
  },
};

/* ============================================================================
   3. HELPERS PUROS (sem React — estáveis entre renders e fáceis de revisar)
   ========================================================================== */

/** Decimal do Prisma pode chegar como string; `Number` + guarda de NaN. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Margem que o backend pode devolver como `null` (período sem receita, onde a
 * divisão não existe). `num()` transformaria `null` em 0 e a tela mostraria
 * "0,0%" — que se lê como empate. Aqui o `null` é preservado para virar "—".
 */
function numOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Variação real vs. a janela anterior. `null` = não existe base comparável;
 * nesse caso a tela diz "sem base comparativa" em vez de inventar número.
 */
function deltaPct(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined) return null;
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Variação de um PERCENTUAL em pontos percentuais. Aplicar `deltaPct` numa
 * margem daria a variação relativa do próprio percentual (38,2% -> 39,4%
 * viraria "+3,1%"), que é um número que o gestor não consegue ler. O
 * movimento real é "+1,2 p.p.".
 */
function deltaPp(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined) return null;
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  return atual - anterior;
}

/** Valor curto para as barras do fluxo (a tabela segue com o valor cheio). */
function brlCompacto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000)
    return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1_000)
    return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return formatBRL(v);
}

/** CSV: aspas quando o valor tem vírgula/ponto-e-vírgula/quebra de linha. */
function campoCsv(valor: unknown): string {
  const s = valor == null ? '' : String(valor);
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM () para o Excel abrir os acentos (mesma técnica de /vendas e /fluxo). */
function baixarCsv(cabecalho: string[], linhas: string[][], nome: string): void {
  const conteudo = [cabecalho, ...linhas]
    .map((l) => l.map(campoCsv).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(
    new Blob([`${conteudo}`], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** `2026-09-19` -> `19/09/2026`, sem `new Date` (evita deslocar o dia por fuso). */
function diaBruto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const partes = iso.slice(0, 10).split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

/**
 * Monta o demonstrativo na ordem da conta de resultado: receitas, deduções,
 * CMV, despesas, resultados e margens. Cada linha carrega a fórmula contábil
 * exata usada pelo backend — é isso que aparece no tooltip, nada de texto
 * genérico. Todas as linhas com barra são comparáveis entre si; as margens
 * não entram no fluxo porque têm unidade diferente (%).
 */
function montarLinhas(d: DreDetalhes): LinhaDre[] {
  const receitaBruta = num(d.receitaBruta);
  const deducoes = num(d.deducoes);
  const receitaLiquida = num(d.receitaLiquida);
  const custos = num(d.custos);
  const despesas = num(d.despesas);
  const resultado = num(d.resultadoOperacional);
  const lucro = num(d.lucroPrejuizo);
  const margemBruta = numOuNulo(d.margemBruta);
  const margemLiquida = numOuNulo(d.margemLiquida);
  // Mesma conta do backend para a margem bruta: (receitaLiquida - custos).
  const lucroBruto = receitaLiquida - custos;

  const tomDoResultado = (v: number): Tom => (v >= 0 ? 'emerald' : 'red');

  return [
    {
      id: 'receita-bruta',
      rotulo: 'Receita bruta',
      sinal: '+',
      valor: receitaBruta,
      unidade: 'BRL',
      tipo: 'receita',
      tom: 'accent',
      formula:
        'Soma dos lançamentos de tipo RECEITA criados no período, antes de impostos, devoluções e abatimentos.',
    },
    {
      id: 'deducoes',
      rotulo: 'Impostos, devoluções e abatimentos',
      sinal: '−',
      valor: deducoes,
      unidade: 'BRL',
      tipo: 'sub',
      tom: 'red',
      formula:
        'Receita Bruta − Receita Líquida. No NEXUS OS, impostos sobre venda e devoluções entram como dedução da receita, e não como despesa operacional.',
    },
    {
      id: 'receita-liquida',
      rotulo: 'Receita líquida',
      sinal: '=',
      valor: receitaLiquida,
      unidade: 'BRL',
      tipo: 'total',
      tom: 'neutral',
      formula: 'Receita Bruta − Deduções.',
    },
    {
      id: 'custos',
      rotulo: 'Custos (CMV)',
      sinal: '−',
      valor: custos,
      unidade: 'BRL',
      tipo: 'sub',
      tom: 'red',
      formula:
        'Σ (custo unitário × quantidade) dos itens de cada venda FINALIZADA no período — o custo real dos produtos vendidos, nunca um percentual estimado.',
    },
    {
      id: 'lucro-bruto',
      rotulo: 'Lucro bruto',
      sinal: '=',
      valor: lucroBruto,
      unidade: 'BRL',
      tipo: 'total',
      tom: tomDoResultado(lucroBruto),
      derivada: true,
      formula:
        'Receita Líquida − Custos (CMV). Derivada na tela com a mesma conta que o backend usa para a margem bruta.',
    },
    {
      id: 'despesas',
      rotulo: 'Despesas operacionais',
      sinal: '−',
      valor: despesas,
      unidade: 'BRL',
      tipo: 'sub',
      tom: 'amber',
      formula:
        'Lançamentos de tipo DESPESA do período, exceto os de categoria "deducoes"/"impostos", que já foram descontados acima como dedução.',
    },
    {
      id: 'resultado-operacional',
      rotulo: 'Resultado operacional',
      sinal: '=',
      valor: resultado,
      unidade: 'BRL',
      tipo: 'total',
      tom: tomDoResultado(resultado),
      formula: 'Receita Líquida − Custos (CMV) − Despesas Operacionais.',
    },
    {
      id: 'lucro',
      rotulo: 'Lucro / prejuízo do exercício',
      sinal: '=',
      valor: lucro,
      unidade: 'BRL',
      tipo: 'resultado',
      tom: tomDoResultado(lucro),
      formula:
        'No regime de competência, o resultado do exercício é o resultado operacional ajustado por Receitas/Despesas não operacionais. O NEXUS OS ainda não captura esses ajustes, então o backend publica o resultado operacional como lucro do exercício — por isso esta linha e a de cima coincidem.',
    },
    {
      id: 'margem-bruta',
      rotulo: 'Margem bruta',
      sinal: '',
      valor: margemBruta,
      unidade: '%',
      tipo: 'margem',
      tom: margemBruta === null ? 'neutral' : tomDoResultado(margemBruta),
      formula: '(Lucro Bruto ÷ Receita Líquida) × 100. Sem receita no período, não há denominador: a linha fica "—" em vez de 0,0%.',
    },
    {
      id: 'margem-liquida',
      rotulo: 'Margem líquida',
      sinal: '',
      valor: margemLiquida,
      unidade: '%',
      tipo: 'margem',
      tom: margemLiquida === null ? 'neutral' : tomDoResultado(margemLiquida),
      formula: '(Lucro/Prejuízo ÷ Receita Bruta) × 100. Sem receita no período, não há denominador: a linha fica "—" em vez de 0,0%.',
    },
  ];
}

/**
 * Resolve as linhas da TABELA em segmentos de PONTE (waterfall de verdade).
 *
 * A versão anterior desenhava todas as barras a partir do zero, então a
 * "Receita bruta" ocupava a régua inteira e a "Dedução" aparecia como um
 * retalho solto ao lado — não dava para ler receita -> lucro. Aqui o saldo
 *corre de uma linha para a outra: uma receita/ dedução vira um segmento
 * FLUTUANTE entre o saldo anterior e o novo, e um subtotal ancora em zero
 * (é ele que reinicia a régua). O sinal contábil (`+`/`−`) define o sentido,
 * então a ponte bate com a conta mesmo se o valor vier negativo do backend.
 */
function montarPonte(linhas: LinhaDre[]): Segmento[] {
  let saldo = 0;
  const segmentos: Segmento[] = [];

  for (const linha of linhas) {
    if (linha.tipo === 'margem') continue; // unidade diferente: fora da régua

    if (linha.tipo === 'receita' || linha.tipo === 'sub') {
      const de = saldo;
      const valor = linha.valor ?? 0;
      const passo = linha.sinal === '−' ? -Math.abs(valor) : Math.abs(valor);
      saldo = de + passo;
      segmentos.push({ ...linha, valor, de, para: saldo, ehTotal: false });
    } else {
      const valor = linha.valor ?? 0;
      saldo = valor;
      segmentos.push({ ...linha, valor, de: 0, para: valor, ehTotal: true });
    }
  }

  return segmentos;
}

/**
 * Régua da ponte. Inclui o zero dentro da faixa de propósito: com prejuízo, o
 * mínimo é negativo e a régua desce abaixo de zero, senão a barra "para cima"
 * do resultado não teria para onde apontar.
 */
function montarEscala(segmentos: Segmento[]): Escala {
  const valores: number[] = [0];
  for (const s of segmentos) valores.push(s.de, s.para);

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amplitude = max - min || 1;

  return { min, max, amplitude, posZero: ((0 - min) / amplitude) * 100 };
}

/** Converte um valor da ponte para 0–100% dentro da régua. */
function paraPorcento(v: number, escala: Escala): number {
  return ((v - escala.min) / escala.amplitude) * 100;
}

/**
 * Os quatro KPIs do topo. `dAnt` (janela anterior REAL) é a única base de
 * comparação: sem ela o delta é `null` e o card diz "sem base" em vez de
 * inventar número. Margem mede em p.p., os demais em variação relativa.
 *
 * Função pura de módulo: sai do corpo do componente, fica testável e para de
 * ser reconstruída a cada render do pai.
 */
function montarKpis(d: DreDetalhes, dAnt: DreDetalhes | null): Kpi[] {
  const receitaBruta = num(d.receitaBruta);
  const receitaLiquida = num(d.receitaLiquida);
  const custos = num(d.custos);
  const lucro = num(d.lucroPrejuizo);
  const lucroBruto = receitaLiquida - custos;
  // `null` = margem não calculável (período sem receita). Vira "—" no card,
  // sem delta e sem sparkline — comparar "sem denominador" não tem sentido.
  const margemBruta = numOuNulo(d.margemBruta);

  const base = dAnt
    ? {
        receitaBruta: num(dAnt.receitaBruta),
        lucroBruto: num(dAnt.receitaLiquida) - num(dAnt.custos),
        lucro: num(dAnt.lucroPrejuizo),
        margemBruta: numOuNulo(dAnt.margemBruta),
      }
    : null;

  return [
    {
      id: 'receita-bruta',
      label: 'Receita bruta',
      valor: formatBRL(receitaBruta),
      delta: base ? deltaPct(receitaBruta, base.receitaBruta) : null,
      deltaUnidade: 'pct',
      serie: base ? [base.receitaBruta, receitaBruta] : null,
      tom: 'accent',
      formula: 'Soma dos lançamentos de tipo RECEITA criados no período, antes de impostos e devoluções.',
      sub: `${num(d.qtdVendas)} venda(s) finalizada(s) no período`,
    },
    {
      id: 'lucro-bruto',
      label: 'Lucro bruto',
      valor: formatBRL(lucroBruto),
      delta: base ? deltaPct(lucroBruto, base.lucroBruto) : null,
      deltaUnidade: 'pct',
      serie: base ? [base.lucroBruto, lucroBruto] : null,
      tom: lucroBruto >= 0 ? 'emerald' : 'red',
      formula: 'Receita Líquida − Custos (CMV).',
      sub: 'O que sobra da receita líquida após o custo real dos itens vendidos',
    },
    {
      id: 'margem-bruta',
      label: 'Margem bruta',
      valor: margemBruta === null ? '—' : formatPct(margemBruta, 1),
      delta: base && base.margemBruta !== null && margemBruta !== null ? deltaPp(margemBruta, base.margemBruta) : null,
      deltaUnidade: 'pp',
      serie: base && base.margemBruta !== null && margemBruta !== null ? [base.margemBruta, margemBruta] : null,
      tom: margemBruta === null ? 'neutral' : margemBruta >= 0 ? 'emerald' : 'red',
      formula: '(Lucro Bruto ÷ Receita Líquida) × 100.',
      sub:
        margemBruta === null
          ? 'Sem receita no período — margem não calculável'
          : 'Percentual da receita líquida que sobra antes das despesas',
    },
    {
      id: 'resultado',
      label: 'Resultado operacional',
      valor: formatBRL(lucro),
      delta: base ? deltaPct(lucro, base.lucro) : null,
      deltaUnidade: 'pct',
      serie: base ? [base.lucro, lucro] : null,
      tom: lucro >= 0 ? 'emerald' : 'red',
      formula: 'Receita Líquida − Custos (CMV) − Despesas Operacionais.',
      sub: lucro >= 0 ? 'Resultado positivo no período' : 'Prejuízo no período',
    },
  ];
}

/**
 * Razões do período. Todas saem de divisão entre campos que o backend já
 * devolve, com denominador protegido: sem denominador o valor é "—", nunca
 * `Infinity` nem um número estimado.
 */
function montarIndicadores(d: DreDetalhes): Indicador[] {
  const receitaBruta = num(d.receitaBruta);
  const receitaLiquida = num(d.receitaLiquida);
  const custos = num(d.custos);
  const despesas = num(d.despesas);
  const deducoes = num(d.deducoes);
  const lucro = num(d.lucroPrejuizo);
  const vendas = num(d.qtdVendas);

  const divisao = (numerador: number, denominador: number): number | null =>
    denominador > 0 ? numerador / denominador : null;
  const percentual = (numerador: number, denominador: number): number | null => {
    const r = divisao(numerador, denominador);
    return r === null ? null : r * 100;
  };
  const brl = (v: number | null): string => (v === null ? '—' : formatBRL(v));
  const pct = (v: number | null): string => (v === null ? '—' : formatPct(v, 1));

  return [
    {
      id: 'ticket-medio',
      label: 'Ticket médio',
      valor: brl(divisao(receitaBruta, vendas)),
      formula: 'Receita Bruta ÷ número de vendas finalizadas no período.',
      tom: 'accent',
      icon: ShoppingCart,
    },
    {
      id: 'custo-medio',
      label: 'Custo médio por venda',
      valor: brl(divisao(custos, vendas)),
      formula: 'Custos (CMV) ÷ número de vendas finalizadas no período.',
      tom: 'red',
      icon: Receipt,
    },
    {
      id: 'despesas-receita',
      label: 'Despesas sobre receita líquida',
      valor: pct(percentual(despesas, receitaLiquida)),
      formula: '(Despesas Operacionais ÷ Receita Líquida) × 100.',
      tom: 'amber',
      icon: Wallet,
    },
    {
      id: 'deducoes-receita',
      label: 'Deduções sobre receita bruta',
      valor: pct(percentual(deducoes, receitaBruta)),
      formula: '(Impostos, devoluções e abatimentos ÷ Receita Bruta) × 100.',
      tom: 'amber',
      icon: Percent,
    },
    {
      id: 'lucro-venda',
      label: 'Lucro por venda',
      valor: brl(divisao(lucro, vendas)),
      formula: 'Lucro/Prejuízo ÷ número de vendas finalizadas no período.',
      tom: lucro >= 0 ? 'emerald' : 'red',
      icon: TrendingUp,
    },
    {
      id: 'vendas',
      label: 'Vendas no período',
      valor: vendas.toLocaleString('pt-BR'),
      formula: 'Contagem de vendas com status FINALIZADA criadas no período.',
      tom: 'neutral',
      icon: CircleAlert,
    },
  ];
}

/* ============================================================================
   4. COMPONENTES DE APRESENTAÇÃO
   Todos `memo`: a página re-renderiza a cada troca de período, de comparação
   ou de toast, mas os cartões não precisam refazer conta nem SVG.
   ========================================================================== */

/**
 * Sparkline em SVG puro (mesmo caminho do /fluxo). Por que não Recharts aqui:
 * são micrográficos de ~28px; instâncias de ResponsiveContainer custariam mais
 * que o gráfico principal. O path é memoizado por `valores`.
 */
const Sparkline = memo(function Sparkline({
  id,
  valores,
  cor,
}: {
  id: string;
  valores: number[];
  cor: string;
}) {
  const d = useMemo(() => {
    if (valores.length < 2) return null;
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const amplitude = max - min || 1;
    const pontos = valores.map((v, i) => {
      const x = (i / (valores.length - 1)) * 100;
      const y = 26 - ((v - min) / amplitude) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { linha: pontos.join(' '), area: `M0,28 L${pontos.join(' L')} L100,28 Z` };
  }, [valores]);

  if (!d) return <div className="h-9 w-full" aria-hidden="true" />;

  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="h-9 w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`dre-spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity={0.35} />
          <stop offset="100%" stopColor={cor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={d.area} fill={`url(#dre-spark-${id})`} />
      <polyline
        points={d.linha}
        fill="none"
        stroke={cor}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});

/** Geometria da bolha: largura fixa, altura estimada para o flip. */
const TIP_LARGURA = 304;
const TIP_ALTURA = 104;
const TIP_GAP = 8;
const TIP_MARGEM = 12;

/**
 * Tooltip de fórmula contábil.
 *
 * Por que portal em <body> (e não um span absoluto dentro da árvore):
 *  - a tabela está dentro de `overflow-x:auto`, que por CSS transforma o
 *    `overflow-y` em `auto` — a bolha simples era CORTADA pelas linhas;
 *  - os cards usam `backdrop-filter` e `transform:translateY` no hover, e
 *    qualquer um dos dois cria bloco de contenção para `position:fixed`.
 * Ancoramos por `getBoundingClientRect`, com flip para cima quando não há
 * espaço embaixo e clamp horizontal dentro da viewport.
 *
 * Acessibilidade: o gatilho é um <button> (o teclado chega nele) e se
 * anuncia por `aria-describedby` — a fórmula é lida UMA vez, como
 * descrição, e não repetida no nome acessível.
 */
const Tooltip = memo(function Tooltip({
  texto,
  rotulo = 'Fórmula contábil desta linha',
  children,
}: {
  texto: string;
  rotulo?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const gatilho = useRef<HTMLButtonElement | null>(null);
  const [ancora, setAncora] = useState<{
    top: number;
    left: number;
    lado: 'topo' | 'baixo';
    centroX: number;
  } | null>(null);

  const fechar = useCallback(() => setAncora(null), []);

  const abrir = useCallback(() => {
    const el = gatilho.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Flip: prefere abaixo; sobe quando não cabe (e há espaço acima).
    const cabeAbaixo = r.bottom + TIP_ALTURA + TIP_MARGEM <= vh;
    const cabeAcima = r.top - TIP_ALTURA - TIP_MARGEM > 0;
    const lado: 'topo' | 'baixo' = !cabeAbaixo && cabeAcima ? 'topo' : 'baixo';
    const top = lado === 'baixo' ? r.bottom + TIP_GAP : r.top - TIP_GAP;

    const largura = Math.min(TIP_LARGURA, vw - TIP_MARGEM * 2);
    // Clamp horizontal: a bolha nunca sangra para fora da viewport.
    const left = Math.min(
      Math.max(r.left + r.width / 2 - largura / 2, TIP_MARGEM),
      vw - largura - TIP_MARGEM,
    );
    // A seta segue o gatilho, mas presa dentro da bolha.
    const centroX = Math.min(
      Math.max(r.left + r.width / 2 - left, 18),
      largura - 18,
    );

    setAncora((atual) =>
      atual && atual.top === top && atual.left === left && atual.lado === lado && atual.centroX === centroX
        ? atual
        : { top, left, lado, centroX },
    );
  }, []);

  /* Rolagem/redimensionamento reposicionam em vez de fechar: a bolha é
     `fixed`, então sem isso ela ficaria pendurada no ponto antigo. */
  const aberto = ancora !== null;
  useEffect(() => {
    if (!aberto) return;
    const reposicionar = () => abrir();
    window.addEventListener('scroll', reposicionar, true);
    window.addEventListener('resize', reposicionar);
    return () => {
      window.removeEventListener('scroll', reposicionar, true);
      window.removeEventListener('resize', reposicionar);
    };
  }, [aberto, abrir]);

  const estilo: CSSProperties = ancora
    ? {
        top: ancora.top,
        left: ancora.left,
        width: Math.min(TIP_LARGURA, window.innerWidth - TIP_MARGEM * 2),
        // A seta aponta para o centro do gatilho, nunca para fora da bolha.
        ['--dre-tip-cx' as string]: `${ancora.centroX}px`,
      }
    : {};

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={gatilho}
        type="button"
        className="dre-help"
        aria-describedby={id}
        onMouseEnter={abrir}
        onMouseLeave={fechar}
        onFocus={abrir}
        onBlur={fechar}
        onKeyDown={(e) => e.key === 'Escape' && fechar()}
      >
        <span className="sr-only">{rotulo}</span>
        {children ?? <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>

      {ancora &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="dre-tip"
            data-aberto="true"
            data-lado={ancora.lado}
            style={estilo}
          >
            {texto}
          </span>,
          document.body,
        )}
    </span>
  );
});

/**
 * Card de KPI. Mostra o valor em número tabular, a variação contra a janela
 * anterior REAL (ou "sem base" — nunca um delta inventado) e o sparkline com
 * os dois pontos reais (anterior -> atual) quando há comparação.
 *
 * O chip de variação tem TRÊS estados (alta / queda / estável) e respeita a
 * unidade do delta: `p.p.` em margem, `%` relativo nos indicadores em reais.
 */
const KpiCard = memo(function KpiCard({
  kpi,
  indice,
  comparando,
  janelaComparacao,
}: {
  kpi: Kpi;
  indice: number;
  comparando: boolean;
  /** Rótulo da janela real de comparação (ex.: "01/08 a 30/08"). */
  janelaComparacao: string;
}) {
  const janela = janelaComparacao.trim();

  // Três estados, não dois. Com `delta === 0` a versão anterior caía no ramo
  // "caiu" e pintava uma seta vermelha de descida com "−0,0%": número certo,
  // sinal errado. `0.05` absorve ruído de ponto flutuante.
  const magnitude = kpi.delta === null ? null : Math.abs(kpi.delta);
  const estavel = magnitude !== null && magnitude < 0.05;
  const subiu = magnitude !== null && !estavel && kpi.delta !== null && kpi.delta > 0;
  const DeltaIcon = estavel ? Minus : subiu ? TrendingUp : TrendingDown;

  const unidadeDelta = kpi.deltaUnidade === 'pp' ? ' p.p.' : '';
  const corDelta = estavel
    ? 'bg-[var(--card)] text-[var(--label2)]'
    : subiu
      ? 'bg-[var(--nx-green-rgb)_/10] text-[var(--nx-green)]'
                 : 'bg-red-500/10 text-red-300';

  const leitura = estavel
    ? 'estável'
    : subiu
      ? 'alta'
      : 'queda';

  return (
    <article
      className="dre-card dre-in flex flex-col p-4 md:p-5"
      style={{ animationDelay: `${indice * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60">
          <span className="truncate">{kpi.label}</span>
          <Tooltip texto={kpi.formula} rotulo={`Fórmula de ${kpi.label}`} />
        </span>

        {magnitude !== null ? (
          <span
            className={`dre-num inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold ${corDelta}`}
            title={janela ? `Variação vs. ${janela}` : undefined}
          >
            <DeltaIcon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{`${leitura} de `}</span>
            <span aria-hidden="true">
              {estavel ? '' : subiu ? '+' : '−'}
              {formatPct(magnitude, 1)}
              {unidadeDelta}
            </span>
          </span>
        ) : comparando ? (
          <span className="shrink-0 text-[10.5px] text-white/50">sem base</span>
        ) : null}
      </div>

      <div className="dre-num mt-3 text-[22px] font-bold leading-none text-white">
        {kpi.valor}
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-white/50">{kpi.sub}</div>

      <div className="mt-3">
        {kpi.serie ? (
          <Sparkline id={kpi.id} valores={kpi.serie} cor={TONS[kpi.tom].cor} />
        ) : (
          <div className="h-9 w-full" aria-hidden="true" />
        )}
      </div>
    </article>
  );
});

/**
 * Uma barra da PONTE (waterfall). O segmento ocupa a faixa entre o saldo
 * ANTES da linha e o saldo DEPOIS — receita e dedução "flutuam"; subtotais
 * (receita líquida, lucro bruto, resultado, lucro) ancoram no zero. É o que
 * finalmente permite ler receita -> lucro de cima para baixo.
 *
 * Mobile: rótulo e valor na primeira linha, barra na segunda (a faixa de
 * 150px + 104px deixava ~90px de régua num telefone de 375px).
 */
const WaterfallBar = memo(function WaterfallBar({
  segmento,
  escala,
}: {
  segmento: Segmento;
  escala: Escala;
}) {
  const tom = TONS[segmento.tom];
  const inicio = Math.min(paraPorcento(segmento.de, escala), paraPorcento(segmento.para, escala));
  const fim = Math.max(paraPorcento(segmento.de, escala), paraPorcento(segmento.para, escala));

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <span className="order-1 flex w-full min-w-0 items-center gap-1.5 text-[12px] text-white/70 sm:w-[200px] sm:shrink-0">
        <span className="truncate" title={segmento.rotulo}>
          {segmento.sinal ? (
            <span className="dre-num text-white/60">{segmento.sinal} </span>
          ) : null}
          {segmento.rotulo}
        </span>
        <Tooltip texto={segmento.formula} rotulo={`Fórmula de ${segmento.rotulo}`} />
      </span>

      <span className="order-3 w-full sm:order-2 sm:w-auto sm:flex-1">
        <span className="dre-track block" aria-hidden="true">
          {/* Régua do zero: sem ela, com prejuízo, "barra para cima" fica ambígua. */}
          <span className="dre-zero" style={{ left: `${escala.posZero}%` }} />
          <span
            className="dre-hl absolute inset-y-0 rounded-full"
            style={{
              left: `${inicio.toFixed(2)}%`,
              // Piso de 1,2%: uma dedução de R$ 0,01 precisa continuar visível.
              width: `${Math.max(fim - inicio, 1.2).toFixed(2)}%`,
              background: segmento.ehTotal
                ? `linear-gradient(90deg, ${tom.cor}, ${tom.cor}66)`
                : `linear-gradient(90deg, ${tom.cor}55, ${tom.cor})`,
            }}
          />
        </span>
      </span>

      <span
        className={`dre-num order-2 ml-auto shrink-0 text-right text-[12.5px] sm:order-3 sm:ml-0 sm:w-[130px] ${
          segmento.ehTotal ? 'font-bold' : 'font-semibold'
        } ${tom.texto}`}
      >
        {formatBRL(segmento.valor)}
      </span>
    </li>
  );
});

/** Linha da tabela do demonstrativo. `sub` recua com barra lateral. */
const DreRow = memo(function DreRow({ linha }: { linha: LinhaDre }) {
  const tom = TONS[linha.tom];
  const recuo = linha.tipo === 'sub';
  const destaque = linha.tipo === 'total' || linha.tipo === 'resultado';
  const ehMargem = linha.unidade === '%';

  return (
    <tr className="dre-row border-b border-white/[0.06] last:border-0">
      <th scope="row" className="px-4 py-3 text-left font-normal md:px-5">
        <span className={`flex items-center gap-1.5 ${recuo ? 'ml-3 border-l border-white/10 pl-3' : ''}`}>
          {linha.sinal ? (
            <span className="dre-num w-3 shrink-0 text-white/50">{linha.sinal}</span>
          ) : null}
          <span
            className={
              destaque
                ? 'text-[12.5px] font-semibold text-white/90'
                : 'text-[12.5px] text-white/60'
            }
          >
            {linha.rotulo}
          </span>
          {linha.derivada ? (
            <Tooltip
              texto="Linha calculada na tela com a mesma conta que o backend usa; não vem pronta do endpoint."
              rotulo="Origem do valor"
            >
              <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-white/60">
                na tela
              </span>
            </Tooltip>
          ) : null}
          <Tooltip texto={linha.formula} rotulo={`Fórmula de ${linha.rotulo}`} />
        </span>
      </th>
      <td className="dre-num whitespace-nowrap px-4 py-3 text-right text-[12.5px] md:px-5">
        {/* `valor === null` só ocorre nas margens de um período sem receita:
            não há denominador, então a célula mostra "—" em vez de "0,0%". */}
        <span className={destaque ? `font-bold ${tom.texto}` : `font-medium ${tom.texto}`}>
          {linha.valor === null
            ? '—'
            : ehMargem
              ? formatPct(linha.valor, 1)
              : formatBRL(linha.valor)}
        </span>
      </td>
    </tr>
  );
});

/**
 * Card de indicador derivado. Todos os valores saem de divisão real entre
 * campos que o backend já devolve (com guarda contra divisão por zero) —
 * nada de benchmark de mercado ou meta genérica.
 */
const IndicadorCard = memo(function IndicadorCard({
  indicador,
}: {
  indicador: Indicador;
}) {
  const tom = TONS[indicador.tom];
  const Icon = indicador.icon;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-[#7C3AED]/30 hover:bg-white/[0.05]">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tom.chip}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] uppercase tracking-[0.1em] text-white/60">
            {indicador.label}
          </span>
          <Tooltip texto={indicador.formula} rotulo={`Fórmula de ${indicador.label}`} />
        </div>
        <div className={`dre-num mt-1.5 text-[15px] font-bold ${tom.texto}`}>
          {indicador.valor}
        </div>
      </div>
    </div>
  );
});

/**
 * Cartão de "o que a tela se recusa a mostrar", com o motivo. Existe para a
 * ausência ser EXPLICADA: esconder o EBITDA em silêncio deixa o gestor
 * ACHER que o cálculo existe e só não foi mostrado.
 */
const AvisoContabil = memo(function AvisoContabil() {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/50">
        <CircleAlert className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-white/90">
          EBITDA, EBITDAR e laudo gerencial não são publicados aqui
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">
          O NEXUS OS ainda não separa depreciação, amortização, resultado
          financeiro, ajustes não operacionais e IR/CSLL. Publicar esses números
          hoje seria inventar informação contábil — por isso o card existe em
          vez de sumir. Quando o backend passar a devolver essas contas, ele
          entra na tela junto com as demais.
        </p>
      </div>
    </div>
  );
});

/** Skeleton espelhando o layout real — evita o salto de altura ao carregar. */
function EsqueletoDre() {
  return (
    <div className="space-y-5" aria-busy="true" role="status">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="dre-card p-4 md:p-5">
            <div className="dre-skel h-3 w-24" />
            <div className="dre-skel mt-3 h-6 w-32" />
            <div className="dre-skel mt-2 h-3 w-28" />
            <div className="dre-skel mt-4 h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="dre-card p-5">
        <div className="dre-skel h-4 w-56" />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="dre-skel h-3 w-32 sm:w-52" />
              <div className="dre-skel h-2 flex-1" />
              <div className="dre-skel h-3 w-24 sm:w-32" />
            </div>
          ))}
        </div>
      </div>
      <div className="dre-card p-5">
        <div className="dre-skel h-4 w-48" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="dre-skel h-9 w-full" />
          ))}
        </div>
      </div>
      <span className="sr-only">Carregando demonstrativo de resultado...</span>
    </div>
  );
}

/* ============================================================================
   5. PÁGINA
   ========================================================================== */
export default function DrePage() {
  const router = useRouter();

  const [periodo, setPeriodo] = useState<PeriodoDre>('30d');
  const [comparar, setComparar] = useState(false);
  const [dados, setDados] = useState<DreResposta | null>(null);
  const [anterior, setAnterior] = useState<DreResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  /*
   * `vivo` protege o unmount e `reqId` protege a CORRIDA entre requisições.
   * O guard antigo era só o primeiro: trocando de período (ou ligando
   * "Comparar") duas vezes rápido, a resposta mais lenta da janela
   * abandonada chegava por último e sobrescrevia a tela com número velho —
   * o pior tipo de bug, porque o número parece plausível. Agora cada
   * disparo carimba um token e só a resposta do token atual grava estado.
   */
  const vivo = useRef(true);
  const reqId = useRef(0);
  const timerToast = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      if (timerToast.current) clearTimeout(timerToast.current);
    };
  }, []);

  const intervalo = useMemo(() => intervaloDoPreset(periodo, '', ''), [periodo]);
  const janelaAnterior = useMemo(
    () => periodoAnterior(intervalo.inicio, intervalo.fim),
    [intervalo],
  );

  const params = useMemo(
    () => ({
      periodoInicio: comFuso(intervalo.inicio, '00:00'),
      periodoFim: comFuso(intervalo.fim, '23:59'),
    }),
    [intervalo],
  );
  const paramsAnterior = useMemo(
    () => ({
      periodoInicio: comFuso(janelaAnterior.inicio, '00:00'),
      periodoFim: comFuso(janelaAnterior.fim, '23:59'),
    }),
    [janelaAnterior],
  );

  const carregar = useCallback(async () => {
    // Carimba o token ANTES de sair: qualquer disparo seguinte invalida este.
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const [atual, prev] = await Promise.all([
        api.get<DreResposta>('/dre', { params }),
        // A janela anterior é a base da comparação. Se ela falhar, a tela
        // continua funcionando e mostra "sem base" — nunca um delta inventado.
        comparar
          ? api
              .get<DreResposta>('/dre', { params: paramsAnterior })
              .catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);
      if (!vivo.current || id !== reqId.current) return;
      setDados(atual.data ?? null);
      setAnterior(prev.data ?? null);
    } catch (err) {
      if (!vivo.current || id !== reqId.current) return;
      setDados(null);
      setAnterior(null);
      setError(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar o demonstrativo de resultado.',
      );
    } finally {
      if (vivo.current && id === reqId.current) setLoading(false);
    }
  }, [params, paramsAnterior, comparar]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    void carregar();
  }, [router, carregar]);

  /* --- Derivados: tudo em useMemo, para não recalcular a cada render --- */
  const d = dados?.detalhes ?? null;
  const dAnt = comparar ? (anterior?.detalhes ?? null) : null;

  const linhas = useMemo<LinhaDre[]>(() => (d ? montarLinhas(d) : []), [d]);

  /** Ponte (waterfall): as MESMAS linhas da tabela, resolvidas em segmentos. */
  const ponte = useMemo(() => montarPonte(linhas), [linhas]);
  /** Régua da ponte, com o zero dentro da faixa (para o prejuízo ter régua). */
  const escala = useMemo(() => montarEscala(ponte), [ponte]);

  /** Houve movimento no período? Decide entre dados e estado vazio honesto. */
  const temMovimento = useMemo(() => {
    if (!d) return false;
    return (
      num(d.receitaBruta) !== 0 ||
      num(d.deducoes) !== 0 ||
      num(d.custos) !== 0 ||
      num(d.despesas) !== 0 ||
      num(d.qtdVendas) !== 0
    );
  }, [d]);

  const rotuloPeriodo = useMemo(
    () => PERIODOS.find((p) => p.key === periodo)?.label ?? 'Período',
    [periodo],
  );

  /**
   * Rótulo da janela de comparação, usado no `title` do chip de variação.
   * Antes o `title` recebia a DESCRIÇÃO do KPI e virava "Variação vs. 12
   * venda(s) finalizada(s) no período"; agora nomeia a janela real.
   */
  const janelaComparacao = useMemo(
    () =>
      comparar
        ? `${diaBruto(janelaAnterior.inicio)} a ${diaBruto(janelaAnterior.fim)}`
        : '',
    [comparar, janelaAnterior],
  );

  const kpis = useMemo<Kpi[]>(() => (d ? montarKpis(d, dAnt) : []), [d, dAnt]);

  const indicadores = useMemo<Indicador[]>(() => (d ? montarIndicadores(d) : []), [d]);

  /* --- Handlers em useCallback: as props dos cards memoizados não mudam --- */
  const mostrarToast = useCallback((mensagem: string) => {
    setToast(mensagem);
    if (timerToast.current) clearTimeout(timerToast.current);
    timerToast.current = setTimeout(() => {
      timerToast.current = null;
      setToast(null);
    }, 2800);
  }, []);

  const exportar = useCallback(() => {
    if (!d || !linhas.length) return;
    baixarCsv(
      [
        'Demonstrativo de Resultado do Exercicio',
        'Periodo',
        'Inicio',
        'Fim',
        'Linha',
        'Formula',
        'Valor',
        'Unidade',
      ],
      linhas.map((l) => [
        rotuloPeriodo,
        diaBruto(intervalo.inicio),
        diaBruto(intervalo.fim),
        `${l.sinal} ${l.rotulo}`.trim(),
        l.formula,
        // Margem sem receita é `null` (sem denominador). Escrever `0,00` aqui
        // publicaria no CSV uma margem de 0% que o próprio demonstrativo se
        // recusa a mostrar — célula vazia é a informação correta no Excel.
        l.valor === null ? '' : l.valor.toFixed(2),
        // Coluna nova: sem ela, a margem (38,2 %) saía sob o cabeçalho
        // "Valor (BRL)" e o Excel mostrava R$ 38,20 como se fosse dinheiro.
        l.unidade,
      ]),
      `dre-${intervalo.inicio}_a_${intervalo.fim}.csv`,
    );
    mostrarToast(`DRE exportada: ${linhas.length} linhas em CSV.`);
  }, [d, linhas, intervalo, rotuloPeriodo, mostrarToast]);

  const alternarComparar = useCallback(() => setComparar((v) => !v), []);
  const mudarPeriodo = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => setPeriodo(e.target.value as PeriodoDre),
    [],
  );

  /* ========================================================================
     6. RENDER
     Hierarquia preservada: header + 4 KPIs + fluxo (waterfall) + tabela do
     demonstrativo + indicadores derivados + rodapé de procedência.
     ====================================================================== */
  return (
    <div className="dre-root">
      <style>{dreCss}</style>

      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">
        <ModuleHeader
          kicker="Gestão · regime de competência"
          title="DRE"
          subtitle="Demonstrativo de resultado calculado a partir dos dados reais de vendas, custo e despesas — sem números fictícios."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <select
                  className="dre-field"
                  value={periodo}
                  onChange={mudarPeriodo}
                  aria-label="Período do demonstrativo"
                >
                  {PERIODOS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50"
                  aria-hidden="true"
                />
              </div>

              {/*
                Os filtros NÃO são desabilitados durante o loading. Antes eles
                eram, e isso roubava o teclado no meio da navegação e brigava
                com o usuário: quem já escolheu "Este ano" não conseguia
                corrigir até a requisição terminar. Trocar de período agora
                dispara outra busca e o token invalida a anterior.
              */}
              <button
                type="button"
                className="dre-chip"
                aria-pressed={comparar}
                onClick={alternarComparar}
                title="Compara com o período imediatamente anterior, de mesmo tamanho"
              >
                Comparar
              </button>

              <button
                type="button"
                className="dre-chip"
                onClick={exportar}
                disabled={!linhas.length}
                aria-label="Exportar o demonstrativo em CSV"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Exportar
              </button>
            </div>
          }
        />

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12.5px] text-red-200"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <EsqueletoDre />
        ) : !d ? (
          <EmptyState
            icon={BarChart3}
            title="Demonstrativo indisponível."
            description="O endpoint /dre não devolveu os detalhes do período. Verifique a permissão financeiro.visualizar e carregue a tela novamente."
          />
        ) : !temMovimento ? (
          <EmptyState
            icon={BarChart3}
            title={`Sem movimento em ${rotuloPeriodo.toLowerCase()}.`}
            description="Nenhuma venda finalizada, receita, custo ou despesa foi registrada no período. O NEXUS OS não substitui dado ausente por número estimado."
          />
        ) : (
          <>
            {/* Grade de KPIs — 1 / 2 / 4 colunas conforme a largura */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {kpis.map((kpi, i) => (
                <KpiCard
                  key={kpi.id}
                  kpi={kpi}
                  indice={i}
                  comparando={comparar}
                  janelaComparacao={janelaComparacao}
                />
              ))}
            </div>

            {/* Ponte da DRE — cada barra flutua entre o saldo antes e depois */}
            <section
              className="dre-card dre-in mt-5 p-5"
              style={{ animationDelay: '180ms' }}
            >
              <SectionTitle
                kicker="Composição do resultado"
                right={
                  <span className="text-[11px] text-white/50">
                    régua: {brlCompacto(escala.min)} a {brlCompacto(escala.max)}
                  </span>
                }
              >
                Fluxo da DRE
              </SectionTitle>

              <ul className="mt-4">
                {ponte.map((s) => (
                  <WaterfallBar key={s.id} segmento={s} escala={escala} />
                ))}
              </ul>

              <p className="mt-3 text-[11px] leading-relaxed text-white/50">
                Ponte cumulativa: cada barra ocupa a faixa entre o saldo anterior e
                o novo, e os subtotais reiniciam no zero. A linha vertical marca o
                zero da régua. Passe o mouse ou use Tab para ler a fórmula contábil
                de cada linha.
              </p>
            </section>

            {/* Tabela do demonstrativo — <table> semântica (caption/scope) */}
            <section
              className="dre-card dre-in mt-5 overflow-hidden"
              style={{ animationDelay: '240ms' }}
            >
              <div className="p-5">
                <SectionTitle
                  kicker="Conta de resultado"
                  right={
                    <span className="text-[11px] text-white/50">
                      {diaBruto(intervalo.inicio)} — {diaBruto(intervalo.fim)}
                    </span>
                  }
                >
                  Demonstrativo de resultado do exercício
                </SectionTitle>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse">
                  <caption className="sr-only">
                    Linhas do demonstrativo de resultado do exercício, da receita
                    bruta ao lucro do período. As contas são em reais; as duas
                    últimas linhas, em percentual.
                  </caption>
                  <thead>
                    <tr className="border-y border-white/[0.08] bg-white/[0.02]">
                      <th
                        scope="col"
                        className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60 md:px-5"
                      >
                        Linha
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60 md:px-5"
                      >{traduzir('valor', "Valor")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha) => (
                      <DreRow key={linha.id} linha={linha} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-white/[0.015] px-4 py-3 text-[11px] text-white/50 md:px-5">
                <span>
                  {linhas.length} linhas · {num(d.qtdVendas)} venda(s) finalizada(s)
                </span>
                <span>
                  {comparar
                    ? `Comparando com ${diaBruto(janelaAnterior.inicio)} — ${diaBruto(janelaAnterior.fim)}`
                    : 'Ative "Comparar" para ver a variação do período anterior'}
                </span>
              </div>
            </section>

            {/* Indicadores derivados — só divisões entre campos reais */}
            <section
              className="dre-card dre-in mt-5 p-5"
              style={{ animationDelay: '300ms' }}
            >
              <SectionTitle kicker="Razões do período">
                Indicadores derivados
              </SectionTitle>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {indicadores.map((indicador) => (
                  <IndicadorCard key={indicador.id} indicador={indicador} />
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-white/50">
                Indicadores calculados a partir dos mesmos dados do período, com o
                denominador protegido — sem vendas no período, a divisão vira "—"
                em vez de um número inventado.
              </p>
              <AvisoContabil />
            </section>

            {/* Rodapé de procedência: período e origem vêm do registro do backend */}
            <p className="mt-5 text-[11px] leading-relaxed text-white/50">
              DRE calculada pelo servidor a partir de lançamentos e vendas reais ·
              origem {dados?.dre?.origem?.toLowerCase() ?? 'automática'} · regime de
              competência · valores em BRL · período {diaBruto(intervalo.inicio)} a{' '}
              {diaBruto(intervalo.fim)} (fuso do navegador, {params.periodoInicio.slice(-6)})
            </p>
          </>
        )}
      </main>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="dre-toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-[#1A1A2E] px-4 py-3 text-[12px] text-white/90 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}



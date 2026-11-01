// NEXUS OS — formatação que respeita as preferências da aba Configurações.
//
// HISTÓRICO DO PROBLEMA
// ----------------------
// Este arquivo tinha pt-BR e BRL fixos no código. A aba Configurações
// oferecia "Moeda: USD/EUR", "Formato data" e "Formato hora", gravava em
// `nexus_prefs`... e NADA lia esse storage. O usuário trocava a opção e
// nada mudava na tela — a preferência era decorativa.
//
// AGORA
// -----
// `prefs()` lê `nexus_prefs` e é usado por todos os formatadores abaixo, de
// modo que moeda/data/hora valem para qualquer tela que importe este módulo
// (Vendas, Estoque, Financeiro, PDV, RH, produtos...).
//
// PERFORMANCE / SSR
// -----------------
// Ler o localStorage a cada `formatBRL` numa tabela de 500 linhas seria caro.
// Por isso o valor é cacheado em `lib/prefs.ts` e só é re-lido quando a
// preferência muda. No servidor não existe localStorage: usamos o padrão
// pt-BR/BRL, e o React re-renderiza com o valor certo no navegador.
import { lerPrefs, invalidarPrefs, type Prefs } from './prefs';

const PADRAO: Prefs = {
  idioma: 'pt-BR',
  moeda: 'BRL',
  fuso: 'America/Sao_Paulo',
  formatoData: 'DD/MM/AAAA',
  formatoHora: '24h',
};

/** Preferências efetivas (cacheadas; sem cache no servidor). */
function prefs(): Prefs {
  if (typeof window === 'undefined') return PADRAO;
  return lerPrefs();
}

/**
 * Locale base para números/moeda.
 *
 * A opção "Idioma" da aba não é decorativa: trocar para English/español troca
 * o separador de milhar e a posição do símbolo — 1.234,56 vira 1,234.56.
 */
function locale(): string {
  return prefs().idioma || 'pt-BR';
}

/** `hour12` derivado da preferência "Formato hora" (12h / 24h). */
function hour12(): boolean {
  return prefs().formatoHora === '12h';
}

/** Código da moeda escolhido em Configurações. */
function moeda(): string {
  return prefs().moeda || 'BRL';
}

/** Símbolo da moeda atual (R$ / $ / €). */
export function simboloMoeda(): string {
  const partes = new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: moeda(),
    currencyDisplay: 'symbol',
  }).formatToParts(0);
  return partes.find((p) => p.type === 'currency')?.value ?? 'R$';
}

/**
 * Moeda escolhida em Configurações.
 *
 * `maxFractionDigits` existe para metas, onde valores grandes aparecem
 * arredondados ("R$ 847 mil") e valores pequenos precisam de centavos.
 */
export function formatBRL(
  n: number | string | null | undefined,
  opts: { maxFractionDigits?: number } = {},
): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return `${simboloMoeda()} —`;
  return v.toLocaleString(locale(), {
    style: 'currency',
    currency: moeda(),
    currencyDisplay: 'symbol',
    ...(opts.maxFractionDigits !== undefined
      ? { minimumFractionDigits: 0, maximumFractionDigits: opts.maxFractionDigits }
      : {}),
  });
}

export function formatNumber(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(locale());
}

export function formatPct(
  n: number | string | null | undefined,
  digits = 1,
): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '— %';
  return `${v.toLocaleString(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function paraData(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  if (typeof iso !== 'string') {
    return Number.isNaN(iso.getTime()) ? null : iso;
  }
  // Data sem hora ("2025-09-22") é interpretada como UTC pelo navegador e,
  // em fusos negativos, voltaria um dia. Ancorar no meio-dia local elimina
  // esse deslocamento — vale para TODA tela que mostra data vinda do backend.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T12:00:00`)
    : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Data conforme "Formato data":
 *   DD/MM/AAAA -> 31/12/2026
 *   MM/DD/AAAA -> 12/31/2026
 *   AAAA-MM-DD -> 2026-12-31
 *
 * Montado à mão em vez de delegar ao Intl para que a ordem dos campos seja
 * EXATAMENTE a escolhida pelo usuário, independentemente do idioma.
 */
export function formatDate(isoVal: string | Date | null | undefined): string {
  const d = paraData(isoVal);
  if (!d) return '—';
  switch (prefs().formatoData) {
    case 'AAAA-MM-DD':
      return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
    case 'MM/DD/AAAA':
      return `${dois(d.getMonth() + 1)}/${dois(d.getDate())}/${d.getFullYear()}`;
    default:
      return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
}

export function formatTime(isoVal: string | Date | null | undefined): string {
  const d = paraData(isoVal);
  if (!d) return '—';
  return d.toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: hour12(),
  });
}

export function formatDateTime(isoVal: string | Date | null | undefined): string {
  const d = paraData(isoVal);
  if (!d) return '—';
  return `${formatDate(d)} ${formatTime(d)}`;
}

/** Só dia/mês, para eixos de gráfico. */
export function formatDayLabel(isoVal: string | Date): string {
  const d = paraData(isoVal);
  if (!d) return '';
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
}

/** ID curto para exibição (ex.: 3f2c9a10) — nunca substitui o ID real. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '—';
}

/** Relógio do balcão, no formato de hora escolhido em Configurações. */
export function formatClock(agora: Date): string {
  return agora.toLocaleTimeString(locale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: hour12(),
  });
}

export { invalidarPrefs };
export type { Prefs };

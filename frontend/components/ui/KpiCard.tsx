'use client';

import type { ComponentType } from 'react';
import { HelpCircle, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { KPI_FORMULAS } from './formulas';

export type Trend = 'up' | 'down' | 'neutral';

export type KpiIconTone = 'accent' | 'emerald' | 'amber' | 'red' | 'neutral';

const ICON_TONES: Record<KpiIconTone, string> = {
  accent: 'bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] text-[var(--nx-accent-ink)]',
  emerald: 'bg-emerald-500/10 text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-300',
  red: 'bg-red-500/10 text-red-300',
  neutral: 'bg-white/[0.06] text-white/60',
};

/**
 * Card de KPI do Layout Mestre.
 * - `formulaKey` exibe o tooltip com a fórmula (dicionário do mestre).
 * - `trend` aponta direção; `trendTone` permite inverter a cor
 *   (ex.: CMV/Despesas caindo é algo bom → trend="down" trendTone="good").
 * - `icon`/`iconTone` troca a seta de tendência pelo selo circular do layout
 *   de referência (aba Vendas); `delta` mostra a variação ao lado do valor.
 *   Nenhum desses é obrigatório — quem não passa nada vê o card de sempre.
 */
export default function KpiCard({
  title,
  value,
  trend = 'neutral',
  trendTone,
  formulaKey,
  sub,
  icon: Icon,
  iconTone = 'neutral',
  delta,
  deltaTone = 'neutral',
  className = '',
}: {
  title: string;
  value: string;
  trend?: Trend;
  trendTone?: 'good' | 'bad';
  formulaKey?: string;
  sub?: string;
  icon?: ComponentType<{ className?: string }>;
  iconTone?: KpiIconTone;
  delta?: string;
  deltaTone?: 'good' | 'bad' | 'neutral';
  className?: string;
}) {
  const formula = formulaKey ? KPI_FORMULAS[formulaKey] : undefined;

  const TrendIcon =
    trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  const isGood =
    trendTone === 'good'
      ? true
      : trendTone === 'bad'
        ? false
        : trend === 'up';

  const trendColor =
    trend === 'neutral'
      ? 'text-white/30'
      : isGood
        ? 'text-emerald-400'
        : 'text-red-400';

  const deltaColor =
    deltaTone === 'good'
      ? 'text-emerald-400'
      : deltaTone === 'bad'
        ? 'text-red-400'
        : 'text-white/40';

  return (
    <div
      className={`relative bg-[#1A1A2E] rounded-[16px] border border-white/[0.06] p-5 min-w-0 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-white/40 leading-snug">
          <span className="inline-flex items-center gap-1.5">
            {title}
            {formula && (
              <span className="relative group inline-flex">
                <HelpCircle className="h-3.5 w-3.5 text-white/20 group-hover:text-white/50 cursor-help transition-colors" />
                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-6 z-30 w-60 rounded-[10px] bg-[#121221] border border-white/[0.12] px-3 py-2 text-[11px] normal-case tracking-normal text-white/70 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
                  {formula}
                </span>
              </span>
            )}
          </span>
        </span>
        {Icon ? (
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${ICON_TONES[iconTone]}`}
          >
            <Icon className="h-4 w-4" />
          </div>
        ) : (
          <TrendIcon className={`h-4 w-4 shrink-0 ${trendColor}`} />
        )}
      </div>
      {delta ? (
        <div className="flex items-end gap-2 mt-1.5 min-w-0">
          <span className="text-[22px] font-bold text-white truncate">{value}</span>
          <span className={`text-[11px] mb-1 font-medium shrink-0 ${deltaColor}`}>{delta}</span>
        </div>
      ) : (
        <div className="text-[22px] font-bold mt-1.5 text-white truncate">{value}</div>
      )}
      {sub && <div className="text-[11px] text-white/30 mt-1">{sub}</div>}
    </div>
  );
}

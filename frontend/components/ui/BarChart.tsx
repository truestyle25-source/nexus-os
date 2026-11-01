'use client';

import { formatBRL, formatNumber } from '@/lib/format';

export type ChartPoint = { label: string; value: number | null };

/**
 * Gráfico de barras do Layout Mestre — 100% CSS, sem biblioteca de gráficos
 * (o projeto não usa nenhuma). `value: null` significa "sem dado" (ex.: sem
 * permissão de custo): a barra não é desenhada e nada é estimado.
 * O valor real de cada barra fica no `title` (tooltip nativo do navegador).
 */
export default function BarChart({
  points,
  format = 'number',
  height = 132,
  maxLabels = 8,
  color = '#7C3AED',
  className = '',
  emptyLabel = 'Sem dados no período selecionado.',
}: {
  points: ChartPoint[];
  format?: 'number' | 'currency';
  height?: number;
  maxLabels?: number;
  color?: string;
  className?: string;
  emptyLabel?: string;
}) {
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v)
      ? '—'
      : format === 'currency'
        ? formatBRL(v)
        : formatNumber(v);

  const valores = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const maximo = valores.length ? Math.max(...valores) : 0;
  const temAlgo = valores.some((v) => v !== 0);

  if (!points.length || !temAlgo) {
    return (
      <div
        className={`flex items-center justify-center rounded-[12px] bg-[#121221] border border-dashed border-white/10 text-[11.5px] text-white/30 text-center px-4 ${className}`}
        style={{ height }}
      >
        {points.length ? emptyLabel : 'Nenhum período para exibir.'}
      </div>
    );
  }

  const passo = Math.max(1, Math.ceil(points.length / maxLabels));

  return (
    <div className={className}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {points.map((p, i) => {
          const pct =
            typeof p.value === 'number' && Number.isFinite(p.value) && maximo > 0
              ? Math.max(p.value > 0 ? 2 : 0, (p.value / maximo) * 100)
              : 0;
          return (
            <div
              key={`${p.label}-${i}`}
              className="flex-1 min-w-[3px] flex items-end h-full group"
              title={`${p.label} • ${fmt(p.value)}`}
            >
              <div
                className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-80"
                style={{ height: `${pct}%`, backgroundColor: color }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-white/25 truncate">{points[0]?.label}</span>
        <span className="text-[10px] text-white/25">máx. {fmt(maximo)}</span>
        <span className="text-[10px] text-white/25 truncate">
          {points[points.length - 1]?.label}
        </span>
      </div>
      {passo > 1 && (
        <div className="text-[10px] text-white/20 mt-1">
          {points.length} períodos no eixo — cada barra tem o valor real no tooltip.
        </div>
      )}
    </div>
  );
}

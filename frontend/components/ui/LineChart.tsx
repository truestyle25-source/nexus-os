'use client';

import { formatBRL, formatNumber } from '@/lib/format';

export type LineSeries = { label: string; color: string; values: Array<number | null> };

/**
 * Gráfico de linhas do Layout Mestre — SVG puro, sem biblioteca de gráficos.
 *
 * Cada série é normalizada no PRÓPRIO intervalo (min máx reais) porque as
 * séries comparadas têm unidades diferentes (ex.: lucro em R$ × margem em %).
 * Para não enganar quem lê, a legenda sempre mostra os valores reais de cada
 * série e um aviso explica que as escalas são independentes.
 * `null` = sem dado (ex.: sem permissão de custo) — a linha é interrompida.
 */
export default function LineChart({
  labels,
  series,
  height = 148,
  format = 'number',
  className = '',
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  format?: 'number' | 'currency';
  className?: string;
}) {
  const fmt = (v: number | null) =>
    v === null || !Number.isFinite(v)
      ? '—'
      : format === 'currency'
        ? formatBRL(v)
        : formatNumber(v);

  const comValores = series.map((s) => {
    const validos = s.values.filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    return {
      ...s,
      validos,
      min: validos.length ? Math.min(...validos) : null,
      max: validos.length ? Math.max(...validos) : null,
    };
  });

  const temDados = comValores.some((s) => s.validos.length >= 2);

  if (!temDados) {
    return (
      <div
        className={`flex items-center justify-center rounded-[12px] bg-[#121221] border border-dashed border-white/10 text-[11.5px] text-white/30 text-center px-4 ${className}`}
        style={{ height }}
      >
        Sem dados no período selecionado.
      </div>
    );
  }

  const total = Math.max(labels.length, ...comValores.map((s) => s.values.length), 2);

  const caminho = (values: Array<number | null>, min: number | null, max: number | null) => {
    const amplitude = min !== null && max !== null && max !== min ? max - min : 0;
    let dentro = false;
    const partes: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const v = values[i];
      const x = total > 1 ? (i / (total - 1)) * 100 : 0;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        dentro = false;
        continue;
      }
      const norm = amplitude === 0 || min === null ? 0.5 : (v - min) / amplitude;
      const y = 100 - norm * 100;
      partes.push(`${dentro ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
      dentro = true;
    }
    return partes.join(' ');
  };

  return (
    <div className={className}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full block rounded-[12px] bg-[#121221] border border-white/[0.05]"
        style={{ height }}
      >
        {[25, 50, 75].map((y) => (
          <line
            key={y}
            x1="0"
            x2="100"
            y1={y}
            y2={y}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {comValores.map((s) =>
          s.validos.length >= 2 ? (
            <path
              key={s.label}
              d={caminho(s.values, s.min, s.max)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null,
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5">
        {comValores.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-white/40">
            <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-white/60">{s.label}</span>
            <span>
              {s.validos.length
                ? `${fmt(s.min)} – ${fmt(s.max)}`
                : 'sem dados no período'}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-white/25 truncate">{labels[0] ?? '—'}</span>
        <span className="text-[10px] text-white/25 truncate">
          {labels[labels.length - 1] ?? '—'}
        </span>
      </div>

      {comValores.length > 1 && (
        <div className="text-[10px] text-white/20 mt-1">
          Escalas independentes por série — cada linha mostra a própria forma; os valores
          reais de mínimo e máximo estão na legenda.
        </div>
      )}
    </div>
  );
}

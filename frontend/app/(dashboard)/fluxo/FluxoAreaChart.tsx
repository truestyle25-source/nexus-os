'use client';

/**
 * /fluxo — série diária (entradas x saídas).
 *
 * Fica em arquivo próprio de propósito: a página carrega este módulo com
 * `next/dynamic` + `ssr: false`, então o Recharts só entra no bundle do
 * cliente depois que a tela já pintou. O resto da página (KPIs, projeção,
 * tabela) não depende dele — um bug aqui não derruba a tela inteira.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL } from '@/lib/format';

export type PontoGrafico = {
  dia: string;
  label: string;
  entradas: number;
  saidas: number;
};

export type SerieVisivel = 'todas' | 'entradas' | 'saidas';

const COR_ENTRADAS = '#22C55E';
const COR_SAIDAS = '#F59E0B';
const COR_EIXO = 'rgba(255,255,255,0.32)';
const COR_GRADE = 'rgba(255,255,255,0.05)';

/** R$ compacto no eixo Y (R$ 12,4 mil) — evita o rótulo comendo a área útil. */
function compacto(v: number): string {
  if (!Number.isFinite(v)) return 'R$ 0';
  const a = Math.abs(v);
  const sinal = v < 0 ? '-' : '';
  if (a >= 1000000)
    return `${sinal}R$ ${(a / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}mi`;
  if (a >= 1000)
    return `${sinal}R$ ${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return `${sinal}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

type ItemTooltip = { dataKey?: string | number; value?: number | string };

function Linha({
  cor,
  rotulo,
  valor,
}: {
  cor: string;
  rotulo: string;
  valor: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-[11.5px] text-white/50">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cor }} />
        {rotulo}
      </span>
      <span className="text-[11.5px] font-semibold text-white/85 tabular-nums">
        {formatBRL(valor)}
      </span>
    </div>
  );
}

/** Tooltip do gráfico: dia + entradas + saídas + saldo do dia. */
function TooltipFluxo({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ItemTooltip[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entradas = Number(payload.find((p) => p.dataKey === 'entradas')?.value ?? 0);
  const saidas = Number(payload.find((p) => p.dataKey === 'saidas')?.value ?? 0);
  const saldo = entradas - saidas;
  return (
    <div className="pointer-events-none min-w-[196px] rounded-[14px] border border-white/10 bg-[#1A1A2E]/95 px-3.5 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.65)] backdrop-blur-xl">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
        {label}
      </div>
      <div className="mt-2 space-y-1.5">
        <Linha cor={COR_ENTRADAS} rotulo="Entradas" valor={entradas} />
        <Linha cor={COR_SAIDAS} rotulo="Saídas" valor={saidas} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-4 border-t border-white/[0.08] pt-2">
        <span className="text-[11px] text-white/45">Saldo do dia</span>
        <span
          className={`text-[11.5px] font-semibold tabular-nums ${saldo < 0 ? 'text-red-300' : 'text-white'}`}
        >
          {formatBRL(saldo)}
        </span>
      </div>
    </div>
  );
}

export default function FluxoAreaChart({
  pontos,
  serie,
}: {
  pontos: PontoGrafico[];
  serie: SerieVisivel;
}) {
  return (
    <div className="h-[320px] md:h-[340px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pontos} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fxGradEntradas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COR_ENTRADAS} stopOpacity={0.34} />
              <stop offset="100%" stopColor={COR_ENTRADAS} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fxGradSaidas" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COR_SAIDAS} stopOpacity={0.3} />
              <stop offset="100%" stopColor={COR_SAIDAS} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={COR_GRADE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COR_EIXO, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
            minTickGap={26}
            interval="preserveStartEnd"
          />
          <YAxis
            width={54}
            tick={{ fill: COR_EIXO, fontSize: 10.5 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={compacto}
          />
          <Tooltip
            content={<TooltipFluxo />}
            cursor={{ stroke: 'rgba(255,255,255,0.16)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="entradas"
            name="Entradas"
            stroke={COR_ENTRADAS}
            strokeWidth={2}
            fill="url(#fxGradEntradas)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#0B0B18' }}
            hide={serie === 'saidas'}
            isAnimationActive
            animationDuration={600}
          />
          <Area
            type="monotone"
            dataKey="saidas"
            name="Saídas"
            stroke={COR_SAIDAS}
            strokeWidth={2}
            fill="url(#fxGradSaidas)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: '#0B0B18' }}
            hide={serie === 'entradas'}
            isAnimationActive
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

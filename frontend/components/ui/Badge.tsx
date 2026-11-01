'use client';

import type { ReactNode } from 'react';

export type BadgeTone =
  | 'emerald'
  | 'amber'
  | 'red'
  | 'neutral'
  | 'accent'
  | 'white';

const TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  emerald: {
    chip: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  amber: {
    chip: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    dot: 'bg-amber-400',
  },
  red: {
    chip: 'bg-red-500/10 border-red-500/20 text-red-300',
    dot: 'bg-red-400',
  },
  neutral: {
    chip: 'bg-white/[0.06] border-white/10 text-white/60',
    dot: 'bg-white/30',
  },
  accent: {
    chip: 'bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] border-[color-mix(in_srgb,var(--nx-accent)_30%,transparent)] text-[var(--nx-accent-ink)]',
    dot: 'bg-[var(--nx-accent)]',
  },
  white: {
    chip: 'bg-white text-black border-white',
    dot: 'bg-black/70',
  },
};

/** Chip/badge de status do Layout Mestre. */
export default function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className = '',
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border leading-none ${t.chip} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

/** Mapeia um status de negócio para o tom visual padrão do mestre. */
export function toneForStatus(status?: string | null): BadgeTone {
  const s = (status || '').toUpperCase();
  if (
    ['FINALIZADA', 'ATIVA', 'ATIVO', 'PAGO', 'RECEBIDA', 'PAGA', 'EMITIDA', 'APROVADA', 'CUMPRIDA'].includes(s)
  )
    return 'emerald';
  if (
    ['PENDENTE', 'SOLICITADA', 'PEDIDO', 'ABERTA', 'TRIAL', 'A VENCER', 'A_VENCER'].includes(s)
  )
    return 'amber';
  if (
    ['CANCELADA', 'CANCELADO', 'VENCIDA', 'VENCIDO', 'ERRO', 'ATRASADA', 'EXPIRADA', 'EXPIRADO', 'ESTORNADA', 'DEVOLVIDA', 'PERDA'].includes(s)
  )
    return 'red';
  return 'neutral';
}

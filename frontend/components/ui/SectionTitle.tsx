'use client';

import type { ReactNode } from 'react';

/**
 * Título de seção do Layout Mestre: kicker opcional em caixa alta +
 * título principal. `right` é o slot para ações (botões, filtros).
 */
export default function SectionTitle({
  kicker,
  children,
  right,
  className = '',
}: {
  kicker?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 min-w-0 ${className}`}
    >
      <div className="min-w-0">
        {kicker && (
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/30 mb-1">
            {kicker}
          </div>
        )}
        <div className="text-[15px] font-semibold text-white leading-snug">
          {children}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';

/** Painel externo do Layout Mestre: bg #1A1A2E, borda white/[0.06], raio 16px. */
export function Panel({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`bg-[#1A1A2E] rounded-[16px] border border-white/[0.06] min-w-0 ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Card interno do Layout Mestre: bg #121221, borda white/[0.05], raio 12px. */
export function InnerPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[#121221] rounded-[12px] border border-white/[0.05] min-w-0 ${className}`}
    >
      {children}
    </div>
  );
}

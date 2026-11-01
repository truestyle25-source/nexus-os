'use client';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Cabeçalho padrão de módulo (padrão do Layout Mestre):
 * botão de volta → Dashboard, kicker opcional, título e subtítulo,
 * com slot `action` à direita.
 */
export default function ModuleHeader({
  title,
  subtitle,
  kicker,
  action,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  action?: ReactNode;
}) {
  const router = useRouter();
  return (
    <header className="mb-6">
      <button
        className="h-8 px-3 rounded-[10px] bg-[#1A1A2E] border border-white/[0.08] text-white/50 hover:text-white text-[12.5px] transition-colors"
        type="button"
        onClick={() => router.push('/')}
      >
        ← Dashboard
      </button>
      {kicker && (
        <div className="text-[11px] uppercase tracking-[0.14em] text-white/30 mt-4 mb-1">
          {kicker}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 mt-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold text-white tracking-tight leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-white/40 mt-1.5 max-w-3xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}

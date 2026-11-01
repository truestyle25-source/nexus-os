'use client';

import type { ComponentType } from 'react';

export type TabItem<T extends string> = {
  key: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
};

/**
 * Tabs do Layout Mestre.
 * - variant="container": grupo em pílula (usado no RH/Estoque).
 * - variant="loose": botões soltos (usado em Financeiro/Relatórios/Fiscal).
 * Aba ativa = fundo branco, texto preto (padrão do mestre).
 */
export default function TabsPill<T extends string>({
  items,
  value,
  onChange,
  variant = 'container',
  className = '',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  variant?: 'container' | 'loose';
  className?: string;
}) {
  const activeCls = 'bg-white text-black border-white shadow font-medium';
  const idleCls =
    'bg-transparent border-transparent text-white/50 hover:text-white hover:bg-white/[0.06]';
  const looseIdleCls =
    'bg-[#1A1A2E] border-white/[0.06] text-white/50 hover:text-white hover:border-white/15';

  const buttons = items.map((it) => {
    const active = value === it.key;
    return (
      <button
        key={it.key}
        type="button"
        onClick={() => onChange(it.key)}
        className={`h-8 px-4 rounded-[10px] text-[13px] border flex items-center gap-2 transition whitespace-nowrap ${
          active ? activeCls : variant === 'container' ? idleCls : looseIdleCls
        }`}
      >
        {it.icon && <it.icon className="h-4 w-4 shrink-0" />}
        {it.label}
      </button>
    );
  });

  if (variant === 'container') {
    return (
      <div
        className={`flex flex-wrap items-center gap-1 p-1.5 rounded-[14px] bg-[#1A1A2E] border border-white/[0.06] w-fit max-w-full ${className}`}
      >
        {buttons}
      </div>
    );
  }

  return <div className={`flex flex-wrap gap-2 ${className}`}>{buttons}</div>;
}

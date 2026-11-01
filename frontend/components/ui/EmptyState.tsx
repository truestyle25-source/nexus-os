'use client';

import type { ComponentType } from 'react';

/**
 * Estado vazio do Layout Mestre — sempre honesto: usado quando não há
 * dados reais (nunca substituído por números fictícios).
 */
export default function EmptyState({
  title,
  description,
  icon: Icon,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[12px] bg-[#121221] border border-dashed border-white/10 px-6 py-8 text-center ${className}`}
    >
      {Icon && (
        <div className="flex justify-center mb-2.5">
          <div className="h-9 w-9 rounded-[10px] bg-white/[0.06] flex items-center justify-center">
            <Icon className="h-4 w-4 text-white/30" />
          </div>
        </div>
      )}
      <div className="text-[13px] font-medium text-white/40">{title}</div>
      {description && (
        <div className="text-[11px] text-white/25 mt-1.5 leading-relaxed max-w-md mx-auto">
          {description}
        </div>
      )}
    </div>
  );
}

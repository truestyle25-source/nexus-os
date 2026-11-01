'use client';

import type { ReactNode } from 'react';

export type DataColumn<T> = {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: T) => ReactNode;
  /** classe extra aplicada na célula */
  cellClassName?: string;
};

/**
 * Tabela padrão do Layout Mestre: header em caixa alta 11px branco/30,
 * linhas separadas por divide-y white/[0.05].
 */
export default function DataTable<T>({
  columns,
  rows,
  keyOf,
  empty,
  className = '',
  onRowClick,
  rowClassName = '',
}: {
  columns: DataColumn<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  /** renderizado no lugar da tabela quando não há linhas */
  empty?: ReactNode;
  className?: string;
  /** Quando informado, a linha inteira vira clicável (padrão da aba Vendas). */
  onRowClick?: (row: T) => void;
  /** Classe extra por linha (ex.: destacar linhas canceladas). */
  rowClassName?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const alignCls = (a?: 'left' | 'center' | 'right') =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className={`overflow-x-auto nx-scroll ${className}`}>
      <table className="w-full text-[13px] min-w-[480px]">
        <thead className="text-[11px] uppercase text-white/30">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`py-2 px-2 font-medium ${alignCls(c.align)} ${
                  c.cellClassName ?? ''
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`text-white/60 hover:text-white/90 transition-colors ${
                onRowClick ? 'cursor-pointer hover:bg-white/[0.03]' : ''
              } ${rowClassName}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-2.5 px-2 align-middle ${alignCls(c.align)}`}
                >
                  {c.render
                    ? c.render(row)
                    : ((row as Record<string, unknown>)[c.key] as ReactNode) ??
                      '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

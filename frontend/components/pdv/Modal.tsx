'use client';

import type React from 'react';

export const estiloLabel: React.CSSProperties = { fontSize: 12, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 };


/**
 * Modal do balcão.
 *
 * `imprimir` existe por causa do cupom: o `window.print()` do botão saía com a
 * tela inteira, porque nada além do `<header>` tinha `.pdv-noprint`. Agora o
 * fundo do overlay recebe `pdv-print-backdrop` (some na impressão) e a caixa
 * recebe `pdv-print-area` (fica, em preto e branco). Para os outros modais o
 * comportamento é o de sempre: somem na impressão, como todo controle de tela.
 *
 * Não altera o layout: as classes só têm efeito dentro de `@media print`.
 */
export default function Modal({ titulo, onFechar, children, imprimir }: { titulo: string; onFechar: () => void; children: React.ReactNode; imprimir?: boolean }) {
  return (
    <div role="dialog" aria-modal="true" onClick={onFechar} className={`pdv-modal-bg${imprimir ? ' pdv-print-backdrop' : ' pdv-noprint'}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className={`admin-panel pdv-modal-card pdv-scroll${imprimir ? ' pdv-print-area' : ''}`} style={{ width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className={imprimir ? 'pdv-noprint' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{titulo}</h2>
          <button type="button" className="admin-secondary" style={{ padding: '4px 10px' }} onClick={onFechar}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

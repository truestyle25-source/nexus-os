'use client';

import { useEffect } from 'react';
import { relatarErroDeTela } from '@/lib/relatar-erro';

/**
 * Tela de erro compartilhada por app/error.tsx e app/(dashboard)/error.tsx.
 * Usa os tokens visuais do Layout Mestre (--nx-*), registra o erro no backend
 * e oferece "Tentar de novo" (reset do Next, sem recarregar a página).
 */
export default function TelaDeErro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    relatarErroDeTela(error);
  }, [error]);

  return (
    <div role="alert" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        maxWidth: 460, width: '100%', background: 'var(--nx-surface, #15151f)', color: 'var(--nx-ink, #f4f4f5)',
        border: '1px solid var(--nx-border, #2a2a3a)', borderRadius: 20, padding: 28, textAlign: 'center',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Algo deu errado nesta tela</h2>
        <p style={{ fontSize: 14, opacity: 0.8, margin: '0 0 20px', lineHeight: 1.5 }}>
          O erro foi registrado. Seus dados não foram perdidos. Tente de novo; se continuar, avise o suporte
          {error?.digest ? <> informando o código <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{error.digest}</code></> : null}.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: 'var(--nx-accent, #7C3AED)', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
          <a
            href="/"
            style={{ border: '1px solid var(--nx-border-strong, #3a3a4a)', color: 'inherit', borderRadius: 12, padding: '10px 18px', fontWeight: 600, textDecoration: 'none' }}
          >
            Ir para o início
          </a>
        </div>
      </div>
    </div>
  );
}

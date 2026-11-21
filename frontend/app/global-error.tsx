'use client';

// Último recurso: erro no próprio layout raiz. Substitui o documento inteiro,
// por isso precisa de <html> e <body> próprios (exigência do Next).
import { useEffect } from 'react';
import { relatarErroDeTela } from '@/lib/relatar-erro';

export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    relatarErroDeTela(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b12', color: '#f4f4f5', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div role="alert" style={{ maxWidth: 460, padding: 28, textAlign: 'center', background: '#15151f', border: '1px solid #2a2a3a', borderRadius: 20 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>O NEXUS OS encontrou um erro</h2>
          <p style={{ fontSize: 14, opacity: 0.8, margin: '0 0 20px' }}>
            O erro foi registrado. Tente de novo{error?.digest ? ` (código ${error.digest})` : ''}.
          </p>
          <button type="button" onClick={() => reset()} style={{ background: '#7C3AED', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}

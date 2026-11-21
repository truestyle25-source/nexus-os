// Envia erros de tela ao log estruturado do backend (POST /telemetria/erro-frontend).
// Nunca lança exceção e nunca envia token, cookies ou dados digitados: só a
// mensagem do erro, o digest do Next, a página e o começo da pilha.
import { getApiBaseUrl } from './api';

export function relatarErroDeTela(erro: Error & { digest?: string }): void {
  try {
    if (typeof window === 'undefined') return;
    const corpo = JSON.stringify({
      mensagem: String(erro?.message || erro?.name || 'erro desconhecido').slice(0, 500),
      digest: erro?.digest ? String(erro.digest).slice(0, 100) : undefined,
      pagina: window.location.pathname.slice(0, 300),
      pilha: erro?.stack ? String(erro.stack).slice(0, 4000) : undefined,
    });
    void fetch(`${getApiBaseUrl()}/telemetria/erro-frontend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Relatar erro nunca pode gerar outro erro na tela.
  }
}

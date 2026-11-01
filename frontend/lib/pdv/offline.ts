// ============================================================================
// FASE 3 PDV PRO — Detecção de conectividade.
//
// Distinção rigorosa exigida pela missão: NUNCA mostrar "venda aprovada" só
// porque salvou no IndexedDB. Aqui só detectamos online/offline do NAVEGADOR
// (navigator.onLine + eventos). A confirmação real da venda vem do backend.
// ============================================================================

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();

/** true se o navegador acredita estar online (navegador, não o backend). */
export function estaOnline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine !== false;
}

/** Assina mudanças de conectividade. Devolve a função de cancelamento. */
export function observarConectividade(cb: Listener): () => void {
  if (typeof window === 'undefined') return () => {};
  listeners.add(cb);
  const on = () => { listeners.forEach((l) => l(true)); };
  const off = () => { listeners.forEach((l) => l(false)); };
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

/**
 * Verifica se o BACKEND está alcançável (melhor que navigator.onLine, que só
 * sabe da placa de rede). Faz um ping leve; `fetch` rejeita se estiver offline.
 */
export async function backendAlcancavel(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // GET numa rota pública/barata; 401/403 ainda prova que o servidor respondeu.
    await fetch(`${baseUrl}/health`, { method: 'GET', signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

import type { ContextoLocal } from './tipos';

/**
 * Reads the tenant/operator identifiers from the already-issued JWT only to
 * scope browser cache. It does not authenticate requests or authorize sales;
 * the backend verifies the token and every queued operation again.
 */
export function contextoLocalDoToken(token: string | null | undefined): ContextoLocal | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { id?: unknown; empresaId?: unknown };
    if (typeof claims.id !== 'string' || typeof claims.empresaId !== 'string') return null;
    return { empresaId: claims.empresaId, usuarioId: claims.id };
  } catch {
    return null;
  }
}

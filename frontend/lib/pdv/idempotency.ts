/** Secure operation IDs for persistent local work and idempotent API retries. */
export function novoId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error('Este navegador não oferece geração segura de identificadores para o PDV.');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function novaIdempotencyKey(tipo: string): string {
  return `${tipo.toLowerCase()}-${novoId()}`;
}

/** A caller must pass the key already stored with its durable operation. */
export function headerIdempotencia(existente: string, tipo = 'op'): Record<string, string> {
  if (!existente || existente.length < 8) throw new Error(`A operação ${tipo} precisa ser persistida antes do envio.`);
  return { 'x-idempotency-key': existente };
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifragem de credenciais de integração (tokens OAuth do Mercado Livre e da
 * Shopee, chave PIX, senha da integração de ponto), em AES-256-GCM.
 *
 * Formatos armazenados:
 *  - v1 (legado):  "<iv>.<tag>.<dados>". A chave é sha256(JWT_SECRET).
 *  - v2 (atual):   "v2.<iv>.<tag>.<dados>". A chave vem de
 *                  CREDENTIALS_ENCRYPTION_KEY (32 bytes em base64 ou hex).
 *
 * Por que v2: na v1, vazar o JWT_SECRET permitia forjar sessões E decifrar as
 * credenciais, e trocar o JWT_SECRET quebrava todas as integrações. Com a v2
 * os dois segredos são independentes.
 *
 * Compatibilidade: valores v1 continuam sendo decifrados. Novos valores são
 * gravados em v2 quando CREDENTIALS_ENCRYPTION_KEY está configurada; sem ela,
 * o comportamento antigo (v1) é mantido, para não quebrar ambientes que ainda
 * não definiram a variável. O script `src/scripts/recifrar-credenciais.ts`
 * converte os registros v1 existentes para v2.
 */

const PREFIXO_V2 = 'v2.';

function chaveLegadaV1(): Buffer {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres para proteger credenciais de integração.');
  }
  return createHash('sha256').update(secret).digest();
}

/** Lê CREDENTIALS_ENCRYPTION_KEY (base64, base64url ou hex). null se não configurada. */
function chaveV2(): Buffer | null {
  const bruto = (process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (!bruto) return null;
  let chave: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(bruto)) chave = Buffer.from(bruto, 'hex');
  else chave = Buffer.from(bruto.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (chave.length !== 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY deve ter exatamente 32 bytes (64 caracteres hex ou 44 em base64).');
  }
  return chave;
}

function cifrar(valor: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave, iv);
  const encrypted = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decifrar(corpo: string, chave: Buffer): string {
  const [ivRaw, tagRaw, encryptedRaw] = corpo.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('Credencial de integração inválida.');
  const decipher = createDecipheriv('aes-256-gcm', chave, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
}

export function encryptSecret(value: string): string {
  const v2 = chaveV2();
  if (v2) return PREFIXO_V2 + cifrar(value, v2);
  return cifrar(value, chaveLegadaV1());
}

export function decryptSecret(value: string): string {
  if (value.startsWith(PREFIXO_V2)) {
    const v2 = chaveV2();
    if (!v2) throw new Error('Credencial cifrada em v2, mas CREDENTIALS_ENCRYPTION_KEY não está configurada.');
    return decifrar(value.slice(PREFIXO_V2.length), v2);
  }
  return decifrar(value, chaveLegadaV1());
}

/** true quando o valor ainda está no formato legado e há chave v2 para recifrá-lo. */
export function precisaRecifrar(value: string | null | undefined): boolean {
  return !!value && !value.startsWith(PREFIXO_V2) && chaveV2() !== null;
}

/** Decifra (v1 ou v2) e cifra de novo com a chave atual (v2 se configurada). */
export function recifrar(value: string): string {
  return encryptSecret(decryptSecret(value));
}

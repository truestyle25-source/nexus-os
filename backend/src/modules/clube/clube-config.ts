/**
 * NEXUS CLUB — configuração do lado do servidor.
 *
 * O clube fica DESLIGADO até três coisas estarem configuradas no ambiente:
 *  - NEXUS_CLUB_HABILITADO=true            (chave liga/desliga)
 *  - NEXUS_CLUB_JWT_SECRET   (≥ 32 chars)  segredo do crachá do consumidor, DIFERENTE do JWT_SECRET
 *                                           da empresa (trava 3: um crachá não serve do outro lado)
 *  - NEXUS_CLUB_CPF_CHAVE    (≥ 32 chars)  chave do HMAC do CPF (acha a conta sem guardar CPF aberto)
 * Desligado, as rotas /club respondem 503 (só /club/status responde, para a tela saber).
 */
import { createHmac } from 'node:crypto';
import { normalizeCpf } from '../../domain/cpf.js';

export const AUDIENCIA_CLUBE = 'nexus-club';

function segredo(nome: string): string | null {
  const v = (process.env[nome] || '').trim();
  return v.length >= 32 ? v : null;
}

export function segredoJwtClube(): string | null {
  const s = segredo('NEXUS_CLUB_JWT_SECRET');
  // Mesmo valor do segredo da empresa anularia a trava 3: tratado como não configurado.
  if (s && s === (process.env.JWT_SECRET || '').trim()) return null;
  return s;
}

export function chaveCpfClube(): string | null {
  return segredo('NEXUS_CLUB_CPF_CHAVE');
}

export function clubeHabilitado(): boolean {
  return process.env.NEXUS_CLUB_HABILITADO === 'true' && !!segredoJwtClube() && !!chaveCpfClube();
}

/** HMAC-SHA256 do CPF (só dígitos). Mesmo CPF → mesmo hash; sem a chave, não se reverte. */
export function hashCpf(cpf: string): string {
  const chave = chaveCpfClube();
  if (!chave) throw new Error('NEXUS_CLUB_CPF_CHAVE não configurada.');
  return createHmac('sha256', chave).update(normalizeCpf(cpf)).digest('hex');
}

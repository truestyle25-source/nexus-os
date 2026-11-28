/**
 * Crachá (token) do consumidor do NEXUS CLUB: JWT HS256 com segredo PRÓPRIO
 * (NEXUS_CLUB_JWT_SECRET), tipo CONSUMIDOR e audiência "nexus-club".
 *
 * Feito à mão (≈40 linhas) em vez de uma segunda instância do @fastify/jwt para não
 * misturar decoradores com o crachá da empresa: aqui só se aceita HS256, com tipo,
 * audiência, emissão e validade conferidos, e comparação de assinatura em tempo constante.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AUDIENCIA_CLUBE, segredoJwtClube } from './clube-config.js';

/** Sessão curta: o app renova entrando de novo. */
export const VALIDADE_SESSAO_CONSUMIDOR_S = 4 * 60 * 60;

export interface CrachaConsumidor {
  sub: string;
  tipo: 'CONSUMIDOR';
  aud: typeof AUDIENCIA_CLUBE;
  jti: string;
  iat: number;
  exp: number;
  emitidoEmMs: number;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');
const CABECALHO = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function assinar(dados: string, segredo: string): string {
  return createHmac('sha256', segredo).update(dados).digest('base64url');
}

export function emitirCrachaConsumidor(consumidorId: string, agoraMs = Date.now()): { token: string; cracha: CrachaConsumidor } {
  const segredo = segredoJwtClube();
  if (!segredo) throw new Error('NEXUS_CLUB_JWT_SECRET não configurado.');
  const iat = Math.floor(agoraMs / 1000);
  const cracha: CrachaConsumidor = {
    sub: consumidorId, tipo: 'CONSUMIDOR', aud: AUDIENCIA_CLUBE, jti: randomUUID(),
    iat, exp: iat + VALIDADE_SESSAO_CONSUMIDOR_S, emitidoEmMs: agoraMs,
  };
  const corpo = `${CABECALHO}.${b64(JSON.stringify(cracha))}`;
  return { token: `${corpo}.${assinar(corpo, segredo)}`, cracha };
}

/** Confere assinatura, algoritmo, tipo, audiência e validade. Devolve null se qualquer coisa falhar. */
export function lerCrachaConsumidor(token: string | undefined | null, agoraMs = Date.now()): CrachaConsumidor | null {
  const segredo = segredoJwtClube();
  if (!segredo || !token) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cab, carga, assinatura] = partes;
  try {
    const cabecalho = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8'));
    if (cabecalho?.alg !== 'HS256') return null;
    const esperado = Buffer.from(assinar(`${cab}.${carga}`, segredo));
    const recebido = Buffer.from(assinatura);
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
    const c = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    if (c?.tipo !== 'CONSUMIDOR' || c?.aud !== AUDIENCIA_CLUBE) return null;
    if (typeof c.sub !== 'string' || !c.sub || typeof c.jti !== 'string') return null;
    if (typeof c.exp !== 'number' || c.exp * 1000 <= agoraMs) return null;
    if (typeof c.iat !== 'number' || c.iat * 1000 > agoraMs + 60_000) return null;
    return c as CrachaConsumidor;
  } catch {
    return null;
  }
}

import { createHmac } from 'node:crypto';

/** Dados da assinatura Shopee Open Platform. O caller precisa passar o path
 * exato documentado pela operação, sem query string. */
export type ShopeeSignatureScope =
  | { kind: 'public'; partnerId: number; path: string; timestamp: number }
  | { kind: 'shop'; partnerId: number; path: string; timestamp: number; accessToken: string; shopId: number }
  | { kind: 'merchant'; partnerId: number; path: string; timestamp: number; accessToken: string; merchantId: number };

export function buildShopeeSignatureBase(input: ShopeeSignatureScope): string {
  if (!Number.isSafeInteger(input.partnerId) || input.partnerId <= 0) throw new Error('partner_id inválido.');
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp <= 0) throw new Error('timestamp inválido.');
  if (!input.path.startsWith('/api/v2/') || input.path.includes('?')) throw new Error('path da API Shopee inválido.');
  const base = `${input.partnerId}${input.path}${input.timestamp}`;
  if (input.kind === 'public') return base;
  if (!input.accessToken) throw new Error('access_token ausente.');
  const identity = input.kind === 'shop' ? input.shopId : input.merchantId;
  if (!Number.isSafeInteger(identity) || identity <= 0) throw new Error('Identificador externo inválido.');
  return `${base}${input.accessToken}${identity}`;
}

export function signShopeeRequest(input: ShopeeSignatureScope, partnerKey: string): string {
  if (!partnerKey) throw new Error('partner_key ausente.');
  return createHmac('sha256', partnerKey).update(buildShopeeSignatureBase(input), 'utf8').digest('hex');
}


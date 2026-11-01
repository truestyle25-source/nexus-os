import { ErroDeNegocio } from '../../../lib/erros.js';
import { signShopeeRequest, type ShopeeSignatureScope } from './shopee-signature.js';

export interface ShopeeAppConfig {
  partnerId: number;
  partnerKey: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  redirectUri: string;
}

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id?: number;
  merchant_id?: number;
  request_id?: string;
  [key: string]: unknown;
}

export interface ShopeeOrderListPage {
  order_list: Array<{ order_sn: string; order_status?: string; update_time?: number; create_time?: number }>;
  more: boolean;
  next_cursor: string;
}

export interface ShopeeProductListPage {
  item: Array<{ item_id: number; item_status?: string; update_time?: number }>;
  total_count: number;
  has_next_page: boolean;
}

export class ShopeeApiError extends ErroDeNegocio {
  readonly retryable: boolean;
  readonly providerCode: string;
  readonly retryAfterMs: number | null;
  constructor(message: string, status: number, providerCode = '', retryAfterMs: number | null = null) {
    super(message, status);
    this.name = 'ShopeeApiError';
    this.retryable = status === 408 || status === 429 || status >= 500;
    this.providerCode = providerCode.slice(0, 80);
    this.retryAfterMs = retryAfterMs;
  }
}

export function readShopeeConfig(env: NodeJS.ProcessEnv = process.env): ShopeeAppConfig | null {
  const rawId = env.SHOPEE_PARTNER_ID?.trim();
  const partnerKey = env.SHOPEE_PARTNER_KEY?.trim();
  const redirectUri = env.SHOPEE_REDIRECT_URI?.trim();
  if (!rawId || !partnerKey || !redirectUri) return null;
  const partnerId = Number(rawId);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) return null;
  let parsedRedirect: URL;
  try { parsedRedirect = new URL(redirectUri); } catch { return null; }
  if (parsedRedirect.protocol !== 'https:' && env.NODE_ENV === 'production') return null;
  return {
    partnerId,
    partnerKey,
    redirectUri,
    apiBaseUrl: (env.SHOPEE_API_BASE_URL || 'https://partner.shopeemobile.com').replace(/\/+$/, ''),
    authBaseUrl: (env.SHOPEE_AUTH_BASE_URL || 'https://partner.shopeemobile.com').replace(/\/+$/, ''),
  };
}

export class ShopeeApiClient {
  constructor(
    private readonly config: ShopeeAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 12_000,
    private readonly maxGetAttempts = 3,
  ) {}

  buildAuthorizationUrl(state: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const path = '/api/v2/shop/auth_partner';
    const sign = signShopeeRequest({ kind: 'public', partnerId: this.config.partnerId, path, timestamp }, this.config.partnerKey);
    const redirect = new URL(this.config.redirectUri);
    redirect.searchParams.set('state', state);
    const url = new URL(path, this.config.authBaseUrl);
    url.search = new URLSearchParams({ partner_id: String(this.config.partnerId), timestamp: String(timestamp), sign, redirect: redirect.toString() }).toString();
    return url.toString();
  }

  async exchangeAuthorizationCode(input: { code: string; shopId: number; timestamp?: number }): Promise<ShopeeTokenResponse> {
    return this.publicPost('/api/v2/auth/token/get', {
      code: input.code,
      shop_id: input.shopId,
      partner_id: this.config.partnerId,
    }, input.timestamp);
  }

  async refreshAccessToken(input: { shopId: number; refreshToken: string; timestamp?: number }): Promise<ShopeeTokenResponse> {
    return this.publicPost('/api/v2/auth/access_token/get', {
      shop_id: input.shopId,
      refresh_token: input.refreshToken,
      partner_id: this.config.partnerId,
    }, input.timestamp);
  }

  async getShopInfo(input: { shopId: number; accessToken: string; timestamp?: number }): Promise<{ shop_name?: string; shop_id?: number; [key: string]: unknown }> {
    const result = await this.shopGet<{ response?: { shop_name?: string; shop_id?: number; [key: string]: unknown } }>(
      '/api/v2/shop/get_shop_info', input.shopId, input.accessToken, {}, input.timestamp,
    );
    if (!result.response || typeof result.response !== 'object') throw new ShopeeApiError('Resposta de identidade da loja inválida.', 502);
    return result.response;
  }

  async getOrderList(input: {
    shopId: number; accessToken: string; timeRangeField: 'create_time' | 'update_time';
    timeFrom: number; timeTo: number; pageSize?: number; cursor?: string; timestamp?: number;
  }): Promise<ShopeeOrderListPage> {
    if (!Number.isSafeInteger(input.timeFrom) || !Number.isSafeInteger(input.timeTo) || input.timeFrom <= 0 || input.timeTo <= input.timeFrom || input.timeTo - input.timeFrom > 15 * 24 * 60 * 60) {
      throw new ErroDeNegocio('A janela de consulta de pedidos Shopee deve ser positiva e não exceder 15 dias.', 400);
    }
    const pageSize = input.pageSize ?? 100;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new ErroDeNegocio('page_size deve estar entre 1 e 100.', 400);
    const result = await this.shopGet<{ response?: ShopeeOrderListPage }>('/api/v2/order/get_order_list', input.shopId, input.accessToken, {
      time_range_field: input.timeRangeField,
      time_from: input.timeFrom,
      time_to: input.timeTo,
      page_size: pageSize,
      cursor: input.cursor,
      response_optional_fields: 'order_status',
    }, input.timestamp);
    if (!result.response || !Array.isArray(result.response.order_list) || typeof result.response.more !== 'boolean') {
      throw new ShopeeApiError('Resposta inválida na consulta de pedidos Shopee.', 502);
    }
    return result.response;
  }

  async getOrderDetail(input: { shopId: number; accessToken: string; orderSns: string[]; timestamp?: number }): Promise<unknown[]> {
    if (!input.orderSns.length || input.orderSns.length > 50 || input.orderSns.some((id) => !id || id.length > 64)) {
      throw new ErroDeNegocio('Informe de 1 a 50 identificadores de pedido Shopee válidos.', 400);
    }
    const result = await this.shopGet<{ response?: { order_list?: unknown[] } }>('/api/v2/order/get_order_detail', input.shopId, input.accessToken, {
      order_sn_list: input.orderSns.join(','),
      response_optional_fields: 'item_list,order_status,create_time,update_time,pay_time,total_amount,currency',
    }, input.timestamp);
    if (!result.response || !Array.isArray(result.response.order_list)) throw new ShopeeApiError('Resposta inválida nos detalhes de pedidos Shopee.', 502);
    return result.response.order_list;
  }

  async getProductList(input: { shopId: number; accessToken: string; offset: number; pageSize?: number; timestamp?: number }): Promise<ShopeeProductListPage> {
    const pageSize = input.pageSize ?? 100;
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ErroDeNegocio('Parâmetros inválidos para paginação do catálogo Shopee.', 400);
    }
    const result = await this.shopGet<{ response?: ShopeeProductListPage }>('/api/v2/product/get_item_list', input.shopId, input.accessToken, {
      offset: input.offset, page_size: pageSize, item_status: 'NORMAL',
    }, input.timestamp);
    if (!result.response || !Array.isArray(result.response.item) || typeof result.response.has_next_page !== 'boolean') {
      throw new ShopeeApiError('Resposta inválida na consulta do catálogo Shopee.', 502);
    }
    return result.response;
  }

  async getProductDetails(input: { shopId: number; accessToken: string; itemIds: number[]; timestamp?: number }): Promise<unknown[]> {
    if (!input.itemIds.length || input.itemIds.length > 50 || input.itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new ErroDeNegocio('Informe de 1 a 50 item_id Shopee válidos.', 400);
    }
    const result = await this.shopGet<{ response?: { item_list?: unknown[] } }>('/api/v2/product/get_item_base_info', input.shopId, input.accessToken, {
      item_id_list: input.itemIds.join(','),
    }, input.timestamp);
    if (!result.response || !Array.isArray(result.response.item_list)) throw new ShopeeApiError('Resposta inválida nos detalhes do catálogo Shopee.', 502);
    return result.response.item_list;
  }

  async shopGet<T extends Record<string, unknown>>(
    path: string,
    shopId: number,
    accessToken: string,
    params: Record<string, string | number | boolean | undefined>,
    timestamp = Math.floor(Date.now() / 1000),
  ): Promise<T> {
    const signature = signShopeeRequest({ kind: 'shop', partnerId: this.config.partnerId, path, timestamp, accessToken, shopId }, this.config.partnerKey);
    const url = new URL(path, this.config.apiBaseUrl);
    url.searchParams.set('partner_id', String(this.config.partnerId));
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('shop_id', String(shopId));
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('sign', signature);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    return this.send<T>(url, { method: 'GET' });
  }

  private async publicPost<T extends Record<string, unknown>>(path: string, body: Record<string, unknown>, timestamp = Math.floor(Date.now() / 1000)): Promise<T> {
    const sign = signShopeeRequest({ kind: 'public', partnerId: this.config.partnerId, path, timestamp }, this.config.partnerKey);
    const url = new URL(path, this.config.apiBaseUrl);
    url.search = new URLSearchParams({ partner_id: String(this.config.partnerId), timestamp: String(timestamp), sign }).toString();
    return this.send<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  private async send<T extends Record<string, unknown>>(url: URL, init: RequestInit): Promise<T> {
    const safeRead = init.method === 'GET';
    const attempts = safeRead ? Math.max(1, Math.min(this.maxGetAttempts, 4)) : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendOnce<T>(url, init);
      } catch (error) {
        if (!(error instanceof ShopeeApiError) || !safeRead || !error.retryable || attempt >= attempts) throw error;
        const delayMs = error.retryAfterMs ?? Math.min(3_000, 300 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async sendOnce<T extends Record<string, unknown>>(url: URL, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => null) as (T & { error?: unknown; message?: unknown }) | null;
      if (!response.ok) {
        const status = response.status;
        const retryAfter = response.headers.get('retry-after');
        const retryAt = retryAfter && !/^\d+(\.\d+)?$/.test(retryAfter) ? Date.parse(retryAfter) : NaN;
        const retryAfterMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter)
          ? Math.min(Number(retryAfter) * 1000, 300_000)
          : Number.isFinite(retryAt) ? Math.max(0, Math.min(retryAt - Date.now(), 300_000)) : null;
        throw new ShopeeApiError(status === 401 || status === 403 ? 'A Shopee recusou a autorização da loja.' : status === 429 ? 'Limite de chamadas da Shopee atingido.' : 'Falha na comunicação com a Shopee.', status, typeof payload?.error === 'string' ? payload.error : '', retryAfterMs);
      }
      if (!payload || typeof payload !== 'object') throw new ShopeeApiError('Resposta inválida recebida da Shopee.', 502);
      if (typeof payload.error === 'string' && payload.error.length > 0) {
        throw new ShopeeApiError('A Shopee retornou um erro para a operação.', 502, payload.error);
      }
      return payload;
    } catch (error) {
      if (error instanceof ShopeeApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new ShopeeApiError('A chamada à Shopee excedeu o tempo limite.', 504);
      throw new ShopeeApiError('Não foi possível alcançar a API Shopee.', 502);
    } finally {
      clearTimeout(timer);
    }
  }
}


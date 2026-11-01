import test from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, listProviders } from '../src/modules/integracoes/core/registry.js';
import { buildShopeeSignatureBase, signShopeeRequest } from '../src/modules/integracoes/shopee/shopee-signature.js';
import { ShopeeApiClient, ShopeeApiError, readShopeeConfig } from '../src/modules/integracoes/shopee/shopee-api.client.js';

test('Integration Core registra Shopee sem declarar capacidades não implementadas', () => {
  assert.deepEqual(listProviders().map((provider) => provider.id), ['shopee']);
  assert.deepEqual(getProvider('shopee').capabilities, ['request-signing', 'shop-authorization', 'credential-refresh', 'connection-test', 'local-disconnect', 'order-read', 'product-read', 'automatic-order-status-sync']);
});

test('assinatura Shopee de loja usa HMAC-SHA256 sobre os campos documentados', () => {
  const input = { kind: 'shop' as const, partnerId: 123, path: '/api/v2/shop/get_shop_info', timestamp: 1700000000, accessToken: 'test-token', shopId: 456 };
  const base = '123/api/v2/shop/get_shop_info1700000000test-token456';
  assert.equal(buildShopeeSignatureBase(input), base);
  assert.equal(signShopeeRequest(input, 'test-key'), 'c698c20695de4a307afe0c35ce4811862967f00808bde02ea5687b03646ad433');
});

test('assinatura pública omite token/loja; paths e identificadores inválidos falham fechados', () => {
  assert.equal(buildShopeeSignatureBase({ kind: 'public', partnerId: 1, path: '/api/v2/auth/token/get', timestamp: 5 }), '1/api/v2/auth/token/get5');
  assert.throws(() => buildShopeeSignatureBase({ kind: 'shop', partnerId: 1, path: '/api/v2/x?token=bad', timestamp: 5, accessToken: 'x', shopId: 2 }));
  assert.throws(() => buildShopeeSignatureBase({ kind: 'shop', partnerId: 1, path: '/api/v2/x', timestamp: 5, accessToken: 'x', shopId: 0 }));
  assert.throws(() => signShopeeRequest({ kind: 'public', partnerId: 1, path: '/api/v2/x', timestamp: 5 }, ''));
});

test('configuração Shopee não retorna valor parcial nem aceita partner_id inválido', () => {
  assert.equal(readShopeeConfig({ SHOPEE_PARTNER_ID: '', SHOPEE_PARTNER_KEY: 'secret', SHOPEE_REDIRECT_URI: 'https://example.test/callback' }), null);
  assert.equal(readShopeeConfig({ SHOPEE_PARTNER_ID: '0', SHOPEE_PARTNER_KEY: 'secret', SHOPEE_REDIRECT_URI: 'https://example.test/callback' }), null);
  const config = readShopeeConfig({ SHOPEE_PARTNER_ID: '123', SHOPEE_PARTNER_KEY: 'local-test-key', SHOPEE_REDIRECT_URI: 'https://example.test/callback', NODE_ENV: 'production' });
  assert.equal(config?.partnerId, 123);
  assert.equal(config?.partnerKey, 'local-test-key');
});

test('URL de autorização assina parâmetros e carrega state no callback cadastrado', () => {
  const config = { partnerId: 123, partnerKey: 'test-key', apiBaseUrl: 'https://partner.shopeemobile.com', authBaseUrl: 'https://partner.shopeemobile.com', redirectUri: 'https://nexus.example/integracoes/shopee/callback' };
  const url = new URL(new ShopeeApiClient(config).buildAuthorizationUrl('random-state', 1700000000));
  assert.equal(url.pathname, '/api/v2/shop/auth_partner');
  assert.equal(url.searchParams.get('partner_id'), '123');
  assert.equal(url.searchParams.get('timestamp'), '1700000000');
  assert.equal(url.searchParams.get('sign'), signShopeeRequest({ kind: 'public', partnerId: 123, path: '/api/v2/shop/auth_partner', timestamp: 1700000000 }, 'test-key'));
  const redirect = new URL(url.searchParams.get('redirect')!);
  assert.equal(redirect.origin + redirect.pathname, config.redirectUri);
  assert.equal(redirect.searchParams.get('state'), 'random-state');
});

test('cliente aceita identidade somente no envelope response e classifica rate limit sem vazar payload', async () => {
  const config = { partnerId: 123, partnerKey: 'test-key', apiBaseUrl: 'https://partner.shopeemobile.com', authBaseUrl: 'https://partner.shopeemobile.com', redirectUri: 'https://nexus.example/callback' };
  const okFetch: typeof fetch = async () => new Response(JSON.stringify({ error: '', response: { shop_id: 456, shop_name: 'Test shop' } }), { status: 200 });
  const info = await new ShopeeApiClient(config, okFetch).getShopInfo({ shopId: 456, accessToken: 'test-token', timestamp: 1700000000 });
  assert.deepEqual(info, { shop_id: 456, shop_name: 'Test shop' });

  const rateLimitedFetch: typeof fetch = async () => new Response(JSON.stringify({ error: 'rate_limit', message: 'token=do-not-leak' }), { status: 429 });
  await assert.rejects(
    () => new ShopeeApiClient(config, rateLimitedFetch, 12_000, 1).getShopInfo({ shopId: 456, accessToken: 'test-token', timestamp: 1700000000 }),
    (error: unknown) => error instanceof ShopeeApiError && error.status === 429 && error.retryable && !error.message.includes('do-not-leak'),
  );
});

test('cliente repete GET transitório, mas nunca repete POST de troca de código', async () => {
  const config = { partnerId: 123, partnerKey: 'test-key', apiBaseUrl: 'https://partner.shopeemobile.com', authBaseUrl: 'https://partner.shopeemobile.com', redirectUri: 'https://nexus.example/callback' };
  let getCalls = 0;
  const retryGet: typeof fetch = async () => {
    getCalls++;
    return getCalls === 1
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ error: '', response: { shop_id: 456 } }), { status: 200 });
  };
  await new ShopeeApiClient(config, retryGet, 12_000, 2).getShopInfo({ shopId: 456, accessToken: 'test-token', timestamp: 1700000000 });
  assert.equal(getCalls, 2);

  let postCalls = 0;
  const failedPost: typeof fetch = async () => { postCalls++; return new Response('{}', { status: 503 }); };
  await assert.rejects(() => new ShopeeApiClient(config, failedPost, 12_000, 4).exchangeAuthorizationCode({ code: 'one-time-code', shopId: 456, timestamp: 1700000000 }));
  assert.equal(postCalls, 1);
});

test('cliente pagina pedidos e catálogo, valida janelas e responde somente com envelope tipado', async () => {
  const config = { partnerId: 123, partnerKey: 'test-key', apiBaseUrl: 'https://partner.shopeemobile.com', authBaseUrl: 'https://partner.shopeemobile.com', redirectUri: 'https://nexus.example/callback' };
  const seen: URL[] = [];
  const fetchPage: typeof fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url);
    if (url.pathname.endsWith('/order/get_order_list')) {
      return new Response(JSON.stringify({ error: '', response: { order_list: [{ order_sn: 'ORDER-1', order_status: 'READY_TO_SHIP' }], more: false, next_cursor: '' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: '', response: { item: [{ item_id: 777, item_status: 'NORMAL' }], total_count: 1, has_next_page: false } }), { status: 200 });
  };
  const client = new ShopeeApiClient(config, fetchPage);
  const orders = await client.getOrderList({ shopId: 456, accessToken: 'test-token', timeRangeField: 'update_time', timeFrom: 1700000000, timeTo: 1700003600, cursor: 'next', timestamp: 1700004000 });
  const products = await client.getProductList({ shopId: 456, accessToken: 'test-token', offset: 20, pageSize: 50, timestamp: 1700004000 });
  assert.equal(orders.order_list[0].order_sn, 'ORDER-1');
  assert.equal(products.item[0].item_id, 777);
  assert.equal(seen[0].searchParams.get('cursor'), 'next');
  assert.equal(seen[0].searchParams.get('time_range_field'), 'update_time');
  assert.equal(seen[1].searchParams.get('offset'), '20');
  await assert.rejects(() => client.getOrderList({ shopId: 456, accessToken: 'test-token', timeRangeField: 'create_time', timeFrom: 1, timeTo: 1 + 16 * 24 * 60 * 60 }));
});


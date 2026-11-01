import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { decryptSecret, encryptSecret } from '../../../lib/secrets.js';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { registrarAuditoria } from '../../auditoria/auditoria.service.js';
import { requireProviderCapability } from '../core/registry.js';
import { readShopeeConfig, ShopeeApiClient, ShopeeApiError } from './shopee-api.client.js';

const STATE_TTL_MS = 10 * 60_000;
const REFRESH_LEASE_MS = 30_000;

function configObrigatoria() {
  const config = readShopeeConfig();
  if (!config) throw new ErroDeNegocio('Configure SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_REDIRECT_URI no backend.', 503);
  if ((process.env.JWT_SECRET ?? '').length < 32) throw new ErroDeNegocio('JWT_SECRET precisa ter ao menos 32 caracteres para proteger os tokens Shopee.', 503);
  return config;
}

function hashState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

function idShopee(value: string | number): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroDeNegocio('Identificador de loja Shopee inválido.', 400);
  return id;
}

function motivoSeguro(error: unknown): string {
  if (error instanceof ShopeeApiError) return error.message.slice(0, 240);
  return 'Falha ao concluir a operação Shopee.';
}

export function configuracaoShopeeDisponivel(): boolean {
  try { configObrigatoria(); return true; } catch { return false; }
}

export async function iniciarAutorizacaoShopee(input: { empresaId: string; usuarioId: string }) {
  requireProviderCapability('shopee', 'shop-authorization');
  const config = configObrigatoria();
  const state = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await prisma.shopeeOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.shopeeOAuthState.create({ data: { stateHash: hashState(state), empresaId: input.empresaId, usuarioId: input.usuarioId, expiresAt } });
  try {
    const authUrl = new ShopeeApiClient(config).buildAuthorizationUrl(state);
    return { authUrl, expiresAt };
  } catch (error) {
    await prisma.shopeeOAuthState.deleteMany({ where: { stateHash: hashState(state), consumedAt: null } });
    throw error;
  }
}

export async function concluirAutorizacaoShopee(input: { state: string; code: string; shopId: string | number; mainAccountId?: string | number }) {
  const config = configObrigatoria();
  const stateHash = hashState(input.state);
  const now = new Date();
  const tentativa = await prisma.shopeeOAuthState.findFirst({ where: { stateHash, expiresAt: { gt: now }, consumedAt: null } });
  if (!tentativa) throw new ErroDeNegocio('A autorização Shopee expirou ou já foi utilizada. Inicie novamente.', 400);
  const reivindicada = await prisma.shopeeOAuthState.updateMany({ where: { id: tentativa.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
  if (reivindicada.count !== 1) throw new ErroDeNegocio('A autorização Shopee já foi processada.', 409);

  const shopId = idShopee(input.shopId);
  const client = new ShopeeApiClient(config);
  try {
    const token = await client.exchangeAuthorizationCode({ code: input.code, shopId });
    if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expire_in) || token.expire_in <= 0) {
      throw new ErroDeNegocio('A Shopee retornou credenciais incompletas.', 502);
    }
    if (token.shop_id != null && idShopee(token.shop_id) !== shopId) {
      throw new ErroDeNegocio('A loja retornada pela Shopee não corresponde à loja autorizada.', 502);
    }
    const info = await client.getShopInfo({ shopId, accessToken: token.access_token });
    if (info.shop_id != null && idShopee(info.shop_id) !== shopId) {
      throw new ErroDeNegocio('A API Shopee validou uma identidade de loja diferente.', 502);
    }
    const conexao = await prisma.shopeeConexao.upsert({
      where: { empresaId_shopId: { empresaId: tentativa.empresaId, shopId: String(shopId) } },
      create: {
        empresaId: tentativa.empresaId,
        shopId: String(shopId),
        shopName: typeof info.shop_name === 'string' ? info.shop_name.slice(0, 160) : null,
        accessToken: encryptSecret(token.access_token),
        refreshToken: encryptSecret(token.refresh_token),
        tokenExpiry: new Date(Date.now() + token.expire_in * 1000),
        refreshTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        pedidosNextSyncAt: new Date(),
        status: 'CONECTADO',
      },
      update: {
        shopName: typeof info.shop_name === 'string' ? info.shop_name.slice(0, 160) : null,
        accessToken: encryptSecret(token.access_token),
        refreshToken: encryptSecret(token.refresh_token),
        tokenExpiry: new Date(Date.now() + token.expire_in * 1000),
        refreshTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        pedidosNextSyncAt: new Date(), pedidosJanelaDe: null, pedidosJanelaAte: null, pedidosCursor: null,
        pedidosLeaseExpiraEm: null,
        status: 'CONECTADO', connectedAt: now, erros: Prisma.DbNull,
      },
    });
    await registrarAuditoria({
      empresaId: tentativa.empresaId,
      usuarioId: tentativa.usuarioId,
      acao: 'CRIAR', entidade: 'ShopeeConexao', entidadeId: conexao.id,
      valorNovo: { shopId: conexao.shopId, shopName: conexao.shopName, status: conexao.status }, origem: 'INTEGRACAO',
    });
    return { connectionId: conexao.id, shopId: conexao.shopId, shopName: conexao.shopName };
  } catch (error) {
    if (error instanceof ErroDeNegocio) throw error;
    throw new ErroDeNegocio(motivoSeguro(error), error instanceof ShopeeApiError ? error.status : 502);
  }
}

export async function listarConexoesShopee(empresaId: string) {
  const conexoes = await prisma.shopeeConexao.findMany({ where: { empresaId }, orderBy: { createdAt: 'asc' } });
  return conexoes.map(({ id, shopId, shopName, status, connectedAt, tokenExpiry, ultimoTesteEm, ultimoSyncEm, erros }) => ({
    id, shopId, shopName, status, connectedAt, tokenExpiry, ultimoTesteEm, ultimoSyncEm, erros,
  }));
}

async function renovarTokenSeNecessario(empresaId: string, connectionId: string) {
  requireProviderCapability('shopee', 'credential-refresh');
  let conexao = await prisma.shopeeConexao.findFirst({ where: { id: connectionId, empresaId, status: 'CONECTADO' } });
  if (!conexao) throw new ErroDeNegocio('Loja Shopee não encontrada ou desconectada.', 404);
  if (conexao.tokenExpiry.getTime() > Date.now() + 60_000) return conexao;
  if (!conexao.refreshToken) throw new ErroDeNegocio('A loja precisa ser autorizada novamente.', 401);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_MS);
  const claimed = await prisma.shopeeConexao.updateMany({
    where: { id: conexao.id, empresaId, tokenExpiry: conexao.tokenExpiry, OR: [{ refreshLeaseExpiraEm: null }, { refreshLeaseExpiraEm: { lt: now } }] },
    data: { refreshLeaseExpiraEm: leaseUntil },
  });
  if (claimed.count === 0) {
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      conexao = await prisma.shopeeConexao.findFirst({ where: { id: connectionId, empresaId, status: 'CONECTADO' } });
      if (conexao && conexao.tokenExpiry.getTime() > Date.now() + 60_000) return conexao;
    }
    throw new ShopeeApiError('Renovação da credencial Shopee já está em andamento. Tente novamente.', 503);
  }
  try {
    conexao = await prisma.shopeeConexao.findFirst({ where: { id: connectionId, empresaId } });
    if (!conexao?.refreshToken) throw new ErroDeNegocio('A credencial de renovação Shopee não está disponível.', 401);
    const token = await new ShopeeApiClient(configObrigatoria()).refreshAccessToken({ shopId: idShopee(conexao.shopId), refreshToken: decryptSecret(conexao.refreshToken) });
    if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expire_in) || token.expire_in <= 0) {
      throw new ShopeeApiError('A Shopee retornou dados de renovação incompletos.', 502);
    }
    return await prisma.shopeeConexao.update({ where: { id: conexao.id }, data: {
      accessToken: encryptSecret(token.access_token), refreshToken: encryptSecret(token.refresh_token),
      tokenExpiry: new Date(Date.now() + token.expire_in * 1000), status: 'CONECTADO', erros: Prisma.DbNull,
      refreshTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    } });
  } catch (error) {
    if (error instanceof ShopeeApiError && (error.status === 401 || error.status === 403)) {
      await prisma.shopeeConexao.updateMany({ where: { id: connectionId, empresaId }, data: { status: 'REAUTORIZAR', erros: { motivo: error.message, em: new Date().toISOString() } } });
    }
    throw error;
  } finally {
    await prisma.shopeeConexao.updateMany({ where: { id: connectionId, empresaId, refreshLeaseExpiraEm: leaseUntil }, data: { refreshLeaseExpiraEm: null } });
  }
}

export async function testarConexaoShopee(empresaId: string, usuarioId: string, connectionId: string) {
  requireProviderCapability('shopee', 'connection-test');
  const conexao = await renovarTokenSeNecessario(empresaId, connectionId);
  if (!conexao.accessToken) throw new ErroDeNegocio('A loja precisa ser autorizada novamente.', 401);
  try {
    const info = await new ShopeeApiClient(configObrigatoria()).getShopInfo({ shopId: idShopee(conexao.shopId), accessToken: decryptSecret(conexao.accessToken) });
    await prisma.shopeeConexao.update({ where: { id: conexao.id }, data: {
      ultimoTesteEm: new Date(), shopName: typeof info.shop_name === 'string' ? info.shop_name.slice(0, 160) : conexao.shopName, status: 'CONECTADO', erros: Prisma.DbNull,
    } });
    await registrarAuditoria({ empresaId, usuarioId, acao: 'SINCRONIZAR', entidade: 'ShopeeConexao', entidadeId: conexao.id, valorNovo: { test: 'success' }, origem: 'INTEGRACAO' });
    return { ok: true, checkedAt: new Date(), shopName: typeof info.shop_name === 'string' ? info.shop_name : conexao.shopName };
  } catch (error) {
    const status = error instanceof ErroDeNegocio ? error.status : 502;
    await prisma.shopeeConexao.update({ where: { id: conexao.id }, data: { ultimoTesteEm: new Date(), status: status === 401 || status === 403 ? 'REAUTORIZAR' : 'ERRO', erros: { motivo: motivoSeguro(error), em: new Date().toISOString() } } });
    throw new ErroDeNegocio(motivoSeguro(error), status);
  }
}

export async function consultarPedidosShopee(input: {
  empresaId: string; connectionId: string; timeRangeField: 'create_time' | 'update_time';
  timeFrom: number; timeTo: number; cursor?: string;
}) {
  requireProviderCapability('shopee', 'order-read');
  const conexao = await renovarTokenSeNecessario(input.empresaId, input.connectionId);
  if (!conexao.accessToken) throw new ErroDeNegocio('A loja precisa ser autorizada novamente.', 401);
  return new ShopeeApiClient(configObrigatoria()).getOrderList({
    shopId: idShopee(conexao.shopId), accessToken: decryptSecret(conexao.accessToken),
    timeRangeField: input.timeRangeField, timeFrom: input.timeFrom, timeTo: input.timeTo, cursor: input.cursor,
  });
}

export async function consultarProdutosShopee(input: { empresaId: string; connectionId: string; offset: number }) {
  requireProviderCapability('shopee', 'product-read');
  const conexao = await renovarTokenSeNecessario(input.empresaId, input.connectionId);
  if (!conexao.accessToken) throw new ErroDeNegocio('A loja precisa ser autorizada novamente.', 401);
  return new ShopeeApiClient(configObrigatoria()).getProductList({
    shopId: idShopee(conexao.shopId), accessToken: decryptSecret(conexao.accessToken), offset: input.offset,
  });
}

export async function sincronizarStatusPedidosShopee(connectionId: string, empresaId: string) {
  requireProviderCapability('shopee', 'automatic-order-status-sync');
  const conexao = await renovarTokenSeNecessario(empresaId, connectionId);
  if (!conexao.accessToken) throw new ErroDeNegocio('A loja precisa ser autorizada novamente.', 401);
  const agora = Math.floor(Date.now() / 1000);
  const fromStored = conexao.pedidosJanelaDe
    ? Math.floor(conexao.pedidosJanelaDe.getTime() / 1000)
    : conexao.ultimoSyncEm ? Math.floor(conexao.ultimoSyncEm.getTime() / 1000) - 300 : agora - 7 * 24 * 60 * 60;
  const timeFrom = Math.max(1, Math.min(fromStored, agora - 1));
  const timeTo = conexao.pedidosJanelaAte ? Math.floor(conexao.pedidosJanelaAte.getTime() / 1000) : Math.max(timeFrom + 1, agora);
  const client = new ShopeeApiClient(configObrigatoria());
  const token = decryptSecret(conexao.accessToken);
  let cursor: string | undefined = conexao.pedidosCursor ?? undefined;
  let total = 0;
  let more = true;
  // Paginação persistida: se houver mais dados, o próximo tick retoma do cursor.
  for (let pageNumber = 0; more && pageNumber < 5; pageNumber++) {
    const page = await client.getOrderList({
      shopId: idShopee(conexao.shopId), accessToken: token, timeRangeField: 'update_time',
      timeFrom, timeTo, cursor,
    });
    for (const order of page.order_list) {
      if (!order.order_sn || order.order_sn.length > 64) continue;
      const updatedSeconds = Number.isSafeInteger(order.update_time) && order.update_time! > 0 ? order.update_time! : timeTo;
      const createdSeconds = Number.isSafeInteger(order.create_time) && order.create_time! > 0 ? order.create_time! : null;
      await prisma.shopeePedido.upsert({
        where: { conexaoId_orderSn: { conexaoId: conexao.id, orderSn: order.order_sn } },
        create: {
          empresaId, conexaoId: conexao.id, orderSn: order.order_sn,
          statusExterno: (order.order_status || 'UNKNOWN').slice(0, 60),
          externalUpdatedAt: new Date(updatedSeconds * 1000),
          externalCreatedAt: createdSeconds ? new Date(createdSeconds * 1000) : null,
          lastSeenAt: new Date(),
        },
        update: {
          statusExterno: (order.order_status || 'UNKNOWN').slice(0, 60),
          externalUpdatedAt: new Date(updatedSeconds * 1000),
          externalCreatedAt: createdSeconds ? new Date(createdSeconds * 1000) : undefined,
          lastSeenAt: new Date(),
        },
      });
      total++;
    }
    more = page.more;
    cursor = page.next_cursor || undefined;
    if (more && !cursor) throw new ShopeeApiError('A Shopee informou mais páginas sem cursor de continuação.', 502);
  }
  const parcial = more;
  await prisma.shopeeConexao.update({ where: { id: conexao.id }, data: {
    ...(parcial ? { pedidosJanelaDe: new Date(timeFrom * 1000), pedidosJanelaAte: new Date(timeTo * 1000), pedidosCursor: cursor ?? null, pedidosNextSyncAt: new Date(Date.now() + 15_000) }
      : { ultimoSyncEm: new Date(), pedidosJanelaDe: null, pedidosJanelaAte: null, pedidosCursor: null, pedidosNextSyncAt: new Date(Date.now() + 5 * 60_000) }),
    pedidosSyncTentativas: 0,
    status: 'CONECTADO', erros: Prisma.DbNull,
  } });
  return { processados: total, parcial };
}

export async function desconectarLocalmenteShopee(empresaId: string, usuarioId: string, connectionId: string) {
  requireProviderCapability('shopee', 'local-disconnect');
  const conexao = await prisma.shopeeConexao.findFirst({ where: { id: connectionId, empresaId } });
  if (!conexao) throw new ErroDeNegocio('Loja Shopee não encontrada.', 404);
  const atualizada = await prisma.shopeeConexao.update({ where: { id: connectionId }, data: {
    accessToken: null, refreshToken: null, status: 'DESCONECTADO', erros: Prisma.DbNull, refreshLeaseExpiraEm: null,
  } });
  await registrarAuditoria({ empresaId, usuarioId, acao: 'EXCLUIR', entidade: 'ShopeeConexao', entidadeId: atualizada.id, valorAnterior: { shopId: atualizada.shopId, status: conexao.status }, valorNovo: { shopId: atualizada.shopId, status: 'DESCONECTADO' }, origem: 'INTEGRACAO' });
  return { id: atualizada.id, status: atualizada.status };
}


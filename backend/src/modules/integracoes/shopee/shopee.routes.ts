import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { permissaoMiddleware } from '../../../middlewares/auth.js';
import {
  concluirAutorizacaoShopee,
  configuracaoShopeeDisponivel,
  desconectarLocalmenteShopee,
  iniciarAutorizacaoShopee,
  listarConexoesShopee,
  consultarPedidosShopee,
  consultarProdutosShopee,
  testarConexaoShopee,
} from './shopee.service.js';

function statusCentral(status: string): 'CONECTADO' | 'ERRO' | 'NAO_CONFIGURADO' {
  if (status === 'CONECTADO') return 'CONECTADO';
  if (status === 'ERRO' || status === 'EXPIRADO' || status === 'REAUTORIZAR') return 'ERRO';
  return 'NAO_CONFIGURADO';
}

export async function shopeeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/integracoes/shopee/callback', async (req: any, reply: any) => {
    const query = z.object({ state: z.string().min(32).max(128), code: z.string().min(1).max(512), shop_id: z.union([z.string(), z.number()]), main_account_id: z.union([z.string(), z.number()]).optional(), error: z.string().optional() }).safeParse(req.query);
    const frontend = (process.env.FRONTEND_URLS || 'http://localhost:3000').split(',')[0]?.trim() || 'http://localhost:3000';
    if (!query.success || query.data.error) {
      return reply.redirect(`${frontend}/central-integracoes?shopee=error`);
    }
    try {
      await concluirAutorizacaoShopee({ state: query.data.state, code: query.data.code, shopId: query.data.shop_id, mainAccountId: query.data.main_account_id });
      return reply.redirect(`${frontend}/central-integracoes?shopee=connected`);
    } catch (error) {
      req.log.warn({ err: error instanceof Error ? error.message : 'callback falhou' }, 'callback de autorização Shopee não concluído');
      return reply.redirect(`${frontend}/central-integracoes?shopee=error`);
    }
  });

  app.get('/integracoes/shopee', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')],
  }, async (req: any) => {
    const lojas = await listarConexoesShopee(req.user.empresaId);
    return {
      provider: 'shopee',
      configuradoAmbiente: configuracaoShopeeDisponivel(),
      lojas,
    };
  });

  app.get('/integracoes/shopee/central', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')],
  }, async (req: any) => {
    const lojas = await listarConexoesShopee(req.user.empresaId);
    const configuradoAmbiente = configuracaoShopeeDisponivel();
    const ativas = lojas.filter((loja) => loja.status === 'CONECTADO');
    const status = ativas.length ? 'CONECTADO' : lojas.some((loja) => statusCentral(loja.status) === 'ERRO') ? 'ERRO' : 'NAO_CONFIGURADO';
    const ultima = lojas.map((loja) => loja.ultimoSyncEm).filter(Boolean).sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0] ?? null;
    return [{ categoria: 'SHOPEE', nome: ativas.length ? `Shopee — ${ativas.length} loja(s)` : 'Shopee', status, configurado: ativas.length > 0, configuradoAmbiente, ultimaSincronizacao: ultima, erros: lojas.find((loja) => loja.erros)?.erros ?? null }];
  });

  app.post('/integracoes/shopee/conectar', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'criar')],
  }, async (req: any) => iniciarAutorizacaoShopee({ empresaId: req.user.empresaId, usuarioId: req.user.id }));

  app.post('/integracoes/shopee/:connectionId/testar', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'editar')],
  }, async (req: any) => {
    const params = z.object({ connectionId: z.string().min(1).max(100) }).parse(req.params);
    return testarConexaoShopee(req.user.empresaId, req.user.id, params.connectionId);
  });

  app.get('/integracoes/shopee/:connectionId/pedidos', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')],
  }, async (req: any) => {
    const params = z.object({ connectionId: z.string().min(1).max(100) }).parse(req.params);
    const query = z.object({
      time_from: z.coerce.number().int().positive(),
      time_to: z.coerce.number().int().positive().optional(),
      cursor: z.string().max(512).optional(),
    }).parse(req.query);
    const page = await consultarPedidosShopee({
      empresaId: req.user.empresaId,
      connectionId: params.connectionId,
      timeRangeField: 'update_time',
      timeFrom: query.time_from,
      timeTo: query.time_to ?? Math.floor(Date.now() / 1000),
      cursor: query.cursor,
    });
    return { orders: page.order_list, more: page.more, nextCursor: page.next_cursor };
  });

  app.get('/integracoes/shopee/:connectionId/produtos', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')],
  }, async (req: any) => {
    const params = z.object({ connectionId: z.string().min(1).max(100) }).parse(req.params);
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const page = await consultarProdutosShopee({ empresaId: req.user.empresaId, connectionId: params.connectionId, offset: query.offset });
    return { items: page.item, totalCount: page.total_count, hasNextPage: page.has_next_page };
  });

  app.delete('/integracoes/shopee/:connectionId', {
    preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'excluir')],
  }, async (req: any) => {
    const params = z.object({ connectionId: z.string().min(1).max(100) }).parse(req.params);
    const result = await desconectarLocalmenteShopee(req.user.empresaId, req.user.id, params.connectionId);
    if (result.status !== 'DESCONECTADO') throw new ErroDeNegocio('Não foi possível registrar a desconexão local.', 500);
    return { ok: true, status: result.status, revogacaoExterna: 'NAO_CONFIRMADA' };
  });
}


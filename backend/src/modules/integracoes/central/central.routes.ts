/**
 * Rotas da Central de Integrações (prefixo /integracoes/central).
 * Mercado Livre e Shopee continuam usando as rotas próprias de OAuth; aqui eles
 * aparecem no catálogo, nos estados e no histórico.
 *
 * Permissões (módulo `integracoes`): visualizar = ver catálogo/estado/histórico;
 * editar = testar, salvar e desconectar; excluir = remover a configuração.
 * empresaId sempre da sessão — nunca do corpo.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { permissaoMiddleware } from '../../../middlewares/auth.js';
import { catalogoPublico } from './provedores.js';
import { desconectar, estadosDaEmpresa, historico, obterConfiguracao, remover, resumir, salvar, testar } from './central.service.js';

const Params = z.object({ provedor: z.string().regex(/^[a-z0-9-]{2,40}$/) });
const Corpo = z.record(z.string(), z.string().max(2000)).default({});

export async function centralIntegracoesRoutes(app: FastifyInstance): Promise<void> {
  const auth = (app as any).authenticate;
  const ver = await permissaoMiddleware('integracoes', 'visualizar');
  const editar = await permissaoMiddleware('integracoes', 'editar');
  const excluir = await permissaoMiddleware('integracoes', 'excluir');

  app.get('/integracoes/central/painel', { preHandler: [auth, ver] }, async (req: any) => {
    const estados = await estadosDaEmpresa(req.user.empresaId);
    return { provedores: catalogoPublico(), estados, resumo: resumir(estados) };
  });

  app.get('/integracoes/central/:provedor', { preHandler: [auth, ver] }, async (req: any) =>
    obterConfiguracao(req.user.empresaId, Params.parse(req.params).provedor));

  app.post('/integracoes/central/:provedor/testar', { preHandler: [auth, editar] }, async (req: any) =>
    testar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor, Corpo.parse(req.body ?? {})));

  app.put('/integracoes/central/:provedor', { preHandler: [auth, editar] }, async (req: any) =>
    salvar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor, Corpo.parse(req.body ?? {})));

  app.post('/integracoes/central/:provedor/desconectar', { preHandler: [auth, editar] }, async (req: any) =>
    desconectar(req.user.empresaId, req.user.id, Params.parse(req.params).provedor));

  app.delete('/integracoes/central/:provedor', { preHandler: [auth, excluir] }, async (req: any) =>
    remover(req.user.empresaId, req.user.id, Params.parse(req.params).provedor));

  app.get('/integracoes/central/:provedor/historico', { preHandler: [auth, ver] }, async (req: any) =>
    ({ eventos: await historico(req.user.empresaId, Params.parse(req.params).provedor) }));
}

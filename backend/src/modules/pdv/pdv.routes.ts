
import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';

export async function pdvRoutes(app: FastifyInstance) {
  app.get('/pdv/integracoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] }, async (req:any) => {
    return prisma.integracaoPDV.findMany({ where: { empresaId: req.user.empresaId } });
  });

  app.post('/pdv/integracoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'criar')] }, async (req:any) => {
    const { nome, tipo, url } = req.body as any;
    // Seção 14: só API oficial, SDK oficial, webhook oficial, banco autorizado
    const tiposPermitidos = ['API_OFICIAL','SDK_OFICIAL','WEBHOOK_OFICIAL','BANCO_AUTORIZADO'];
    if (!tiposPermitidos.includes(tipo)) throw new Error(`Tipo deve ser um de: ${tiposPermitidos.join(', ')} - NUNCA inventar endpoint`);
    const integracao = await prisma.integracaoPDV.create({
      data: { empresaId: req.user.empresaId, nome, tipo, url, status: 'NAO_CONFIGURADO', origem: 'INTEGRACAO' }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'IntegracaoPDV', entidadeId: integracao.id, valorNovo: integracao, origem: 'INTEGRACAO', ip: req.ip });
    return integracao;
  });

  app.post('/pdv/sincronizar/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] }, async (req:any, reply:any) => {
    const { id } = req.params;
    const integracao = await prisma.integracaoPDV.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!integracao) return reply.status(404).send({ error: 'Integração não encontrada.' });
    return reply.status(409).send({
      error: 'Sincronização não executada.',
      motivo: 'Nenhum fornecedor de PDV foi configurado com credenciais e método oficial neste projeto. O NEXUS OS não simula uma sincronização.',
      status: integracao.status
    });
  });
}

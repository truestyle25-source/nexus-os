import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { avaliarStatusFiscal } from './fiscal.status.js';

export async function fiscalRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/fiscal/status',
    { preHandler: [app.authenticate, await permissaoMiddleware('fiscal', 'visualizar')] },
    async (req: FastifyRequest, reply) => {
      const tokenUser = (req as any).user as { id: string; empresaId: string };
      const user = await prisma.usuario.findUnique({
        where: { id: tokenUser.id },
        select: { empresaId: true, filialId: true },
      });
      if (!user || user.empresaId !== tokenUser.empresaId) {
        return reply.status(403).send({ error: 'Acesso fiscal não autorizado.' });
      }
      const empresa = await prisma.empresa.findUnique({
        where: { id: user.empresaId },
        select: {
          cnpj: true,
          inscricaoEstadual: true,
          cep: true,
          endereco: true,
          cidade: true,
          estado: true,
          filiais: {
            where: user.filialId ? { id: user.filialId, empresaId: user.empresaId } : undefined,
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, cnpj: true, cidade: true, estado: true },
          },
        },
      });

      if (!empresa) return reply.status(404).send({ error: 'Empresa não encontrada.' });
      const { filiais, ...cadastroEmpresa } = empresa;
      return avaliarStatusFiscal(cadastroEmpresa, filiais);
    },
  );
}

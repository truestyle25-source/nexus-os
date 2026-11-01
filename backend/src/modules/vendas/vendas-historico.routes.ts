import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';

export async function historicoVenda(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const logs = await prisma.auditoria.findMany({
    where: { entidade: 'Venda', entidadeId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return reply.send(logs);
}
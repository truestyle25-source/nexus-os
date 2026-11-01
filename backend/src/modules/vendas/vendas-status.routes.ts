import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { StatusVenda } from '@prisma/client';

export async function setStatusAberta(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { status } = request.body as { status: StatusVenda };
  if (status !== StatusVenda.ABERTA) {
    return reply.status(400).send({ error: 'Somente status ABERTA é aceito' });
  }
  const venda = await prisma.venda.update({
    where: { id },
    data: { status },
  });
  return reply.send(venda);
}
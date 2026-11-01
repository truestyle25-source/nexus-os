import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

const hashChave = (chave: string): string => createHash('sha256').update(chave).digest('hex');

/**
 * Autenticação da API pública (Seção 36) — SEPARADA da autenticação de
 * usuário (`app.authenticate`, JWT). Uma chave de API autentica um
 * SISTEMA externo, não uma pessoa: não tem `req.user`, não pode chamar
 * rotas internas do produto, só as expostas sob `/api/v1/*` e só dentro
 * do escopo com que a chave foi criada.
 *
 * Cabeçalho esperado: `Authorization: Bearer nx_<prefixo>_<segredo>`.
 */
export function apiKeyAuth(escopoRequerido: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const chave = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!chave) {
      reply.status(401).send({ error: 'Chave de API ausente. Envie Authorization: Bearer <chave>.' });
      return;
    }
    const registro = await prisma.chaveApi.findUnique({ where: { chaveHash: hashChave(chave) } });
    if (!registro || registro.status !== 'ATIVA') {
      reply.status(401).send({ error: 'Chave de API inválida ou revogada.' });
      return;
    }
    if (!registro.escopos.includes(escopoRequerido)) {
      reply.status(403).send({ error: `Esta chave não tem o escopo necessário: ${escopoRequerido}.` });
      return;
    }
    await prisma.chaveApi.update({ where: { id: registro.id }, data: { ultimoUso: new Date() } });
    (request as any).apiEmpresaId = registro.empresaId;
  };
}

export { hashChave };

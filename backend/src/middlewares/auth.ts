import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import type { Modulo, Acao } from '../lib/permissoes.js';

/**
 * Verifica se o usuário autenticado tem a permissão modulo.acao concedida
 * (Seção 6). Por padrão, a ausência de uma linha em Permissao é NEGADA —
 * nunca assuma acesso liberado por falta de registro.
 *
 * Não repete a checagem de usuário/empresa ativos: isso já é feito uma vez
 * por requisição em `authenticate`, que sempre roda antes deste middleware
 * na cadeia de preHandler.
 */
export function permissaoMiddleware(modulo: Modulo, acao: Acao) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const usuarioId = request.user?.id;
    if (!usuarioId) {
      reply.status(401).send({ error: 'Não autenticado.' });
      return;
    }
    const permissao = await prisma.permissao.findFirst({
      where: { usuarioId, modulo, acao, permitido: true },
      select: { id: true },
    });
    if (!permissao) {
      reply.status(403).send({ error: `Sem permissão: ${modulo}.${acao}` });
      return;
    }
  };
}

/**
 * Decora app.authenticate. Confirma, a cada requisição:
 *  1. que o JWT é válido;
 *  2. que o token não foi revogado (logout — ver TokenRevogado);
 *  3. que o usuário ainda está ATIVO;
 *  4. que a empresa (tenant) do usuário ainda está ATIVA — uma empresa
 *     suspensa (ex.: inadimplência na Assinatura, Seção 15/Fase 3) perde
 *     acesso mesmo com um token ainda válido.
 */
export function registerAuthentication(app: FastifyInstance): void {
  app.decorate('authenticate', async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Não autenticado.' });
      return;
    }

    const { id, empresaId, jti } = request.user;

    if (jti) {
      const revogado = await prisma.tokenRevogado.findUnique({ where: { jti }, select: { jti: true } });
      if (revogado) {
        reply.status(401).send({ error: 'Sessão revogada. Faça login novamente.' });
        return;
      }
    }

    const usuario = await prisma.usuario.findFirst({
      where: { id, empresaId, status: 'ATIVO' },
      select: { empresa: { select: { status: true } } },
    });
    if (!usuario) {
      reply.status(401).send({ error: 'Sessão inválida.' });
      return;
    }
    if (usuario.empresa.status !== 'ATIVO') {
      reply.status(403).send({ error: 'Empresa suspensa. Contate o suporte.' });
      return;
    }
  });
}

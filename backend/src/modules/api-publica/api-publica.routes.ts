import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { apiKeyAuth, hashChave } from '../../middlewares/apiKeyAuth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { NaoEncontrado, ErroDeNegocio } from '../../lib/erros.js';

const ESCOPOS_VALIDOS = ['produtos:leitura', 'estoque:leitura', 'vendas:leitura', 'clientes:leitura'] as const;

/**
 * Seção 36 — arquitetura para futuramente oferecer uma API própria a
 * sistemas externos (ERPs, e-commerce, apps). Duas partes:
 *
 * 1. Gestão de chaves (`/api-publica/chaves*`) — autenticada como
 *    qualquer outra tela do produto (JWT de usuário + permissão
 *    `api_publica`). É aqui que uma pessoa logada cria/revoga chaves
 *    para os sistemas que vai integrar.
 * 2. Endpoints públicos (`/api/v1/*`) — autenticados por
 *    `apiKeyAuth(escopo)`, somente leitura por enquanto. Cada chave só
 *    acessa os dados da própria empresa (`apiEmpresaId`), nunca de
 *    outra — o mesmo isolamento multi-empresa que o resto do sistema já
 *    tem via `empresaId`.
 *
 * Deliberadamente pequeno e só leitura nesta fase: expor escrita
 * (criar venda, alterar estoque) via chave de API sem um sistema real
 * integrado para testar contra seria inventar comportamento não
 * validado — o prompt mestre pede exatamente para evitar isso.
 */
export async function apiPublicaRoutes(app: FastifyInstance): Promise<void> {
  // ----------------------- Gestão de chaves -----------------------
  app.get(
    '/api-publica/chaves',
    { preHandler: [app.authenticate, await permissaoMiddleware('api_publica', 'visualizar')] },
    async (req: FastifyRequest) => {
      const chaves = await prisma.chaveApi.findMany({
        where: { empresaId: (req as any).user.empresaId },
        select: { id: true, nome: true, prefixo: true, escopos: true, status: true, ultimoUso: true, createdAt: true, revogadaEm: true },
        orderBy: { createdAt: 'desc' },
      });
      return chaves;
    },
  );

  app.post(
    '/api-publica/chaves',
    { preHandler: [app.authenticate, await permissaoMiddleware('api_publica', 'criar')] },
    async (req: FastifyRequest) => {
      const { nome, escopos } = z.object({ nome: z.string().min(2), escopos: z.array(z.enum(ESCOPOS_VALIDOS)).min(1) }).parse(req.body);
      const user = (req as any).user;
      const segredo = randomBytes(24).toString('hex');
      const prefixo = `nx_${randomBytes(3).toString('hex')}`;
      const chaveCompleta = `${prefixo}_${segredo}`;
      const registro = await prisma.chaveApi.create({
        data: { empresaId: user.empresaId, nome, chaveHash: hashChave(chaveCompleta), prefixo, escopos, criadaPorUsuarioId: user.id },
      });
      await registrarAuditoria({
        usuarioId: user.id, empresaId: user.empresaId, acao: 'CRIAR', entidade: 'ChaveApi', entidadeId: registro.id,
        valorNovo: { nome, prefixo, escopos }, origem: 'MANUAL', ip: req.ip,
      });
      // A chave completa só existe nesta resposta — o hash é o único
      // registro em banco. Se o usuário perder, precisa gerar outra.
      return { id: registro.id, nome, prefixo, escopos, chave: chaveCompleta, aviso: 'Guarde esta chave agora — ela não será mostrada novamente.' };
    },
  );

  app.post(
    '/api-publica/chaves/:id/revogar',
    { preHandler: [app.authenticate, await permissaoMiddleware('api_publica', 'excluir')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const chave = await prisma.chaveApi.findFirst({ where: { id, empresaId: user.empresaId } });
      if (!chave) throw NaoEncontrado('Chave de API não encontrada nesta empresa.');
      if (chave.status === 'REVOGADA') throw new ErroDeNegocio('Esta chave já está revogada.', 409);
      const atualizada = await prisma.chaveApi.update({ where: { id }, data: { status: 'REVOGADA', revogadaEm: new Date() } });
      await registrarAuditoria({
        usuarioId: user.id, empresaId: user.empresaId, acao: 'EXCLUIR', entidade: 'ChaveApi', entidadeId: id,
        valorAnterior: { status: 'ATIVA' }, valorNovo: { status: 'REVOGADA' }, origem: 'MANUAL', ip: req.ip,
      });
      return atualizada;
    },
  );

  // ----------------------- Endpoints públicos -----------------------
  app.get('/api/v1/produtos', { preHandler: apiKeyAuth('produtos:leitura') }, async (req: FastifyRequest) => {
    const empresaId = (req as any).apiEmpresaId;
    return prisma.produto.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true, nome: true, sku: true, precoVenda: true, unidade: true }, take: 200 });
  });

  app.get('/api/v1/estoque', { preHandler: apiKeyAuth('estoque:leitura') }, async (req: FastifyRequest) => {
    const empresaId = (req as any).apiEmpresaId;
    return prisma.estoque.findMany({ where: { empresaId }, include: { produto: { select: { nome: true, sku: true } }, filial: { select: { nome: true } } }, take: 500 });
  });

  app.get('/api/v1/vendas', { preHandler: apiKeyAuth('vendas:leitura') }, async (req: FastifyRequest) => {
    const empresaId = (req as any).apiEmpresaId;
    return prisma.venda.findMany({ where: { empresaId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, total: true, status: true, createdAt: true } });
  });

  app.get('/api/v1/clientes', { preHandler: apiKeyAuth('clientes:leitura') }, async (req: FastifyRequest) => {
    const empresaId = (req as any).apiEmpresaId;
    return prisma.cliente.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true, nome: true, email: true, telefone: true }, take: 200 });
  });
}

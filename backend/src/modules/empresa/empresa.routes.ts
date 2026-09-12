import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { NaoAutorizado, NaoEncontrado } from '../../lib/erros.js';
import { criarEstoqueParaFilial } from '../estoque/estoque.service.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);

export async function empresaRoutes(app: FastifyInstance): Promise<void> {
  // Não existe endpoint para criar uma empresa nova a partir de uma sessão já
  // autenticada: o único jeito de nascer uma Empresa é POST /auth/register-
  // company (auth.routes.ts), que também cria a filial, o usuário fundador
  // e a assinatura na mesma transação. Um endpoint solto "POST /empresas"
  // existia aqui antes: ele criava uma Empresa órfã (sem filial, sem
  // usuário, sem assinatura) e ficava acessível a qualquer usuário com a
  // permissão genérica empresa.criar — que hoje é todo usuário fundador,
  // já que o cadastro concede todas as permissões. Isso não é uma segunda
  // empresa "legítima" no modelo atual (1 usuário pertence a exatamente 1
  // empresa via Usuario.empresaId): era código morto/inconsistente com o
  // isolamento por tenant, então foi removido nesta fase. Se no futuro o
  // NEXUS OS precisar de multiempresa POR USUÁRIO (ex.: um contador
  // atendendo várias empresas) ou de um papel de administrador de
  // plataforma, isso é uma decisão de schema (tabela de associação
  // Usuario<->Empresa) que precisa ser tomada explicitamente — não recriar
  // este endpoint sem resolver isso primeiro.

  // Retorna a empresa do usuário autenticado (nunca outra, mesmo que
  // alguém tente adivinhar um id — o filtro é sempre req.user.empresaId).
  app.get(
    '/empresas',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.empresa.findMany({ where: { id: req.user.empresaId }, include: { filiais: true, setores: true } });
    },
  );

  // Filiais - Seção 4
  app.post(
    '/filiais',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        empresaId: z.string(),
        nome: z.string().min(2),
        cnpj: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      if (data.empresaId !== req.user.empresaId) throw NaoAutorizado('Empresa inválida para esta sessão.');
      const filial = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const nova = await tx.filial.create({
          data: { empresaId: data.empresaId, nome: data.nome, cnpj: data.cnpj, cidade: data.cidade, estado: data.estado, origem: data.origem },
        });
        // Mantém o invariante Produto×Filial (ver estoque.service.ts):
        // uma filial nova precisa de uma linha de Estoque (quantidade 0)
        // para cada produto ativo já existente na empresa.
        await criarEstoqueParaFilial(tx, data.empresaId, nova.id);
        return nova;
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: data.empresaId,
        acao: 'CRIAR',
        entidade: 'Filial',
        entidadeId: filial.id,
        valorNovo: filial,
        origem: data.origem,
        ip: req.ip,
      });
      return filial;
    },
  );

  // Setores - Seção 4
  app.post(
    '/setores',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({ empresaId: z.string(), filialId: z.string().optional(), nome: z.string().min(2), descricao: z.string().optional() });
      const data = schema.parse(req.body);
      if (data.empresaId !== req.user.empresaId) throw NaoAutorizado('Empresa inválida para esta sessão.');
      if (data.filialId) {
        const filial = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
        if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');
      }
      return prisma.setor.create({ data });
    },
  );

  app.get(
    '/setores',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.setor.findMany({ where: { empresaId: req.user.empresaId } });
    },
  );
}

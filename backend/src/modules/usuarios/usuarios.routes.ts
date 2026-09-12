import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashSenha } from '../../lib/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { MODULOS, ACOES } from '../../lib/permissoes.js';
import { Conflito, NaoEncontrado } from '../../lib/erros.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);
// Valida modulo/acao contra o catálogo central (lib/permissoes.ts) em vez de
// aceitar qualquer string: evita permissões "fantasma" por erro de digitação
// que nunca vão bater com nenhuma checagem real de permissaoMiddleware.
const permissaoSchema = z.object({ modulo: z.enum(MODULOS), acao: z.enum(ACOES), permitido: z.boolean() });

export async function usuariosRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/usuarios',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.usuario.findMany({
        where: { empresaId: req.user.empresaId },
        select: { id: true, nome: true, email: true, status: true, filialId: true, setorId: true, origem: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
    },
  );

  app.post(
    '/usuarios',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        nome: z.string().min(2),
        email: z.string().email(),
        senha: z.string().min(6),
        filialId: z.string().optional(),
        setorId: z.string().optional(),
        permissoes: z.array(permissaoSchema).optional(),
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      if (data.filialId) {
        const filial = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
        if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');
      }
      if (data.setorId) {
        const setor = await prisma.setor.findFirst({ where: { id: data.setorId, empresaId: req.user.empresaId } });
        if (!setor) throw NaoEncontrado('Setor inválido para esta empresa.');
      }
      const email = data.email.toLowerCase().trim();
      if (await prisma.usuario.findUnique({ where: { email } })) throw Conflito('E-mail já cadastrado.');
      const senhaHash = await hashSenha(data.senha);
      const usuario = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const novo = await tx.usuario.create({
          data: { empresaId: req.user.empresaId, filialId: data.filialId, setorId: data.setorId, nome: data.nome, email, senhaHash, origem: data.origem },
        });
        if (data.permissoes) {
          for (const p of data.permissoes) {
            await tx.permissao.create({ data: { usuarioId: novo.id, modulo: p.modulo, acao: p.acao, permitido: p.permitido, origem: data.origem } });
          }
        }
        return novo;
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Usuario',
        entidadeId: usuario.id,
        valorNovo: { nome: data.nome, email: data.email },
        origem: data.origem,
        ip: req.ip,
      });
      return { id: usuario.id, nome: usuario.nome, email: usuario.email };
    },
  );

  app.put(
    '/usuarios/:id/permissoes',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const { permissoes } = z.object({ permissoes: z.array(permissaoSchema) }).parse(req.body);
      const alvo = await prisma.usuario.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!alvo) throw NaoEncontrado('Usuário não encontrado nesta empresa.');
      const anterior = await prisma.permissao.findMany({ where: { usuarioId: id } });
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.permissao.deleteMany({ where: { usuarioId: id } });
        for (const p of permissoes) {
          await tx.permissao.create({ data: { usuarioId: id, modulo: p.modulo, acao: p.acao, permitido: p.permitido, origem: 'MANUAL' } });
        }
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'ALTERAR_PERMISSAO',
        entidade: 'Permissao',
        entidadeId: id,
        valorAnterior: anterior,
        valorNovo: permissoes,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: `Alteração permissões usuario ${id}`,
      });
      return { ok: true };
    },
  );

  app.get(
    '/auditoria',
    { preHandler: [app.authenticate, await permissaoMiddleware('auditoria', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.auditoria.findMany({
        where: { empresaId: req.user.empresaId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { usuario: { select: { nome: true, email: true } } },
      });
    },
  );
}

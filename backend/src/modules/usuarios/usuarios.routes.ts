import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashSenha } from '../../lib/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { MODULOS, ACOES } from '../../lib/permissoes.js';
import { PERMISSOES_ESPECIAIS, ehPermissaoEspecial, CARGOS, permissoesDoCargo, ROTULO_CARGO } from '../../lib/permissoes-catalogo.js';
import { Conflito, NaoEncontrado } from '../../lib/erros.js';
import { comoSistema } from '../../lib/tenant-context.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);
// Valida modulo/acao contra o catálogo central (lib/permissoes.ts) em vez de
// aceitar qualquer string: evita permissões "fantasma" por erro de digitação
// que nunca vão bater com nenhuma checagem real de permissaoMiddleware.
const especialSchema = z.object({ modulo: z.string(), acao: z.string(), permitido: z.boolean() })
  .refine((p) => ehPermissaoEspecial(p.modulo, p.acao), 'Permissão inexistente no catálogo.');
const permissaoSchema = z.union([
  z.object({ modulo: z.enum(MODULOS), acao: z.enum(ACOES), permitido: z.boolean() }),
  especialSchema,
]);
const filtroEspeciais = PERMISSOES_ESPECIAIS.map((p) => ({ modulo: p.modulo, acao: p.acao }));

export async function usuariosRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/usuarios',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.usuario.findMany({
        where: { empresaId: req.user.empresaId },
        select: { id: true, nome: true, email: true, status: true, filialId: true, setorId: true, origem: true, cargo: true, createdAt: true },
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
        // Cargo de referência: quando vem, as permissões são as do cargo
        // (definidas no catálogo) e a lista "permissoes" é ignorada.
        cargo: z.enum(CARGOS).optional(),
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
      // E-mail é único no sistema inteiro (login): a checagem precisa enxergar
      // usuários de outras empresas (RLS). Só o id é lido.
      const emailEmUso = await comoSistema('usuarios:email-unico', () =>
        prisma.usuario.findUnique({ where: { email }, select: { id: true } }),
      );
      if (emailEmUso) throw Conflito('E-mail já cadastrado.');
      const senhaHash = await hashSenha(data.senha);
      const usuario = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const novo = await tx.usuario.create({
          data: { empresaId: req.user.empresaId, filialId: data.filialId, setorId: data.setorId, nome: data.nome, email, senhaHash, origem: data.origem, cargo: data.cargo ?? null },
        });
        const lista = data.cargo ? permissoesDoCargo(data.cargo).map((p) => ({ ...p, permitido: true })) : data.permissoes;
        if (lista) {
          for (const p of lista) {
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
        valorNovo: { nome: data.nome, email: data.email, cargo: data.cargo ?? null },
        origem: data.origem,
        ip: req.ip,
      });
      return { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo };
    },
  );

  // Troca o cargo: as permissões passam a ser exatamente as do novo cargo.
  app.put(
    '/usuarios/:id/cargo',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'editar')] },
    async (req: FastifyRequest, reply: any) => {
      const { id } = req.params as { id: string };
      const { cargo } = z.object({ cargo: z.enum(CARGOS) }).parse(req.body);
      if (id === req.user.id) return reply.code(403).send({ error: 'Você não pode trocar o próprio cargo. Peça a outro gestor.' });
      const alvo = await prisma.usuario.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true, cargo: true } });
      if (!alvo) throw NaoEncontrado('Usuário não encontrado nesta empresa.');
      const anterior = await prisma.permissao.findMany({ where: { usuarioId: id }, select: { modulo: true, acao: true, permitido: true } });
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.permissao.deleteMany({ where: { usuarioId: id } });
        for (const p of permissoesDoCargo(cargo)) {
          await tx.permissao.create({ data: { usuarioId: id, modulo: p.modulo, acao: p.acao, permitido: true, origem: 'MANUAL' } });
        }
        await tx.usuario.update({ where: { id }, data: { cargo } });
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'ALTERAR_PERMISSAO',
        entidade: 'Usuario',
        entidadeId: id,
        valorAnterior: { cargo: alvo.cargo, permissoes: anterior },
        valorNovo: { cargo },
        origem: 'MANUAL',
        ip: req.ip,
        contexto: `Cargo alterado para ${ROTULO_CARGO[cargo]}`,
      });
      return { ok: true, cargo };
    },
  );

  // Alçadas do caixa (supervisor, descontos): liga/desliga SÓ essas, sem
  // mexer nas demais permissões do usuário.
  app.get(
    '/usuarios/:id/permissoes-especiais',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const alvo = await prisma.usuario.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true } });
      if (!alvo) throw NaoEncontrado('Usuário não encontrado nesta empresa.');
      const atuais = await prisma.permissao.findMany({ where: { usuarioId: id, permitido: true, OR: filtroEspeciais }, select: { modulo: true, acao: true } });
      return { permissoes: PERMISSOES_ESPECIAIS.map((p) => ({ ...p, permitido: atuais.some((a) => a.modulo === p.modulo && a.acao === p.acao) })) };
    },
  );

  app.patch(
    '/usuarios/:id/permissoes-especiais',
    { preHandler: [app.authenticate, await permissaoMiddleware('usuarios', 'editar')] },
    async (req: FastifyRequest, reply: any) => {
      const { id } = req.params as { id: string };
      const { permissoes } = z.object({ permissoes: z.array(especialSchema).min(1) }).parse(req.body);
      // Ninguém concede alçada a si mesmo.
      if (id === req.user.id) return reply.code(403).send({ error: 'Você não pode alterar as próprias alçadas do caixa. Peça a outro administrador.' });
      const alvo = await prisma.usuario.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true } });
      if (!alvo) throw NaoEncontrado('Usuário não encontrado nesta empresa.');
      const anterior = await prisma.permissao.findMany({ where: { usuarioId: id, OR: filtroEspeciais }, select: { modulo: true, acao: true, permitido: true } });
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const p of permissoes) {
          await tx.permissao.deleteMany({ where: { usuarioId: id, modulo: p.modulo, acao: p.acao } });
          if (p.permitido) await tx.permissao.create({ data: { usuarioId: id, modulo: p.modulo, acao: p.acao, permitido: true, origem: 'MANUAL' } });
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
        contexto: `Alteração das alçadas do caixa do usuario ${id}`,
      });
      return { ok: true };
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

import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { NaoEncontrado, ErroDeNegocio } from '../../lib/erros.js';

/**
 * LGPD — Seção 38 do prompt mestre.
 *
 * Duas operações por titular de dado (Cliente, Funcionário, e a própria
 * conta do usuário logado): EXPORTAR (devolver tudo que o sistema guarda
 * sobre a pessoa) e ANONIMIZAR (apagar os identificadores pessoais,
 * mantendo o registro transacional/trabalhista que a lei exige guardar
 * para fins fiscais e de auditoria).
 *
 * Decisão importante e deliberada: isto é ANONIMIZAÇÃO, não exclusão
 * física (DELETE). Vendas e recibos de um cliente, ou os registros de
 * ponto/férias de um funcionário, não podem simplesmente desaparecer —
 * são exigidos por legislação fiscal/trabalhista (é o próprio "quando
 * legalmente aplicável" do prompt). O que a LGPD garante é que o dado
 * PESSOAL (nome, documento, contato) pare de identificar a pessoa; o
 * histórico numérico/transacional permanece para obrigações legais e
 * para as métricas do sistema não ficarem incoerentes.
 */
export async function lgpdRoutes(app: FastifyInstance): Promise<void> {
  // ------------------------- Cliente -------------------------
  app.get(
    '/lgpd/clientes/:id/exportar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('clientes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const cliente = await prisma.cliente.findFirst({ where: { id, empresaId: (req as any).user.empresaId } });
      if (!cliente) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      const vendas = await prisma.venda.findMany({
        where: { clienteId: id, empresaId: (req as any).user.empresaId },
        include: { itens: true },
        orderBy: { createdAt: 'desc' },
      });
      return { titular: cliente, vendas, exportadoEm: new Date().toISOString() };
    },
  );

  app.post(
    '/lgpd/clientes/:id/anonimizar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('clientes', 'excluir')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const anterior = await prisma.cliente.findFirst({ where: { id, empresaId: user.empresaId } });
      if (!anterior) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      if (anterior.nome.startsWith('[Titular anonimizado')) throw new ErroDeNegocio('Este cliente já foi anonimizado.', 409);
      const cliente = await prisma.cliente.update({
        where: { id },
        data: {
          nome: `[Titular anonimizado ${new Date().toISOString().slice(0, 10)}]`,
          documento: null,
          telefone: null,
          email: null,
          endereco: null,
          status: 'ARQUIVADO',
        },
      });
      await registrarAuditoria({
        usuarioId: user.id,
        empresaId: user.empresaId,
        acao: 'EXCLUIR',
        entidade: 'Cliente',
        entidadeId: id,
        valorAnterior: { nome: anterior.nome, documento: anterior.documento, telefone: anterior.telefone, email: anterior.email, endereco: anterior.endereco },
        valorNovo: { anonimizado: true },
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Anonimização LGPD — histórico de vendas preservado para obrigações fiscais.',
      });
      return { anonimizado: true, cliente };
    },
  );

  // ----------------------- Funcionário -----------------------
  app.get(
    '/lgpd/funcionarios/:id/exportar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const empresaId = (req as any).user.empresaId;
      const funcionario = await prisma.funcionario.findFirst({ where: { id, empresaId } });
      if (!funcionario) throw NaoEncontrado('Funcionário não encontrado nesta empresa.');
      const [pontos, advertencias, ferias] = await Promise.all([
        prisma.ponto.findMany({ where: { funcionarioId: id }, orderBy: { data: 'desc' }, take: 200 }),
        prisma.advertencia.findMany({ where: { funcionarioId: id } }),
        prisma.ferias.findMany({ where: { funcionarioId: id } }),
      ]);
      return { titular: funcionario, pontos, advertencias, ferias, exportadoEm: new Date().toISOString() };
    },
  );

  app.post(
    '/lgpd/funcionarios/:id/anonimizar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const user = (req as any).user;
      const anterior = await prisma.funcionario.findFirst({ where: { id, empresaId: user.empresaId } });
      if (!anterior) throw NaoEncontrado('Funcionário não encontrado nesta empresa.');
      if (!anterior.dataDesligamento) throw new ErroDeNegocio('Só é possível anonimizar um funcionário já desligado (obrigações trabalhistas exigem manter o vínculo identificável enquanto ativo).', 409);
      if (anterior.nome.startsWith('[Titular anonimizado')) throw new ErroDeNegocio('Este funcionário já foi anonimizado.', 409);
      const funcionario = await prisma.funcionario.update({
        where: { id },
        data: { nome: `[Titular anonimizado ${new Date().toISOString().slice(0, 10)}]`, cpf: null, idExternoPonto: null },
      });
      await registrarAuditoria({
        usuarioId: user.id,
        empresaId: user.empresaId,
        acao: 'EXCLUIR',
        entidade: 'Funcionario',
        entidadeId: id,
        valorAnterior: { nome: anterior.nome, cpf: anterior.cpf },
        valorNovo: { anonimizado: true },
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Anonimização LGPD — pontos/advertências/férias preservados para obrigações trabalhistas.',
      });
      return { anonimizado: true, funcionario };
    },
  );

  // -------------------- Própria conta (usuário logado) --------------------
  app.get('/lgpd/minha-conta/exportar', { preHandler: [(app as any).authenticate] }, async (req: FastifyRequest) => {
    const user = (req as any).user;
    const usuario = await prisma.usuario.findFirst({
      where: { id: user.id, empresaId: user.empresaId },
      select: { id: true, nome: true, email: true, status: true, ultimoLogin: true, createdAt: true, permissoes: true },
    });
    if (!usuario) throw NaoEncontrado('Usuário não encontrado.');
    const auditoria = await prisma.auditoria.findMany({ where: { usuarioId: user.id, empresaId: user.empresaId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { titular: usuario, auditoria, exportadoEm: new Date().toISOString() };
  });
}


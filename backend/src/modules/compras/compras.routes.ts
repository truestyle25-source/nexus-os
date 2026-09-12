import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { temPermissao } from '../../lib/permissoes.js';
import { NaoEncontrado, Conflito, ErroDeNegocio } from '../../lib/erros.js';
import { clean } from '../../lib/format.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);

function ocultarCustoUnico<T extends { valorUnit?: unknown }>(item: T): Omit<T, 'valorUnit'> {
  const { valorUnit: _v, ...resto } = item;
  return resto;
}

export async function comprasRoutes(app: FastifyInstance): Promise<void> {
  // ===================== Fornecedores (Seção 11) =====================
  app.get(
    '/fornecedores',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({ search: z.string().optional(), status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']).optional() })
        .parse(req.query);
      return prisma.fornecedor.findMany({
        where: {
          empresaId: req.user.empresaId,
          ...(query.search ? { nome: { contains: query.search, mode: 'insensitive' } } : {}),
          ...(query.status ? { status: query.status } : { status: { in: ['ATIVO', 'INATIVO'] } }),
        },
        orderBy: { nome: 'asc' },
      });
    },
  );

  app.get(
    '/fornecedores/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const fornecedor = await prisma.fornecedor.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!fornecedor) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
      const historicoCompras = await prisma.compra.findMany({
        where: { fornecedorId: id, empresaId: req.user.empresaId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, valorTotal: true, status: true, dataCompra: true, dataRecebimento: true, filial: { select: { nome: true } } },
      });
      return { ...fornecedor, historicoCompras };
    },
  );

  const fornecedorSchema = z.object({
    nome: z.string().min(2),
    cnpjCpf: z.string().optional(),
    contato: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().email().optional(),
    endereco: z.string().optional(),
    origem: origemSchema.default('MANUAL'),
  });

  app.post(
    '/fornecedores',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'criar')] },
    async (req: FastifyRequest) => {
      const data = fornecedorSchema.parse(req.body);
      const cnpjCpf = clean(data.cnpjCpf);
      if (cnpjCpf) {
        const existente = await prisma.fornecedor.findFirst({ where: { empresaId: req.user.empresaId, cnpjCpf } });
        if (existente) throw Conflito('Já existe um fornecedor com este CNPJ/CPF nesta empresa.');
      }
      const fornecedor = await prisma.fornecedor.create({ data: { empresaId: req.user.empresaId, ...data, cnpjCpf, origem: data.origem } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Fornecedor',
        entidadeId: fornecedor.id,
        valorNovo: fornecedor,
        origem: data.origem,
        ip: req.ip,
      });
      return fornecedor;
    },
  );

  app.put(
    '/fornecedores/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const data = fornecedorSchema.partial().parse(req.body);
      const anterior = await prisma.fornecedor.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
      const cnpjCpf = data.cnpjCpf !== undefined ? clean(data.cnpjCpf) : undefined;
      if (cnpjCpf && cnpjCpf !== anterior.cnpjCpf) {
        const existente = await prisma.fornecedor.findFirst({ where: { empresaId: req.user.empresaId, cnpjCpf, NOT: { id } } });
        if (existente) throw Conflito('Já existe um fornecedor com este CNPJ/CPF nesta empresa.');
      }
      const fornecedor = await prisma.fornecedor.update({ where: { id }, data: { ...data, cnpjCpf, updatedAt: new Date() } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Fornecedor',
        entidadeId: id,
        valorAnterior: anterior,
        valorNovo: fornecedor,
        origem: data.origem || 'MANUAL',
        ip: req.ip,
      });
      return fornecedor;
    },
  );

  app.patch(
    '/fornecedores/:id/status',
    { preHandler: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { status } = z.object({ status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']) }).parse(req.body);
      const acao = status === 'ARQUIVADO' ? 'excluir' : 'editar';
      if (!(await temPermissao(req.user.id, 'fornecedores', acao))) return reply.status(403).send({ error: `Sem permissão: fornecedores.${acao}` });
      const anterior = await prisma.fornecedor.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
      const fornecedor = await prisma.fornecedor.update({ where: { id }, data: { status } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: status === 'ARQUIVADO' ? 'EXCLUIR' : 'EDITAR',
        entidade: 'Fornecedor',
        entidadeId: id,
        valorAnterior: { status: anterior.status },
        valorNovo: { status },
        origem: 'MANUAL',
        ip: req.ip,
      });
      return fornecedor;
    },
  );

  // ===================== Compras (Seção 10) =====================
  app.get(
    '/compras',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          filialId: z.string().optional(),
          fornecedorId: z.string().optional(),
          status: z.enum(['SOLICITADA', 'PEDIDO', 'RECEBIDA', 'CANCELADA']).optional(),
          take: z.coerce.number().int().min(1).max(200).default(50),
          skip: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const where: Prisma.CompraWhereInput = {
        empresaId: req.user.empresaId,
        ...(query.filialId ? { filialId: query.filialId } : {}),
        ...(query.fornecedorId ? { fornecedorId: query.fornecedorId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const [compras, total] = await Promise.all([
        prisma.compra.findMany({
          where,
          include: { fornecedor: true, filial: { select: { nome: true } }, itens: { include: { produto: { select: { nome: true, sku: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: query.take,
          skip: query.skip,
        }),
        prisma.compra.count({ where }),
      ]);
      return { compras, total, take: query.take, skip: query.skip };
    },
  );

  app.get(
    '/compras/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const compra = await prisma.compra.findFirst({
        where: { id, empresaId: req.user.empresaId },
        include: { fornecedor: true, filial: true, itens: { include: { produto: true } } },
      });
      if (!compra) throw NaoEncontrado('Compra não encontrada nesta empresa.');
      return compra;
    },
  );

  const itensSchema = z.array(z.object({ produtoId: z.string(), quantidade: z.number().int().positive(), valorUnit: z.number().positive() })).min(1);

  app.post(
    '/compras',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        filialId: z.string(),
        fornecedorId: z.string(),
        condPagamento: z.string().optional(),
        itens: itensSchema,
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      const filial = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
      if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');
      const fornecedor = await prisma.fornecedor.findFirst({ where: { id: data.fornecedorId, empresaId: req.user.empresaId, status: 'ATIVO' } });
      if (!fornecedor) throw NaoEncontrado('Fornecedor inválido para esta empresa (ou inativo).');
      for (const item of data.itens) {
        const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, empresaId: req.user.empresaId } });
        if (!produto) throw NaoEncontrado(`Produto ${item.produtoId} inválido para esta empresa.`);
      }
      const valorTotal = data.itens.reduce((soma: number, i: { quantidade: number; valorUnit: number }) => soma + i.quantidade * i.valorUnit, 0);
      const compra = await prisma.compra.create({
        data: {
          empresaId: req.user.empresaId,
          filialId: data.filialId,
          fornecedorId: data.fornecedorId,
          valorTotal,
          condPagamento: data.condPagamento,
          origem: data.origem,
          itens: { create: data.itens.map((i: { produtoId: string; quantidade: number; valorUnit: number }) => ({ produtoId: i.produtoId, quantidade: i.quantidade, valorUnit: i.valorUnit })) },
        },
        include: { itens: true },
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Compra',
        entidadeId: compra.id,
        valorNovo: compra,
        origem: data.origem,
        ip: req.ip,
      });
      return compra;
    },
  );

  // Edição só é permitida enquanto a compra ainda não foi confirmada com o
  // fornecedor (SOLICITADA) — depois de PEDIDO/RECEBIDA, mudar itens
  // silenciosamente divergiria do que foi de fato negociado/recebido.
  app.put(
    '/compras/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const schema = z.object({ condPagamento: z.string().optional(), itens: itensSchema.optional() });
      const data = schema.parse(req.body);
      const anterior = await prisma.compra.findFirst({ where: { id, empresaId: req.user.empresaId }, include: { itens: true } });
      if (!anterior) throw NaoEncontrado('Compra não encontrada nesta empresa.');
      if (anterior.status !== 'SOLICITADA') throw new ErroDeNegocio('Só é possível editar uma compra enquanto o status for SOLICITADA.', 409);
      if (data.itens) {
        for (const item of data.itens) {
          const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, empresaId: req.user.empresaId } });
          if (!produto) throw NaoEncontrado(`Produto ${item.produtoId} inválido para esta empresa.`);
        }
      }
      const valorTotal = data.itens ? data.itens.reduce((soma: number, i: { quantidade: number; valorUnit: number }) => soma + i.quantidade * i.valorUnit, 0) : Number(anterior.valorTotal);
      const compra = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (data.itens) {
          await tx.compraItem.deleteMany({ where: { compraId: id } });
          await tx.compraItem.createMany({ data: data.itens.map((i: { produtoId: string; quantidade: number; valorUnit: number }) => ({ compraId: id, produtoId: i.produtoId, quantidade: i.quantidade, valorUnit: i.valorUnit })) });
        }
        return tx.compra.update({
          where: { id },
          data: { condPagamento: data.condPagamento, valorTotal },
          include: { itens: true },
        });
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Compra',
        entidadeId: id,
        valorAnterior: anterior,
        valorNovo: compra,
        origem: 'MANUAL',
        ip: req.ip,
      });
      return compra;
    },
  );

  // SOLICITADA -> PEDIDO: confirma que o pedido foi feito ao fornecedor.
  app.post(
    '/compras/:id/confirmar',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const compra = await prisma.compra.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!compra) throw NaoEncontrado('Compra não encontrada.');
      if (compra.status !== 'SOLICITADA') throw new ErroDeNegocio(`Não é possível confirmar uma compra com status ${compra.status}.`, 409);
      const atualizada = await prisma.compra.update({ where: { id }, data: { status: 'PEDIDO' } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Compra',
        entidadeId: id,
        valorAnterior: { status: compra.status },
        valorNovo: { status: 'PEDIDO' },
        origem: 'MANUAL',
        ip: req.ip,
        contexto: 'Pedido confirmado com o fornecedor',
      });
      return atualizada;
    },
  );

  // Recebimento: usa SEMPRE compra.filialId (decisão arquitetural desta
  // fase — não aceita mais filialId solto no corpo da requisição).
  // COMPRA -> ESTOQUE (via estoque.service.ts, reaproveitado de Estoque) ->
  // CUSTO (produto.custo) -> FINANCEIRO (despesa) -> auditoria.
  app.post(
    '/compras/:id/receber',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const compraAtualizada = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const compra = await tx.compra.findFirst({ where: { id, empresaId: req.user.empresaId }, include: { itens: true } });
        if (!compra) throw NaoEncontrado('Compra não encontrada.');
        if (compra.status === 'RECEBIDA') throw new ErroDeNegocio('Compra já recebida.', 409);
        if (compra.status === 'CANCELADA') throw new ErroDeNegocio('Compra cancelada não pode ser recebida.', 409);

        for (const item of compra.itens) {
          const produto = await tx.produto.findFirst({ where: { id: item.produtoId, empresaId: req.user.empresaId } });
          if (!produto) throw NaoEncontrado('Produto da compra não pertence à empresa.');
          await aplicarMovimento(tx, {
            empresaId: req.user.empresaId,
            filialId: compra.filialId,
            produtoId: item.produtoId,
            usuarioId: req.user.id,
            tipo: 'COMPRA',
            quantidade: item.quantidade,
            motivo: `Recebimento compra ${id}`,
            documento: id,
            origem: compra.origem,
          });
          // Custo do produto passa a refletir o último valor pago — mesma
          // decisão de "custo atual" (não custo médio ponderado) já
          // documentada na Fase 2.
          await tx.produto.update({ where: { id: produto.id }, data: { custo: item.valorUnit } });
        }

        const atualizada = await tx.compra.update({ where: { id }, data: { status: 'RECEBIDA', dataRecebimento: new Date() } });
        await tx.financeiro.create({
          data: {
            empresaId: req.user.empresaId,
            filialId: compra.filialId,
            tipo: 'DESPESA',
            categoria: 'fornecedores',
            descricao: `Compra ${id}`,
            valor: compra.valorTotal,
            status: 'PENDENTE',
            compraId: id,
            origem: compra.origem,
          },
        });
        return atualizada;
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Compra',
        entidadeId: id,
        valorNovo: compraAtualizada,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: `Recebimento transacional ${id} -> Estoque (${compraAtualizada.filialId}) -> Custo -> Financeiro`,
      });
      return compraAtualizada;
    },
  );

  // Cancelamento só antes do recebimento — depois de receber, estoque e
  // financeiro já foram afetados; reverter isso é um fluxo de devolução ao
  // fornecedor, não um cancelamento (fora do escopo desta fase).
  app.post(
    '/compras/:id/cancelar',
    { preHandler: [app.authenticate, await permissaoMiddleware('compras', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const compra = await prisma.compra.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!compra) throw NaoEncontrado('Compra não encontrada.');
      if (compra.status === 'RECEBIDA') throw new ErroDeNegocio('Compra já recebida não pode ser cancelada (use um fluxo de devolução ao fornecedor).', 409);
      if (compra.status === 'CANCELADA') throw new ErroDeNegocio('Compra já está cancelada.', 409);
      const atualizada = await prisma.compra.update({ where: { id }, data: { status: 'CANCELADA' } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Compra',
        entidadeId: id,
        valorAnterior: { status: compra.status },
        valorNovo: { status: 'CANCELADA' },
        origem: 'MANUAL',
        ip: req.ip,
      });
      return atualizada;
    },
  );

  // ===================== Clientes (Seção 12) =====================
  const clienteSchema = z.object({
    nome: z.string().min(2),
    documento: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().email().optional(),
    endereco: z.string().optional(),
    origem: origemSchema.default('MANUAL'),
  });

  app.get(
    '/clientes',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({ search: z.string().optional(), status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']).optional() })
        .parse(req.query);
      return prisma.cliente.findMany({
        where: {
          empresaId: req.user.empresaId,
          ...(query.search ? { nome: { contains: query.search, mode: 'insensitive' } } : {}),
          ...(query.status ? { status: query.status } : { status: { in: ['ATIVO', 'INATIVO'] } }),
        },
        orderBy: { nome: 'asc' },
      });
    },
  );

  app.get(
    '/clientes/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const cliente = await prisma.cliente.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!cliente) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      const historicoVendas = await prisma.venda.findMany({
        where: { clienteId: id, empresaId: req.user.empresaId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, total: true, status: true, createdAt: true, filialId: true },
      });
      return { ...cliente, historicoVendas };
    },
  );

  app.post(
    '/clientes',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'criar')] },
    async (req: FastifyRequest) => {
      const data = clienteSchema.parse(req.body);
      const documento = clean(data.documento);
      if (documento) {
        const existente = await prisma.cliente.findFirst({ where: { empresaId: req.user.empresaId, documento } });
        if (existente) throw Conflito('Já existe um cliente com este documento nesta empresa.');
      }
      const cliente = await prisma.cliente.create({ data: { empresaId: req.user.empresaId, ...data, documento, origem: data.origem } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Cliente',
        entidadeId: cliente.id,
        valorNovo: cliente,
        origem: data.origem,
        ip: req.ip,
      });
      return cliente;
    },
  );

  app.put(
    '/clientes/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const data = clienteSchema.partial().parse(req.body);
      const anterior = await prisma.cliente.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      const documento = data.documento !== undefined ? clean(data.documento) : undefined;
      if (documento && documento !== anterior.documento) {
        const existente = await prisma.cliente.findFirst({ where: { empresaId: req.user.empresaId, documento, NOT: { id } } });
        if (existente) throw Conflito('Já existe um cliente com este documento nesta empresa.');
      }
      const cliente = await prisma.cliente.update({ where: { id }, data: { ...data, documento, updatedAt: new Date() } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Cliente',
        entidadeId: id,
        valorAnterior: anterior,
        valorNovo: cliente,
        origem: data.origem || 'MANUAL',
        ip: req.ip,
      });
      return cliente;
    },
  );

  app.patch(
    '/clientes/:id/status',
    { preHandler: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { status } = z.object({ status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']) }).parse(req.body);
      const acao = status === 'ARQUIVADO' ? 'excluir' : 'editar';
      if (!(await temPermissao(req.user.id, 'clientes', acao))) return reply.status(403).send({ error: `Sem permissão: clientes.${acao}` });
      const anterior = await prisma.cliente.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      const cliente = await prisma.cliente.update({ where: { id }, data: { status } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: status === 'ARQUIVADO' ? 'EXCLUIR' : 'EDITAR',
        entidade: 'Cliente',
        entidadeId: id,
        valorAnterior: { status: anterior.status },
        valorNovo: { status },
        origem: 'MANUAL',
        ip: req.ip,
      });
      return cliente;
    },
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma, Produto } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { temPermissao } from '../../lib/permissoes.js';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { criarEstoqueParaProduto } from '../estoque/estoque.service.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);

// Seção 6: "outra pode visualizar estoque sem visualizar custos" — custo,
// margem e o valor monetário do estoque só aparecem para quem tem
// custos.visualizar. Sem essa permissão, os campos somem da resposta em
// vez de virem zerados (zero seria uma informação falsa; ausência é honesta).
function ocultarCusto<T extends { custo?: unknown; margem?: unknown }>(produto: T): Omit<T, 'custo' | 'margem'> {
  const { custo: _custo, margem: _margem, ...resto } = produto;
  return resto;
}

async function aplicarVisibilidadeCusto(req: FastifyRequest, produtos: Produto[]) {
  const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
  return podeVerCusto ? produtos : produtos.map(ocultarCusto);
}

export async function produtosRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/produtos',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          search: z.string().optional(),
          categoriaId: z.string().optional(),
          fornecedorId: z.string().optional(),
          status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']).optional(),
          take: z.coerce.number().int().min(1).max(200).default(50),
          skip: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const where: Prisma.ProdutoWhereInput = {
        empresaId: req.user.empresaId,
        ...(query.search
          ? {
              OR: [
                { nome: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
                { codigoBarras: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(query.categoriaId ? { categoriaId: query.categoriaId } : {}),
        ...(query.fornecedorId ? { fornecedorId: query.fornecedorId } : {}),
        // sem filtro explícito, esconde ARQUIVADO por padrão (Seção 8: excluir = arquivar)
        ...(query.status ? { status: query.status } : { status: { in: ['ATIVO', 'INATIVO'] } }),
      };
      const [produtos, total] = await Promise.all([
        prisma.produto.findMany({
          where,
          include: { categoria: true, fornecedor: true, estoques: true },
          orderBy: { createdAt: 'desc' },
          take: query.take,
          skip: query.skip,
        }),
        prisma.produto.count({ where }),
      ]);
      return { produtos: await aplicarVisibilidadeCusto(req, produtos), total, take: query.take, skip: query.skip };
    },
  );

  app.get(
    '/produtos/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const produto = await prisma.produto.findFirst({
        where: { id, empresaId: req.user.empresaId },
        include: { categoria: true, fornecedor: true, estoques: { include: { filial: true } } },
      });
      if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      const [semCusto] = await aplicarVisibilidadeCusto(req, [produto]);
      return semCusto;
    },
  );

  app.post(
    '/produtos',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        nome: z.string().min(2),
        sku: z.string().optional(),
        codigoBarras: z.string().optional(),
        categoriaId: z.string().optional(),
        fornecedorId: z.string().optional(),
        custo: z.number().positive(),
        precoVenda: z.number().positive(),
        unidade: z.string().default('UN'),
        estoqueMinimo: z.number().int().min(0).default(5),
        estoqueMaximo: z.number().int().min(0).default(100),
        validade: z.string().optional(),
        descricao: z.string().optional(),
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      if (data.estoqueMaximo < data.estoqueMinimo) {
        throw new ErroDeNegocio('Estoque máximo não pode ser menor que o estoque mínimo.', 400);
      }
      if (data.categoriaId) {
        const c = await prisma.categoria.findFirst({ where: { id: data.categoriaId, empresaId: req.user.empresaId } });
        if (!c) throw NaoEncontrado('Categoria inválida para esta empresa.');
      }
      if (data.fornecedorId) {
        const f = await prisma.fornecedor.findFirst({ where: { id: data.fornecedorId, empresaId: req.user.empresaId } });
        if (!f) throw NaoEncontrado('Fornecedor inválido para esta empresa.');
      }
      if (data.sku) {
        const existente = await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, sku: data.sku } });
        if (existente) throw Conflito('Já existe um produto com este SKU nesta empresa.');
      }
      if (data.codigoBarras) {
        const existente = await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, codigoBarras: data.codigoBarras } });
        if (existente) throw Conflito('Já existe um produto com este código de barras nesta empresa.');
      }
      const margem = ((data.precoVenda - data.custo) / data.precoVenda) * 100;
      const produto = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const novo = await tx.produto.create({
          data: {
            empresaId: req.user.empresaId,
            nome: data.nome,
            sku: data.sku,
            codigoBarras: data.codigoBarras,
            categoriaId: data.categoriaId,
            fornecedorId: data.fornecedorId,
            custo: data.custo,
            precoVenda: data.precoVenda,
            margem,
            unidade: data.unidade,
            estoqueMinimo: data.estoqueMinimo,
            estoqueMaximo: data.estoqueMaximo,
            validade: data.validade ? new Date(data.validade) : null,
            descricao: data.descricao,
            origem: data.origem,
          },
        });
        // Garante Estoque (quantidade 0) em toda filial ativa da empresa —
        // sem isso, o produto fica invisível para "produtos sem estoque"
        // até a primeira movimentação (ver estoque.service.ts).
        await criarEstoqueParaProduto(tx, req.user.empresaId, novo.id);
        return novo;
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Produto',
        entidadeId: produto.id,
        valorNovo: produto,
        origem: data.origem,
        ip: req.ip,
      });
      const [semCusto] = await aplicarVisibilidadeCusto(req, [produto]);
      return semCusto;
    },
  );

  app.put(
    '/produtos/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const schema = z.object({
        nome: z.string().min(2).optional(),
        sku: z.string().optional(),
        codigoBarras: z.string().optional(),
        categoriaId: z.string().nullable().optional(),
        fornecedorId: z.string().nullable().optional(),
        custo: z.number().positive().optional(),
        precoVenda: z.number().positive().optional(),
        unidade: z.string().optional(),
        estoqueMinimo: z.number().int().min(0).optional(),
        estoqueMaximo: z.number().int().min(0).optional(),
        validade: z.string().nullable().optional(),
        descricao: z.string().nullable().optional(),
        origem: origemSchema.optional(),
      });
      const data = schema.parse(req.body);
      const anterior = await prisma.produto.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      if (data.categoriaId) {
        const c = await prisma.categoria.findFirst({ where: { id: data.categoriaId, empresaId: req.user.empresaId } });
        if (!c) throw NaoEncontrado('Categoria inválida para esta empresa.');
      }
      if (data.fornecedorId) {
        const f = await prisma.fornecedor.findFirst({ where: { id: data.fornecedorId, empresaId: req.user.empresaId } });
        if (!f) throw NaoEncontrado('Fornecedor inválido para esta empresa.');
      }
      if (data.sku && data.sku !== anterior.sku) {
        const existente = await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, sku: data.sku, NOT: { id } } });
        if (existente) throw Conflito('Já existe um produto com este SKU nesta empresa.');
      }
      if (data.codigoBarras && data.codigoBarras !== anterior.codigoBarras) {
        const existente = await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, codigoBarras: data.codigoBarras, NOT: { id } } });
        if (existente) throw Conflito('Já existe um produto com este código de barras nesta empresa.');
      }
      const custo = data.custo ?? Number(anterior.custo);
      const precoVenda = data.precoVenda ?? Number(anterior.precoVenda);
      const estoqueMinimo = data.estoqueMinimo ?? anterior.estoqueMinimo;
      const estoqueMaximo = data.estoqueMaximo ?? anterior.estoqueMaximo;
      if (estoqueMaximo < estoqueMinimo) {
        throw new ErroDeNegocio('Estoque máximo não pode ser menor que o estoque mínimo.', 400);
      }
      const produto = await prisma.produto.update({
        where: { id: anterior.id },
        data: {
          ...data,
          custo: data.custo,
          precoVenda: data.precoVenda,
          margem: ((precoVenda - custo) / precoVenda) * 100,
          validade: data.validade === undefined ? undefined : data.validade ? new Date(data.validade) : null,
          updatedAt: new Date(),
        },
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Produto',
        entidadeId: id,
        valorAnterior: anterior,
        valorNovo: produto,
        origem: data.origem || 'MANUAL',
        ip: req.ip,
      });
      const [semCusto] = await aplicarVisibilidadeCusto(req, [produto]);
      return semCusto;
    },
  );

  // Seção 8: "Ativar/desativar" — endpoint dedicado, separado de excluir.
  // ARQUIVADO exige a permissão mais forte (excluir); ATIVO/INATIVO usam editar.
  app.patch(
    '/produtos/:id/status',
    { preHandler: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const { status } = z.object({ status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']) }).parse(req.body);
      const acaoNecessaria = status === 'ARQUIVADO' ? 'excluir' : 'editar';
      const autorizado = await temPermissao(req.user.id, 'produtos', acaoNecessaria);
      if (!autorizado) return reply.status(403).send({ error: `Sem permissão: produtos.${acaoNecessaria}` });

      const anterior = await prisma.produto.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      const produto = await prisma.produto.update({ where: { id }, data: { status } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: status === 'ARQUIVADO' ? 'EXCLUIR' : 'EDITAR',
        entidade: 'Produto',
        entidadeId: id,
        valorAnterior: { status: anterior.status },
        valorNovo: { status },
        origem: 'MANUAL',
        ip: req.ip,
      });
      return produto;
    },
  );

  // Mantido por compatibilidade: exclusão continua sendo arquivamento
  // (soft delete) — dado histórico de vendas/movimentações não pode sumir.
  app.delete(
    '/produtos/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'excluir')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const anterior = await prisma.produto.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      await prisma.produto.update({ where: { id: anterior.id }, data: { status: 'ARQUIVADO' } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EXCLUIR',
        entidade: 'Produto',
        entidadeId: id,
        valorAnterior: anterior,
        origem: 'MANUAL',
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  // Categorias
  app.post(
    '/categorias',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'criar')] },
    async (req: FastifyRequest) => {
      const { nome, descricao } = z.object({ nome: z.string().min(2), descricao: z.string().optional() }).parse(req.body);
      const categoria = await prisma.categoria.create({ data: { empresaId: req.user.empresaId, nome, descricao } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'Categoria',
        entidadeId: categoria.id,
        valorNovo: categoria,
        origem: 'MANUAL',
        ip: req.ip,
      });
      return categoria;
    },
  );

  app.get(
    '/categorias',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => prisma.categoria.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { nome: 'asc' } }),
  );
}

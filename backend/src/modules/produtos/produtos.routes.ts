import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Prisma, type Produto } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { temPermissao } from '../../lib/permissoes.js';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { aplicarMovimento, criarEstoqueParaProduto } from '../estoque/estoque.service.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);
const codigoBarrasSchema = z.string().regex(/^(?:\d{8}|\d{12}|\d{13})$/, 'Código de barras deve ser um GTIN-8, UPC-A ou EAN-13 válido.').refine((codigo) => {
  const digitos = codigo.slice(0, -1);
  const verificador = Number(codigo.at(-1));
  const soma = [...digitos].reverse().reduce((total, digito, indice) => total + Number(digito) * (indice % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === verificador;
}, 'Dígito verificador do código de barras inválido.');

// Seção 6: "outra pode visualizar estoque sem visualizar custos" — custo,
// margem e o valor monetário do estoque só aparecem para quem tem
// custos.visualizar. Sem essa permissão, os campos somem da resposta em
// vez de virem zerados (zero seria uma informação falsa; ausência é honesta).
function ocultarCusto<T extends { custo?: unknown; margem?: unknown }>(produto: T): Omit<T, 'custo' | 'margem'> {
  const { custo: _custo, margem: _margem, ...resto } = produto;
  const estoques = (resto as typeof resto & { estoques?: Array<Record<string, unknown>> }).estoques;
  if (!Array.isArray(estoques)) return resto;
  return {
    ...resto,
    estoques: estoques.map(({ valorTotal: _valorTotal, ...estoque }) => estoque),
  } as Omit<T, 'custo' | 'margem'>;
}

async function aplicarVisibilidadeCusto(req: FastifyRequest, produtos: Produto[], podeVerCusto?: boolean) {
  const autorizado = podeVerCusto ?? await temPermissao(req.user.id, 'custos', 'visualizar');
  return autorizado ? produtos : produtos.map(ocultarCusto);
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
          precoMin: z.coerce.number().min(0).optional(),
          precoMax: z.coerce.number().min(0).optional(),
          margemMin: z.coerce.number().min(0).max(100).optional(),
          margemMax: z.coerce.number().min(0).max(100).optional(),
          estoque: z.enum(['BAIXO', 'SEM_ESTOQUE', 'EXCESSO']).optional(),
          sortBy: z.enum(['nome', 'precoVenda', 'createdAt', 'margem']).default('createdAt'),
          sortOrder: z.enum(['asc', 'desc']).default('desc'),
          take: z.coerce.number().int().min(1).max(200).default(50),
          skip: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      if (query.precoMin !== undefined && query.precoMax !== undefined && query.precoMin > query.precoMax) {
        throw new ErroDeNegocio('Preço mínimo não pode ser maior que o preço máximo.', 400);
      }
      if (query.margemMin !== undefined && query.margemMax !== undefined && query.margemMin > query.margemMax) {
        throw new ErroDeNegocio('Margem mínima não pode ser maior que a margem máxima.', 400);
      }
      const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
      const podeEditarCusto = await temPermissao(req.user.id, 'custos', 'editar');
      const configuracaoEmpresa = await prisma.empresa.findUnique({ where: { id: req.user.empresaId }, select: { fusoHorario: true } });
      if ((query.margemMin !== undefined || query.margemMax !== undefined || query.sortBy === 'margem') && !podeVerCusto) {
        throw new ErroDeNegocio('Sem permissão: custos.visualizar', 403);
      }
      const where: Prisma.ProdutoWhereInput = {
        empresaId: req.user.empresaId,
        ...(query.search
          ? {
              OR: [
                { nome: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search, mode: 'insensitive' } },
                { codigoBarras: { contains: query.search, mode: 'insensitive' } },
                { marca: { contains: query.search, mode: 'insensitive' } },
                { categoria: { is: { nome: { contains: query.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        ...(query.categoriaId ? { categoriaId: query.categoriaId } : {}),
        ...(query.fornecedorId ? { fornecedorId: query.fornecedorId } : {}),
        ...(query.precoMin !== undefined || query.precoMax !== undefined
          ? { precoVenda: { ...(query.precoMin !== undefined ? { gte: query.precoMin } : {}), ...(query.precoMax !== undefined ? { lte: query.precoMax } : {}) } }
          : {}),
        ...(query.margemMin !== undefined || query.margemMax !== undefined
          ? { margem: { ...(query.margemMin !== undefined ? { gte: query.margemMin } : {}), ...(query.margemMax !== undefined ? { lte: query.margemMax } : {}) } }
          : {}),
        // sem filtro explícito, esconde ARQUIVADO por padrão (Seção 8: excluir = arquivar)
        ...(query.status ? { status: query.status } : { status: { in: ['ATIVO', 'INATIVO'] } }),
      };
      if (query.estoque) {
        const saldos = query.estoque === 'BAIXO'
          ? await prisma.$queryRaw<Array<{ produtoId: string }>>(Prisma.sql`SELECT e."produtoId" FROM "Estoque" e INNER JOIN "Produto" p ON p."id" = e."produtoId" AND p."empresaId" = e."empresaId" WHERE e."empresaId" = ${req.user.empresaId} GROUP BY e."produtoId", p."estoqueMinimo" HAVING SUM(e."quantidade") > 0 AND SUM(e."quantidade") <= p."estoqueMinimo"`)
          : query.estoque === 'EXCESSO'
            ? await prisma.$queryRaw<Array<{ produtoId: string }>>(Prisma.sql`SELECT e."produtoId" FROM "Estoque" e INNER JOIN "Produto" p ON p."id" = e."produtoId" AND p."empresaId" = e."empresaId" WHERE e."empresaId" = ${req.user.empresaId} GROUP BY e."produtoId", p."estoqueMaximo" HAVING SUM(e."quantidade") > p."estoqueMaximo"`)
            : await prisma.$queryRaw<Array<{ produtoId: string }>>(Prisma.sql`SELECT "produtoId" FROM "Estoque" WHERE "empresaId" = ${req.user.empresaId} GROUP BY "produtoId" HAVING SUM("quantidade") > 0`);
        where.id = query.estoque === 'SEM_ESTOQUE' ? { notIn: saldos.map((s) => s.produtoId) } : { in: saldos.map((s) => s.produtoId) };
      }
      const orderBy: Prisma.ProdutoOrderByWithRelationInput[] = [
        { [query.sortBy]: query.sortOrder },
        { id: 'asc' },
      ];
      const [produtos, total] = await Promise.all([
        prisma.produto.findMany({
          where,
          include: { categoria: true, fornecedor: true, estoques: true },
          orderBy,
          take: query.take,
          skip: query.skip,
        }),
        prisma.produto.count({ where }),
      ]);
      const [contagens] = await prisma.$queryRaw<Array<{ total: number; ativos: number; inativos: number; semEstoque: number; estoqueBaixo: number }>>(Prisma.sql`
        SELECT COUNT(p."id")::int AS total,
          COUNT(*) FILTER (WHERE p."status" = 'ATIVO')::int AS ativos,
          COUNT(*) FILTER (WHERE p."status" = 'INATIVO')::int AS inativos,
          COUNT(*) FILTER (WHERE COALESCE(e."saldo", 0) = 0)::int AS "semEstoque",
          COUNT(*) FILTER (WHERE COALESCE(e."saldo", 0) > 0 AND COALESCE(e."saldo", 0) <= p."estoqueMinimo")::int AS "estoqueBaixo"
        FROM "Produto" p
        LEFT JOIN (
          SELECT "produtoId", SUM("quantidade") AS "saldo"
          FROM "Estoque"
          WHERE "empresaId" = ${req.user.empresaId}
          GROUP BY "produtoId"
        ) e ON e."produtoId" = p."id"
        WHERE p."empresaId" = ${req.user.empresaId} AND p."status" IN ('ATIVO', 'INATIVO')
      `);
      const valorEstoque = podeVerCusto
        ? await prisma.$queryRaw<Array<{ valor: number }>>(Prisma.sql`
            SELECT COALESCE(SUM(e."valorTotal"), 0)::numeric AS valor
            FROM "Estoque" e
            INNER JOIN "Produto" p ON p."id" = e."produtoId"
            WHERE e."empresaId" = ${req.user.empresaId} AND p."status" IN ('ATIVO', 'INATIVO')
          `)
        : null;
      const vendasPorProduto = produtos.length
        ? await prisma.$queryRaw<Array<{ produtoId: string; vendidos: number; receitaHistorica: Prisma.Decimal }>>(Prisma.sql`
            SELECT i."produtoId", COALESCE(SUM(i."quantidade"), 0)::int AS vendidos,
              COALESCE(SUM(i."total" * CASE WHEN v."subtotal" > 0 THEN v."total" / v."subtotal" ELSE 0 END), 0)::numeric AS "receitaHistorica"
            FROM "VendaItem" i
            INNER JOIN "Venda" v ON v."id" = i."vendaId"
            WHERE v."empresaId" = ${req.user.empresaId}
              AND v."status" = 'FINALIZADA'
              AND i."produtoId" IN (${Prisma.join(produtos.map((produto) => produto.id))})
            GROUP BY i."produtoId"
          `)
        : [];
      const vendasMap = new Map(vendasPorProduto.map((venda) => [venda.produtoId, venda]));
      return {
        produtos: await aplicarVisibilidadeCusto(req, produtos.map((produto) => ({
          ...produto,
          vendidos: vendasMap.get(produto.id)?.vendidos ?? 0,
          receitaHistorica: Number(vendasMap.get(produto.id)?.receitaHistorica ?? 0),
        })) as Produto[], podeVerCusto),
        total,
        take: query.take,
        skip: query.skip,
        podeVerCusto,
        podeEditarCusto,
        fusoHorario: configuracaoEmpresa?.fusoHorario ?? 'America/Sao_Paulo',
        valorEstoque: podeVerCusto ? Number(valorEstoque?.[0]?.valor ?? 0) : null,
        contagens: contagens ?? { total: 0, ativos: 0, inativos: 0, semEstoque: 0, estoqueBaixo: 0 },
      };
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
        marca: z.string().optional(),
        sku: z.string().optional(),
        codigoBarras: codigoBarrasSchema.nullable().optional(),
        categoriaId: z.string().optional(),
        fornecedorId: z.string().optional(),
        custo: z.number().nonnegative(),
        precoVenda: z.number().positive(),
        unidade: z.string().default('UN'),
        estoqueMinimo: z.number().finite().min(0).default(5),
        estoqueMaximo: z.number().finite().min(0).default(100),
        pontoPedido: z.number().finite().min(0).default(0),
        local: z.string().optional(),
        peso: z.string().optional(),
        ncm: z.string().optional(),
        precoPromocional: z.number().positive().optional(),
        promocaoInicio: z.string().datetime().optional(),
        promocaoFim: z.string().datetime().optional(),
        promocaoLimite: z.number().int().positive().optional(),
        validade: z.string().optional(),
        descricao: z.string().optional(),
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      if (!(await temPermissao(req.user.id, 'custos', 'editar'))) {
        throw new ErroDeNegocio('Sem permissão: custos.editar', 403);
      }
      if (data.estoqueMaximo < data.estoqueMinimo) {
        throw new ErroDeNegocio('Estoque máximo não pode ser menor que o estoque mínimo.', 400);
      }
      if (data.precoPromocional !== undefined && data.precoPromocional >= data.precoVenda) {
        throw new ErroDeNegocio('Preço promocional deve ser menor que o preço de venda.', 400);
      }
      if (data.promocaoInicio && data.promocaoFim && new Date(data.promocaoInicio) > new Date(data.promocaoFim)) {
        throw new ErroDeNegocio('Início da promoção não pode ser posterior ao fim.', 400);
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
            marca: data.marca?.trim() || null,
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
            pontoPedido: data.pontoPedido,
            peso: data.peso,
            ncm: data.ncm,
            precoPromocional: data.precoPromocional,
            promocaoInicio: data.promocaoInicio ? new Date(data.promocaoInicio) : null,
            promocaoFim: data.promocaoFim ? new Date(data.promocaoFim) : null,
            promocaoLimite: data.promocaoLimite,
            validade: data.validade ? new Date(data.validade) : null,
            descricao: data.descricao,
            origem: data.origem,
          },
        });
        // Garante Estoque (quantidade 0) em toda filial ativa da empresa —
        // sem isso, o produto fica invisível para "produtos sem estoque"
        // até a primeira movimentação (ver estoque.service.ts).
        await criarEstoqueParaProduto(tx, req.user.empresaId, novo.id);
        if (data.local?.trim()) {
          await tx.estoque.updateMany({
            where: { empresaId: req.user.empresaId, produtoId: novo.id },
            data: { local: data.local.trim() },
          });
        }
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

  app.post(
    '/produtos/importar',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        produtos: z.array(z.object({
          nome: z.string().min(2),
          sku: z.string().optional(),
          codigoBarras: codigoBarrasSchema.optional(),
          categoriaId: z.string().optional(),
          marca: z.string().optional(),
          custo: z.number().nonnegative(),
          precoVenda: z.number().positive(),
          unidade: z.string().default('UN'),
          estoqueMinimo: z.number().finite().min(0).default(5),
          estoqueMaximo: z.number().finite().min(0).default(100),
          pontoPedido: z.number().finite().min(0).default(0),
          peso: z.string().optional(),
          ncm: z.string().optional(),
          descricao: z.string().optional(),
          validade: z.string().optional(),
          quantidadeInicial: z.number().int().min(0).default(0),
          filialId: z.string().optional(),
          local: z.string().optional(),
        })).min(1).max(500),
      }).parse(req.body);
      if (!(await temPermissao(req.user.id, 'custos', 'editar'))) {
        throw new ErroDeNegocio('Sem permissão: custos.editar', 403);
      }
      const filiais = await prisma.filial.findMany({
        where: { empresaId: req.user.empresaId, status: 'ATIVO' },
        select: { id: true },
      });
      const skus = new Set<string>();
      const codigos = new Set<string>();
      for (const item of schema.produtos) {
        if (item.estoqueMaximo < item.estoqueMinimo) {
          throw new ErroDeNegocio(`Estoque máximo não pode ser menor que o mínimo para ${item.nome}.`, 400);
        }
        if (item.sku) {
          if (skus.has(item.sku)) throw Conflito(`SKU duplicado no arquivo: ${item.sku}.`);
          skus.add(item.sku);
          if (await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, sku: item.sku }, select: { id: true } })) {
            throw Conflito(`SKU já cadastrado nesta empresa: ${item.sku}.`);
          }
        }
        if (item.codigoBarras) {
          if (codigos.has(item.codigoBarras)) throw Conflito(`Código de barras duplicado no arquivo: ${item.codigoBarras}.`);
          codigos.add(item.codigoBarras);
          if (await prisma.produto.findFirst({ where: { empresaId: req.user.empresaId, codigoBarras: item.codigoBarras }, select: { id: true } })) {
            throw Conflito(`Código de barras já cadastrado nesta empresa: ${item.codigoBarras}.`);
          }
        }
        if (item.categoriaId && !(await prisma.categoria.findFirst({ where: { id: item.categoriaId, empresaId: req.user.empresaId }, select: { id: true } }))) {
          throw NaoEncontrado(`Categoria inválida para ${item.nome}.`);
        }
        if (item.quantidadeInicial > 0) {
          if (!item.filialId && filiais.length !== 1) {
            throw new ErroDeNegocio(`Informe filialId para a quantidade inicial de ${item.nome}.`, 400);
          }
          const filialId = item.filialId || filiais[0]?.id;
          if (!filialId || !filiais.some((filial) => filial.id === filialId)) {
            throw NaoEncontrado(`Filial inválida para ${item.nome}.`);
          }
        }
      }

      const ids = await prisma.$transaction(async (tx) => {
        const criados: string[] = [];
        for (const item of schema.produtos) {
          const produto = await tx.produto.create({
            data: {
              empresaId: req.user.empresaId,
              nome: item.nome.trim(),
              marca: item.marca?.trim() || null,
              sku: item.sku?.trim() || null,
              codigoBarras: item.codigoBarras || null,
              categoriaId: item.categoriaId,
              custo: item.custo,
              precoVenda: item.precoVenda,
              margem: ((item.precoVenda - item.custo) / item.precoVenda) * 100,
              unidade: item.unidade,
              estoqueMinimo: item.estoqueMinimo,
              estoqueMaximo: item.estoqueMaximo,
              pontoPedido: item.pontoPedido,
              peso: item.peso,
              ncm: item.ncm,
              descricao: item.descricao,
              validade: item.validade ? new Date(item.validade) : null,
              origem: 'IMPORTADO',
            },
          });
          await criarEstoqueParaProduto(tx, req.user.empresaId, produto.id);
          if (item.local?.trim()) {
            await tx.estoque.updateMany({
              where: { empresaId: req.user.empresaId, produtoId: produto.id },
              data: { local: item.local.trim() },
            });
          }
          if (item.quantidadeInicial > 0) {
            const filialId = item.filialId || filiais[0].id;
            await aplicarMovimento(tx, {
              empresaId: req.user.empresaId,
              filialId,
              produtoId: produto.id,
              usuarioId: req.user.id,
              tipo: 'ENTRADA',
              quantidade: item.quantidadeInicial,
              motivo: 'Estoque inicial via importação CSV',
              origem: 'IMPORTADO',
            });
          }
          await tx.auditoria.create({
            data: {
              usuarioId: req.user.id,
              empresaId: req.user.empresaId,
              acao: 'CRIAR',
              entidade: 'Produto',
              entidadeId: produto.id,
              valorNovo: produto,
              origem: 'IMPORTADO',
              ip: req.ip,
            },
          });
          criados.push(produto.id);
        }
        return criados;
      });
      return { ok: true, qtdImportada: ids.length, ids };
    },
  );

  app.put(
    '/produtos/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const schema = z.object({
        nome: z.string().min(2).optional(),
        marca: z.string().nullable().optional(),
        sku: z.string().optional(),
        codigoBarras: codigoBarrasSchema.nullable().optional(),
        categoriaId: z.string().nullable().optional(),
        fornecedorId: z.string().nullable().optional(),
        custo: z.number().nonnegative().optional(),
        precoVenda: z.number().positive().optional(),
        unidade: z.string().optional(),
        estoqueMinimo: z.number().finite().min(0).optional(),
        estoqueMaximo: z.number().finite().min(0).optional(),
        pontoPedido: z.number().finite().min(0).optional(),
        local: z.string().nullable().optional(),
        peso: z.string().nullable().optional(),
        ncm: z.string().nullable().optional(),
        precoPromocional: z.number().positive().nullable().optional(),
        promocaoInicio: z.string().datetime().nullable().optional(),
        promocaoFim: z.string().datetime().nullable().optional(),
        promocaoLimite: z.number().int().positive().nullable().optional(),
        validade: z.string().nullable().optional(),
        descricao: z.string().nullable().optional(),
        origem: origemSchema.optional(),
      });
      const data = schema.parse(req.body);
      if (data.custo !== undefined && !(await temPermissao(req.user.id, 'custos', 'editar'))) {
        throw new ErroDeNegocio('Sem permissão: custos.editar', 403);
      }
      const { local, ...dadosProduto } = data;
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
      const estoqueMinimo = data.estoqueMinimo ?? Number(anterior.estoqueMinimo);
      const estoqueMaximo = data.estoqueMaximo ?? Number(anterior.estoqueMaximo);
      if (estoqueMaximo < estoqueMinimo) {
        throw new ErroDeNegocio('Estoque máximo não pode ser menor que o estoque mínimo.', 400);
      }
      if (data.precoPromocional != null && data.precoPromocional >= precoVenda) {
        throw new ErroDeNegocio('Preço promocional deve ser menor que o preço de venda.', 400);
      }
      const promocaoInicio = data.promocaoInicio === undefined ? undefined : data.promocaoInicio ? new Date(data.promocaoInicio) : null;
      const promocaoFim = data.promocaoFim === undefined ? undefined : data.promocaoFim ? new Date(data.promocaoFim) : null;
      const inicioEfetivo = promocaoInicio === undefined ? anterior.promocaoInicio : promocaoInicio;
      const fimEfetivo = promocaoFim === undefined ? anterior.promocaoFim : promocaoFim;
      if (inicioEfetivo && fimEfetivo && inicioEfetivo > fimEfetivo) {
        throw new ErroDeNegocio('Início da promoção não pode ser posterior ao fim.', 400);
      }
      const produto = await prisma.$transaction(async (tx) => {
        const atualizado = await tx.produto.update({
          where: { id: anterior.id },
          data: {
            ...dadosProduto,
            custo: data.custo,
            precoVenda: data.precoVenda,
            margem: ((precoVenda - custo) / precoVenda) * 100,
            validade: data.validade === undefined ? undefined : data.validade ? new Date(data.validade) : null,
            promocaoInicio,
            promocaoFim,
            marca: data.marca?.trim() || data.marca,
            updatedAt: new Date(),
          },
        });
        if (local !== undefined) {
          await tx.estoque.updateMany({
            where: { empresaId: req.user.empresaId, produtoId: anterior.id },
            data: { local: local?.trim() || null },
          });
        }
        if (data.custo !== undefined) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "Estoque"
            SET "valorTotal" = "quantidade" * ${atualizado.custo}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "empresaId" = ${req.user.empresaId} AND "produtoId" = ${anterior.id}
          `);
        }
        return atualizado;
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
      const [semCusto] = await aplicarVisibilidadeCusto(req, [produto]);
      return semCusto;
    },
  );

  app.patch(
    '/produtos/status-lote',
    { preHandler: [app.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { ids, status } = z.object({
        ids: z.array(z.string().min(1)).min(1).max(5000),
        status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']),
      }).parse(req.body);
      const idsUnicos = [...new Set(ids)];
      const acaoNecessaria = status === 'ARQUIVADO' ? 'excluir' : 'editar';
      if (!(await temPermissao(req.user.id, 'produtos', acaoNecessaria))) {
        return reply.status(403).send({ error: `Sem permissão: produtos.${acaoNecessaria}` });
      }

      const atualizados = await prisma.$transaction(async (tx) => {
        const anteriores = await tx.produto.findMany({
          where: { empresaId: req.user.empresaId, id: { in: idsUnicos } },
          select: { id: true, status: true },
        });
        if (anteriores.length !== idsUnicos.length) {
          throw NaoEncontrado('Um ou mais produtos não foram encontrados nesta empresa.');
        }
        await tx.produto.updateMany({
          where: { empresaId: req.user.empresaId, id: { in: idsUnicos } },
          data: { status },
        });
        await tx.auditoria.createMany({
          data: anteriores.map((produto) => ({
            usuarioId: req.user.id,
            empresaId: req.user.empresaId,
            acao: status === 'ARQUIVADO' ? 'EXCLUIR' as const : 'EDITAR' as const,
            entidade: 'Produto',
            entidadeId: produto.id,
            valorAnterior: { status: produto.status },
            valorNovo: { status },
            origem: 'MANUAL' as const,
            ip: req.ip,
          })),
        });
        return tx.produto.findMany({
          where: { empresaId: req.user.empresaId, id: { in: idsUnicos } },
          include: { categoria: true, fornecedor: true, estoques: true },
        });
      });
      return { produtos: await aplicarVisibilidadeCusto(req, atualizados), total: atualizados.length };
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

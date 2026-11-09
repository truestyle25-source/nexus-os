import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { aplicarMovimento } from '../estoque/estoque.service.js';

const quantidadeSchema = z.number().int().positive();
const quantidadeIngredienteSchema = z.number().positive().finite().refine((valor) => Math.abs(valor * 1000 - Math.round(valor * 1000)) < 1e-8, 'Use no máximo 3 casas decimais.');
const origemProducao = 'MANUAL' as const;
const arredondarMoeda = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

export async function kitsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/produtos/:id/kit',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const kit = await prisma.produto.findFirst({
        where: { id, empresaId: req.user.empresaId },
        select: { id: true, nome: true, sku: true, ehKit: true, ...(podeVerCustos ? { custo: true } : {}) },
      });
      if (!kit) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      const componentes = await prisma.composicaoKit.findMany({
        where: { empresaId: req.user.empresaId, kitProdutoId: id },
        orderBy: { ingredienteProduto: { nome: 'asc' } },
        select: {
          ingredienteProdutoId: true,
          quantidadePorKit: true,
          ingredienteProduto: { select: { nome: true, sku: true, unidade: true, ...(podeVerCustos ? { custo: true } : {}) } },
        },
      });
      return {
        kit,
        componentes: componentes.map((componente) => ({
          produtoId: componente.ingredienteProdutoId,
          nome: componente.ingredienteProduto.nome,
          sku: componente.ingredienteProduto.sku,
          unidade: componente.ingredienteProduto.unidade,
          quantidadePorKit: Number(componente.quantidadePorKit),
          ...(podeVerCustos ? { custoUnitario: Number(componente.ingredienteProduto.custo) } : {}),
        })),
        custoCalculadoPorKit: podeVerCustos
          ? arredondarMoeda(componentes.reduce((soma, componente) => soma + Number(componente.ingredienteProduto.custo) * Number(componente.quantidadePorKit), 0))
          : undefined,
      };
    },
  );

  app.put(
    '/produtos/:id/kit',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const body = z.object({
        componentes: z.array(z.object({ produtoId: z.string().min(1), quantidadePorKit: quantidadeIngredienteSchema })).min(1).max(100),
      }).parse(req.body);
      const ids = body.componentes.map((componente) => componente.produtoId);
      if (new Set(ids).size !== ids.length) throw Conflito('Cada ingrediente pode aparecer uma única vez na composição.');
      if (ids.includes(id)) throw new ErroDeNegocio('O produto acabado não pode ser ingrediente dele mesmo.', 400);

      const kitAntes = await prisma.$transaction(async (tx) => {
        const lock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Produto"
          WHERE "id" = ${id} AND "empresaId" = ${req.user.empresaId}
          FOR UPDATE
        `;
        if (!lock.length) throw NaoEncontrado('Produto não encontrado nesta empresa.');
        const kit = await tx.produto.findFirst({ where: { id, empresaId: req.user.empresaId } });
        if (!kit) throw NaoEncontrado('Produto não encontrado nesta empresa.');
        const locksIngredientes = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Produto"
          WHERE "empresaId" = ${req.user.empresaId} AND "id" IN (${Prisma.join(ids)})
          ORDER BY "id" FOR UPDATE
        `;
        if (locksIngredientes.length !== ids.length) throw Conflito('Ingrediente mudou durante a edicao. Atualize e tente novamente.');
        const ingredientes = await tx.produto.findMany({
          where: { id: { in: ids }, empresaId: req.user.empresaId, status: 'ATIVO', ehKit: false },
          select: { id: true },
        });
        if (ingredientes.length !== ids.length) throw NaoEncontrado('Ingrediente invalido, inativo ou kit acabado.');
        const antes = await tx.composicaoKit.findMany({ where: { empresaId: req.user.empresaId, kitProdutoId: id } });
        await tx.composicaoKit.deleteMany({ where: { empresaId: req.user.empresaId, kitProdutoId: id } });
        await tx.composicaoKit.createMany({
          data: body.componentes.map((componente) => ({
            empresaId: req.user.empresaId,
            kitProdutoId: id,
            ingredienteProdutoId: componente.produtoId,
            quantidadePorKit: componente.quantidadePorKit,
          })),
        });
        await tx.produto.update({ where: { id }, data: { ehKit: true } });
        return antes.map(({ ingredienteProdutoId, quantidadePorKit }) => ({ ingredienteProdutoId, quantidadePorKit: Number(quantidadePorKit) }));
      });

      const atual = await prisma.composicaoKit.findMany({ where: { empresaId: req.user.empresaId, kitProdutoId: id }, select: { ingredienteProdutoId: true, quantidadePorKit: true } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'ComposicaoKit',
        entidadeId: id,
        valorAnterior: kitAntes as unknown as Prisma.InputJsonValue,
        valorNovo: atual.map((componente) => ({ ingredienteProdutoId: componente.ingredienteProdutoId, quantidadePorKit: Number(componente.quantidadePorKit) })) as unknown as Prisma.InputJsonValue,
        origem: origemProducao,
        ip: req.ip,
      });
      return { produtoKitId: id, componentes: atual };
    },
  );

  app.get(
    '/produtos/:id/kit/producoes',
    { preHandler: [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const query = z.object({ take: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
      const produto = await prisma.produto.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { id: true, ehKit: true } });
      if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
      if (!produto.ehKit) throw new ErroDeNegocio('Este produto não está configurado como kit.', 409);
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const producoes = await prisma.producaoKit.findMany({
        where: { empresaId: req.user.empresaId, produtoKitId: id },
        orderBy: { createdAt: 'desc' },
        take: query.take,
        include: { filial: { select: { id: true, nome: true } } },
      });
      return { producoes: producoes.map(({ custoUnitario, custoTotal, composicaoSnapshot, ...producao }) => ({
        ...producao,
        ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}),
      })) };
    },
  );

  app.post(
    '/produtos/:id/kit/produzir',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'criar')] },
    async (req: FastifyRequest, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ filialId: z.string().min(1), quantidade: quantidadeSchema, idempotencyKey: z.string().min(8).max(160).optional() }).parse(req.body);
      const headerKey = req.headers['x-idempotency-key'];
      if (Array.isArray(headerKey)) throw new ErroDeNegocio('Use uma única chave de idempotência.', 400);
      if (headerKey && body.idempotencyKey && headerKey !== body.idempotencyKey) throw new ErroDeNegocio('A chave do cabeçalho e do corpo não coincide.', 400);
      const idempotencyKey = (headerKey || body.idempotencyKey || '').trim();
      if (idempotencyKey.length < 8) throw new ErroDeNegocio('Informe uma chave de idempotência com pelo menos 8 caracteres.', 400);
      if (!(await temPermissao(req.user.id, 'custos', 'editar'))) throw new ErroDeNegocio('Produzir kits altera o custo do produto acabado e exige custos.editar.', 403);

      const anterior = await prisma.producaoKit.findFirst({ where: { empresaId: req.user.empresaId, idempotencyKey } });
      if (anterior) {
        if (anterior.produtoKitId !== id || anterior.filialId !== body.filialId || anterior.quantidade !== body.quantidade) {
          throw Conflito('Esta chave de idempotência já foi usada em outra produção. Gere uma nova chave.');
        }
        const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
        const { custoUnitario, custoTotal, composicaoSnapshot, ...resumo } = anterior;
        return reply.send({ duplicada: true, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}) } });
      }

      let producao;
      try {
        producao = await prisma.$transaction(async (tx) => {
          const lockKit = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Produto"
            WHERE "id" = ${id} AND "empresaId" = ${req.user.empresaId} AND "status" = 'ATIVO'::"StatusGeral"
            FOR UPDATE
          `;
          if (!lockKit.length) throw NaoEncontrado('Produto acabado não encontrado ou inativo nesta empresa.');
          const kit = await tx.produto.findFirst({ where: { id, empresaId: req.user.empresaId, status: 'ATIVO', ehKit: true } });
          if (!kit) throw new ErroDeNegocio('Configure a composição do kit antes de produzir.', 409);
          const filial = await tx.filial.findFirst({ where: { id: body.filialId, empresaId: req.user.empresaId, status: 'ATIVO' }, select: { id: true } });
          if (!filial) throw NaoEncontrado('Filial inválida ou inativa nesta empresa.');
          const receita = await tx.composicaoKit.findMany({
            where: { empresaId: req.user.empresaId, kitProdutoId: id },
            orderBy: { ingredienteProdutoId: 'asc' },
            include: { ingredienteProduto: true },
          });
          if (!receita.length) throw new ErroDeNegocio('O kit precisa ter ao menos um ingrediente configurado.', 409);

          const idsIngredientes = receita.map((item) => item.ingredienteProdutoId);
          const locksIngredientes = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Produto"
            WHERE "empresaId" = ${req.user.empresaId} AND "id" IN (${Prisma.join(idsIngredientes)})
            ORDER BY "id"
            FOR UPDATE
          `;
          if (locksIngredientes.length !== idsIngredientes.length) throw Conflito('A composição mudou durante a produção. Atualize e tente novamente.');

          const ingredientesAtualizados = await tx.produto.findMany({ where: { empresaId: req.user.empresaId, id: { in: idsIngredientes } } });
          if (ingredientesAtualizados.length !== idsIngredientes.length) throw Conflito('Um ingrediente foi removido durante a produção. Atualize e tente novamente.');
          if (ingredientesAtualizados.some((produto) => produto.status !== 'ATIVO' || produto.ehKit)) throw Conflito('Um ingrediente foi inativado ou passou a ser kit. Atualize a composição e tente novamente.');
          const porId = new Map(ingredientesAtualizados.map((produto) => [produto.id, produto]));
          const receitaAtual = receita.map((item) => ({ ...item, ingredienteProduto: porId.get(item.ingredienteProdutoId)! }));
          const custoUnitario = arredondarMoeda(receitaAtual.reduce((total, item) => total + Number(item.ingredienteProduto.custo) * Number(item.quantidadePorKit), 0));
          const custoTotal = arredondarMoeda(custoUnitario * body.quantidade);
          const snapshot = receitaAtual.map((item) => ({
            produtoId: item.ingredienteProdutoId,
            nome: item.ingredienteProduto.nome,
            sku: item.ingredienteProduto.sku,
            unidade: item.ingredienteProduto.unidade,
            quantidadePorKit: Number(item.quantidadePorKit),
            quantidadeConsumida: Number(item.quantidadePorKit) * body.quantidade,
            custoUnitario: Number(item.ingredienteProduto.custo),
            custoTotal: arredondarMoeda(Number(item.ingredienteProduto.custo) * Number(item.quantidadePorKit) * body.quantidade),
          }));
          if (snapshot.some((componente) => !Number.isFinite(componente.quantidadeConsumida) || Math.abs(componente.quantidadeConsumida * 1000 - Math.round(componente.quantidadeConsumida * 1000)) > 1e-8)) {
            throw new ErroDeNegocio('A quantidade consumida excede a precisão de 3 casas decimais suportada pelo estoque.', 400);
          }
          const registro = await tx.producaoKit.create({
            data: {
              empresaId: req.user.empresaId,
              filialId: filial.id,
              produtoKitId: id,
              usuarioId: req.user.id,
              quantidade: body.quantidade,
              quantidadeProduzida: body.quantidade,
              custoUnitario,
              custoTotal,
              composicaoSnapshot: snapshot,
              idempotencyKey,
            },
          });

          for (let index = 0; index < receitaAtual.length; index += 1) {
            const componente = receitaAtual[index];
            await aplicarMovimento(tx, {
              empresaId: req.user.empresaId,
              filialId: filial.id,
              produtoId: componente.ingredienteProdutoId,
              usuarioId: req.user.id,
              tipo: 'SAIDA',
              quantidade: snapshot[index].quantidadeConsumida,
              motivo: `Consumo na produção do kit ${kit.nome}`,
              documento: registro.id,
              origem: 'MANUAL',
            });
          }

          const margem = Number(kit.precoVenda) > 0 ? ((Number(kit.precoVenda) - custoUnitario) / Number(kit.precoVenda)) * 100 : 0;
          await tx.produto.update({ where: { id: kit.id }, data: { custo: custoUnitario, margem } });
          await aplicarMovimento(tx, {
            empresaId: req.user.empresaId,
            filialId: filial.id,
            produtoId: kit.id,
            usuarioId: req.user.id,
            tipo: 'ENTRADA',
            quantidade: body.quantidade,
            motivo: `Produção do kit ${kit.nome}`,
            documento: registro.id,
            origem: 'MANUAL',
          });
          return { ...registro, custoUnitario, custoTotal, kitNome: kit.nome, componentes: snapshot };
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const repetida = await prisma.producaoKit.findFirst({ where: { empresaId: req.user.empresaId, idempotencyKey } });
          if (repetida) {
            if (repetida.produtoKitId !== id || repetida.filialId !== body.filialId || repetida.quantidade !== body.quantidade) {
              throw Conflito('Esta chave de idempotência já foi usada em outra produção. Gere uma nova chave.');
            }
            const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
            const { custoUnitario, custoTotal, composicaoSnapshot, ...resumo } = repetida;
            return reply.send({ duplicada: true, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario: Number(custoUnitario), custoTotal: Number(custoTotal), composicaoSnapshot } : {}) } });
          }
        }
        throw error;
      }

      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'CRIAR',
        entidade: 'ProducaoKit',
        entidadeId: producao.id,
        valorNovo: producao as unknown as Prisma.InputJsonValue,
        origem: origemProducao,
        ip: req.ip,
        contexto: `Produzidas ${body.quantidade} unidade(s) de ${producao.kitNome}; ingredientes consumidos na filial ${body.filialId}.`,
      });
      const podeVerCustos = await temPermissao(req.user.id, 'custos', 'visualizar');
      const { custoUnitario, custoTotal, componentes, ...resumo } = producao;
      return reply.status(201).send({ duplicada: false, producao: { ...resumo, ...(podeVerCustos ? { custoUnitario, custoTotal, componentes } : {}) } });
    },
  );
}

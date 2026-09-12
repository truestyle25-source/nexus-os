import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { temPermissao } from '../../lib/permissoes.js';
import { aplicarMovimento, transferirEstoque } from './estoque.service.js';
import { calcularGiroPorProduto, gerarSnapshotDoDia } from './estoque-indicadores.service.js';

const origemMovimento = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO', 'PDV', 'PONTO', 'INTEGRACAO', 'IA']);
const tipoMovimento = z.enum(['ENTRADA', 'SAIDA', 'AJUSTE', 'INVENTARIO', 'PERDA', 'AVARIA', 'TRANSFERENCIA', 'DEVOLUCAO', 'VENDA', 'COMPRA']);

export async function estoqueRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/estoque',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          filialId: z.string().optional(),
          diasParado: z.coerce.number().int().min(1).max(365).default(30),
          diasValidade: z.coerce.number().int().min(1).max(365).default(30),
          diasGiro: z.coerce.number().int().min(1).max(365).default(30),
        })
        .parse(req.query);

      const where: Prisma.EstoqueWhereInput = { empresaId: req.user.empresaId, ...(query.filialId ? { filialId: query.filialId } : {}) };
      const estoques = await prisma.estoque.findMany({ where, include: { produto: true, filial: true } });

      const valorTotal = estoques.reduce((soma: number, e) => soma + Number(e.valorTotal), 0);
      const baixo = estoques.filter((e) => e.quantidade > 0 && e.quantidade <= e.produto.estoqueMinimo);
      const semEstoque = estoques.filter((e) => e.quantidade === 0);

      const agora = new Date();
      const limiteValidade = new Date(agora);
      limiteValidade.setDate(limiteValidade.getDate() + query.diasValidade);
      const proximosValidade = await prisma.produto.findMany({
        where: { empresaId: req.user.empresaId, status: 'ATIVO', validade: { not: null, lte: limiteValidade } },
        orderBy: { validade: 'asc' },
      });

      // Produtos parados (Seção 9): ativos, com estoque > 0 em alguma
      // filial, sem nenhuma saída/venda nos últimos N dias.
      const desdeParado = new Date(agora);
      desdeParado.setDate(desdeParado.getDate() - query.diasParado);
      const movimentadosRecentemente = await prisma.estoqueMovimentacao.findMany({
        where: { empresaId: req.user.empresaId, tipo: { in: ['SAIDA', 'VENDA'] }, createdAt: { gte: desdeParado } },
        select: { produtoId: true },
        distinct: ['produtoId'],
      });
      const idsMovimentados = new Set(movimentadosRecentemente.map((m) => m.produtoId));
      const produtosComEstoque = new Map<string, number>();
      for (const e of estoques) produtosComEstoque.set(e.produtoId, (produtosComEstoque.get(e.produtoId) ?? 0) + e.quantidade);
      const idsParados = [...produtosComEstoque.entries()].filter(([id, qtd]) => qtd > 0 && !idsMovimentados.has(id)).map(([id]) => id);
      const produtosParados = idsParados.length
        ? await prisma.produto.findMany({ where: { id: { in: idsParados }, empresaId: req.user.empresaId } })
        : [];

      // Giro, cobertura e tendência (Seção 9) — usa snapshot diário real
      // quando disponível; cai para aproximação por produto quando o
      // histórico de snapshots daquele produto ainda é curto demais
      // (ver estoque-indicadores.service.ts e DEBITO-TECNICO.md item 8).
      const giroPorProduto = await calcularGiroPorProduto(req.user.empresaId, { filialId: query.filialId, diasPeriodo: query.diasGiro });

      const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
      return {
        estoques,
        indicadores: {
          valorTotal: podeVerCusto ? valorTotal : undefined,
          qtdBaixo: baixo.length,
          qtdSemEstoque: semEstoque.length,
          baixo,
          semEstoque,
          proximosValidade,
          produtosParados,
          giro: { diasConsiderados: query.diasGiro, porProduto: giroPorProduto },
        },
      };
    },
  );

  app.post(
    '/estoque/movimentar',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'criar')] },
    async (req: FastifyRequest) => {
      const data = z
        .object({
          produtoId: z.string(),
          filialId: z.string(),
          quantidade: z.number().int().positive(),
          tipo: tipoMovimento,
          motivo: z.string().optional(),
          documento: z.string().optional(),
          origem: origemMovimento.default('MANUAL'),
        })
        .parse(req.body);

      const result = await prisma.$transaction((tx: Prisma.TransactionClient) =>
        aplicarMovimento(tx, {
          empresaId: req.user.empresaId,
          filialId: data.filialId,
          produtoId: data.produtoId,
          usuarioId: req.user.id,
          tipo: data.tipo,
          quantidade: data.quantidade,
          motivo: data.motivo,
          documento: data.documento,
          origem: data.origem,
        }),
      );

      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Estoque',
        entidadeId: result.estoque.id,
        valorAnterior: { quantidade: result.qtdAnterior },
        valorNovo: { quantidade: result.qtdNova, tipo: data.tipo },
        origem: data.origem,
        ip: req.ip,
        contexto: `Mov estoque ${data.tipo} ${data.quantidade}`,
      });

      return {
        estoque: result.estoque,
        movimentacao: result.movimentacao,
        alerta: result.qtdNova <= result.estoqueMinimo ? { tipo: 'ESTOQUE_BAIXO', atual: result.qtdNova, minimo: result.estoqueMinimo } : null,
      };
    },
  );

  // Seção 9: transferência real entre filiais.
  app.post(
    '/estoque/transferir',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'criar')] },
    async (req: FastifyRequest) => {
      const data = z
        .object({
          produtoId: z.string(),
          filialOrigemId: z.string(),
          filialDestinoId: z.string(),
          quantidade: z.number().int().positive(),
          motivo: z.string().optional(),
          origem: origemMovimento.default('MANUAL'),
        })
        .parse(req.body);

      const result = await prisma.$transaction((tx: Prisma.TransactionClient) =>
        transferirEstoque(tx, {
          empresaId: req.user.empresaId,
          produtoId: data.produtoId,
          filialOrigemId: data.filialOrigemId,
          filialDestinoId: data.filialDestinoId,
          quantidade: data.quantidade,
          usuarioId: req.user.id,
          motivo: data.motivo,
          origem: data.origem,
        }),
      );

      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Estoque',
        entidadeId: result.movOrigem.id,
        valorAnterior: { quantidadeOrigem: result.qtdOrigemAntes },
        valorNovo: { quantidadeOrigem: result.qtdOrigemDepois, transferido: data.quantidade },
        origem: data.origem,
        ip: req.ip,
        contexto: `Transferência ${data.quantidade} un. ${data.filialOrigemId} -> ${data.filialDestinoId} (${result.documento})`,
      });

      return result;
    },
  );

  app.get(
    '/estoque/movimentacoes',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          filialId: z.string().optional(),
          produtoId: z.string().optional(),
          tipo: tipoMovimento.optional(),
          take: z.coerce.number().int().min(1).max(500).default(200),
          skip: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const where: Prisma.EstoqueMovimentacaoWhereInput = {
        empresaId: req.user.empresaId,
        ...(query.filialId ? { filialId: query.filialId } : {}),
        ...(query.produtoId ? { produtoId: query.produtoId } : {}),
        ...(query.tipo ? { tipo: query.tipo } : {}),
      };
      const [movimentacoes, total] = await Promise.all([
        prisma.estoqueMovimentacao.findMany({
          where,
          include: { produto: { select: { nome: true, sku: true } }, usuario: { select: { nome: true } }, filial: { select: { nome: true } } },
          orderBy: { createdAt: 'desc' },
          take: query.take,
          skip: query.skip,
        }),
        prisma.estoqueMovimentacao.count({ where }),
      ]);
      return { movimentacoes, total, take: query.take, skip: query.skip };
    },
  );

  // Seção 9 / DEBITO-TECNICO item 8: dispara a captura do snapshot diário
  // usado no giro real. Não roda sozinho — precisa de um agendador externo
  // (ver o comentário em estoque-indicadores.service.ts) chamando isto (ou
  // `npm run estoque:snapshot`) uma vez por dia.
  app.post(
    '/estoque/snapshot/gerar',
    { preHandler: [app.authenticate, await permissaoMiddleware('estoque', 'administrar')] },
    async (req: FastifyRequest) => {
      const resultado = await gerarSnapshotDoDia(req.user.empresaId);
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'SINCRONIZAR',
        entidade: 'EstoqueSnapshotDiario',
        valorNovo: resultado,
        origem: 'AUTOMATICO',
        ip: req.ip,
        contexto: 'Snapshot diário de estoque gerado manualmente via API',
      });
      return resultado;
    },
  );
}

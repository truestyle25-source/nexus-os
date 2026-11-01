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
          diasGiro: z.coerce.number().int().min(1).max(365).default(30),
        })
        .parse(req.query);

      // A permissão de custos é resolvida ANTES da consulta, porque ela muda
      // o SELECT — não só o que sai na resposta.
      //
      // Antes o endpoint trazia `produto` inteiro (custo E precoVenda dentro)
      // e o `valorTotal` de cada linha, e só omitia o subtotal
      // `indicadores.valorTotal`. O frontend então recalculava o total a
      // partir das linhas e mostrava custo/valor por produto nas colunas e no
      // drawer: o gate de custos não segurava nada. Agora, sem a permissão,
      // os campos de dinheiro não são lidos do banco.
      const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');

      const where: Prisma.EstoqueWhereInput = { empresaId: req.user.empresaId, ...(query.filialId ? { filialId: query.filialId } : {}) };

      // `select` explícito em vez de `include`: é o que permite desligar
      // `custo`/`precoVenda`/`valorTotal` por permissão. A tela mostra
      // "—" nesses campos quando o usuário não tem custos.
      const estoques = await prisma.estoque.findMany({
        where,
        select: {
          id: true,
          filialId: true,
          produtoId: true,
          quantidade: true,
          local: true,
          lote: true,
          updatedAt: true,
          ...(podeVerCusto ? { valorTotal: true } : { valorTotal: false }),
          filial: { select: { id: true, nome: true } },
          produto: {
            select: {
              id: true,
              nome: true,
              sku: true,
              codigoBarras: true,
              unidade: true,
              estoqueMinimo: true,
              estoqueMaximo: true,
              validade: true,
              ...(podeVerCusto ? { custo: true, precoVenda: true } : { custo: false, precoVenda: false }),
              categoria: { select: { id: true, nome: true } },
              fornecedor: { select: { id: true, nome: true } },
            },
          },
        },
      });

      const valorTotal = podeVerCusto
        ? estoques.reduce((soma: number, e) => soma + Number(e.valorTotal ?? 0), 0)
        : 0;
      const baixo = estoques.filter((e) => Number(e.quantidade) > 0 && Number(e.quantidade) <= Number(e.produto.estoqueMinimo));
      const semEstoque = estoques.filter((e) => Number(e.quantidade) === 0);

      const agora = new Date();

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
      for (const e of estoques) produtosComEstoque.set(e.produtoId, (produtosComEstoque.get(e.produtoId) ?? 0) + Number(e.quantidade));
      const idsParados = [...produtosComEstoque.entries()].filter(([id, qtd]) => qtd > 0 && !idsMovimentados.has(id)).map(([id]) => id);
      const produtosParados = idsParados.length
        ? await prisma.produto.findMany({ where: { id: { in: idsParados }, empresaId: req.user.empresaId } })
        : [];

      // Giro, cobertura e tendência (Seção 9) — usa snapshot diário real
      // quando disponível; cai para aproximação por produto quando o
      // histórico de snapshots daquele produto ainda é curto demais
      // (ver estoque-indicadores.service.ts e DEBITO-TECNICO.md item 8).
      const giroPorProduto = await calcularGiroPorProduto(req.user.empresaId, { filialId: query.filialId, diasPeriodo: query.diasGiro });

      // Lista de filiais da empresa, INDEPENDENTE de ter estoque.
      //
      // A tela derivava a lista de filiais das linhas de `estoques`, e uma
      // filial sem nenhuma linha não aparecia — nem no filtro (justamente o
      // caso que se quer consultar) nem na lista de destino da transferência
      // (que tornava impossivel transferir para ela). A lista de filiais é um
      // dado cadastral da empresa, e nao do estoque.
      const filiais = await prisma.filial.findMany({
        where: { empresaId: req.user.empresaId, status: { not: 'INATIVO' } },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      });

      return {
        estoques,
        filiais,
        indicadores: {
          // O frontend NÃO pode inferir isto da existência do valor: sem a
          // permissão o número é omitido, e adivinhar "se veio, pode mostrar"
          // é exatamente o que abria o bypass antes.
          podeVerCusto,
          valorTotal: podeVerCusto ? valorTotal : undefined,
          // Só as CONTAGENS vão na resposta. `baixo` e `semEstoque` iam antes como
          // arrays completos (cada linha com filial, produto, categoria e
          // fornecedor dentro) e a tela nunca os renderizou — ela recalcula
          // os dois números a partir de `estoques`, que já veio inteiro.
          // Eram milhares de linhas de payload duplicadas por request.
          qtdBaixo: baixo.length,
          qtdSemEstoque: semEstoque.length,
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
          quantidade: z.number().finite().min(0).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-8, 'Use no máximo 3 casas decimais.'),
          tipo: tipoMovimento,
          motivo: z.string().optional(),
          documento: z.string().optional(),
          origem: origemMovimento.default('MANUAL'),
        })
        .superRefine((data, contexto) => {
          if (data.tipo !== 'AJUSTE' && data.tipo !== 'INVENTARIO' && data.quantidade <= 0) {
            contexto.addIssue({ code: z.ZodIssueCode.too_small, origin: 'number', minimum: 1, inclusive: true, path: ['quantidade'], message: 'A quantidade deve ser maior que zero para este tipo de movimentação.' });
          }
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
        alerta: result.qtdNova <= Number(result.estoqueMinimo) ? { tipo: 'ESTOQUE_BAIXO', atual: result.qtdNova, minimo: Number(result.estoqueMinimo) } : null,
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
          quantidade: z.number().finite().positive().refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-8, 'Use no máximo 3 casas decimais.'),
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

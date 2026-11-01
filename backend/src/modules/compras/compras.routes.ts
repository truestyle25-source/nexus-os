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
import { converterParaUnidadeBaseCompra } from '../estoque/conversao.service.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);

export async function comprasRoutes(app: FastifyInstance): Promise<void> {
  // ===================== Fornecedores (Seção 11) =====================
  // Rotas legadas mantidas para a tela de Compras (GET/POST/PUT/PATCH em
  // /fornecedores). A aba /fornecedores v2 usa /api/v1/fornecedores
  // (fornecedores.routes.ts). Schema espelha o modelo v2 (status TEXT:
  // Ativo/Crítico/Inativo; documento em `cnpj`, com alias legado `cnpjCpf`).
  app.get(
    '/fornecedores',
    { preHandler: [app.authenticate, await permissaoMiddleware('fornecedores', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          search: z.string().optional(),
          status: z.enum(['Ativo', 'Crítico', 'Inativo', 'ATIVO', 'INATIVO', 'ARQUIVADO']).optional(),
        })
        .parse(req.query);
      const statusNormalizado =
        query.status === 'ATIVO' ? 'Ativo'
        : query.status === 'INATIVO' || query.status === 'ARQUIVADO' ? 'Inativo'
        : query.status;
      return prisma.fornecedor.findMany({
        where: {
          empresaId: req.user.empresaId,
          ...(query.search ? { nome: { contains: query.search, mode: 'insensitive' } } : {}),
          ...(statusNormalizado ? { status: statusNormalizado } : {}),
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
    cnpj: z.string().optional(),
    cnpjCpf: z.string().optional(), // alias legado (tela antiga) — persiste em `cnpj`
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
      const cnpj = clean(data.cnpj ?? data.cnpjCpf);
      if (cnpj) {
        const existente = await prisma.fornecedor.findFirst({ where: { empresaId: req.user.empresaId, cnpj } });
        if (existente) throw Conflito('Já existe um fornecedor com este CNPJ/CPF nesta empresa.');
      }
      const { cnpjCpf: _legado, ...paraGravar } = data;
      const fornecedor = await prisma.fornecedor.create({ data: { empresaId: req.user.empresaId, ...paraGravar, cnpj, origem: data.origem } });
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
      const cnpj = data.cnpj !== undefined || data.cnpjCpf !== undefined ? clean(data.cnpj ?? data.cnpjCpf) : undefined;
      if (cnpj && cnpj !== anterior.cnpj) {
        const existente = await prisma.fornecedor.findFirst({ where: { empresaId: req.user.empresaId, cnpj, NOT: { id } } });
        if (existente) throw Conflito('Já existe um fornecedor com este CNPJ/CPF nesta empresa.');
      }
      const { cnpjCpf: _legadoUpdate, ...dadosGravar } = data;
      const fornecedor = await prisma.fornecedor.update({ where: { id }, data: { ...dadosGravar, cnpj, updatedAt: new Date() } });
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
      const { status: statusRawF } = z
        .object({ status: z.enum(['Ativo', 'Crítico', 'Inativo', 'ATIVO', 'INATIVO', 'ARQUIVADO']) })
        .parse(req.body);
      // Normaliza valores legados para o vocabulário v2 (status TEXT).
      const status =
        statusRawF === 'ATIVO' ? 'Ativo'
        : statusRawF === 'INATIVO' || statusRawF === 'ARQUIVADO' ? 'Inativo'
        : statusRawF;
      const acao = 'editar';
      if (!(await temPermissao(req.user.id, 'fornecedores', acao))) return reply.status(403).send({ error: `Sem permissão: fornecedores.${acao}` });
      const anterior = await prisma.fornecedor.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!anterior) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
      const fornecedor = await prisma.fornecedor.update({ where: { id }, data: { status } });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: statusRawF === 'ARQUIVADO' ? 'EXCLUIR' : 'EDITAR',
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

      // Filiais e fornecedores vêm NO MESMO PAYLOAD, e não de `/filiais`.
      // Dois motivos:
      //  1) `/filiais` é gated por `empresa|estoque|pdv|vendas:visualizar` e
      //     NÃO por `compras:visualizar`. Um usuário do compras que não tivesse
      //     nenhuma das outras permissões receberia 403 ao montar a tela.
      //  2) A lista precisa ser a do cadastro, independente de existirem compras
      //     ou estoque — igual ao que a aba Estoque já faz.
      const [filiais, fornecedores] = await Promise.all([
        prisma.filial.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
        prisma.fornecedor.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, cnpj: true, status: true } }),
      ]);

      return { compras, total, take: query.take, skip: query.skip, filiais, fornecedores };
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

  const itensSchema = z.array(z.object({
    produtoId: z.string(),
    quantidade: z.number().finite().positive().refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-8),
    valorUnit: z.number().finite().positive(),
    unidadeCompra: z.string().optional(),
    fornecedorId: z.string().optional(),
  })).min(1);

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
      const fornecedor = await prisma.fornecedor.findFirst({ where: { id: data.fornecedorId, empresaId: req.user.empresaId, status: 'Ativo' } });
      if (!fornecedor) throw NaoEncontrado('Fornecedor inválido para esta empresa (ou inativo).');
      for (const item of data.itens) {
        const produto = await prisma.produto.findFirst({ where: { id: item.produtoId, empresaId: req.user.empresaId } });
        if (!produto) throw NaoEncontrado(`Produto ${item.produtoId} inválido para esta empresa.`);
      }
      const valorTotal = data.itens.reduce((soma: number, i: { quantidade: number; valorUnit: number }) => soma + i.quantidade * i.valorUnit, 0);

      // Etapa 5 — converter cada item para a unidade base antes de gravar.
      // Preserva o snapshot: unidade de compra, fator aplicado e quantidade base.
      const itensComConversao = await Promise.all(data.itens.map(async (i) => {
        const produto = await prisma.produto.findFirst({
          where: { id: i.produtoId, empresaId: req.user.empresaId },
          select: { id: true, nome: true, unidadeBaseId: true, tipoProdutoId: true },
        });
        if (!produto) throw NaoEncontrado(`Produto ${i.produtoId} inválido para esta empresa.`);
        if (!produto.unidadeBaseId) {
          // Unidade base não definida explicitamente; usa a unidade do produto como base
          // O serviço de conversão usará o fatorCanonico do banco de dados
          // A unidade de destino será a unidade do produto (simbolo)
        }
        // Determinar o símbolo da unidade base para conversão
        // O serviço de conversão usa unidadeBaseId se fornecido,
        // caso contrário usa a unidade do produto como base
        const conversao = await converterParaUnidadeBaseCompra({
          empresaId: req.user.empresaId,
          produtoId: i.produtoId,
          unidadeBaseId: produto.unidadeBaseId ?? undefined,
          quantidadeCompra: i.quantidade,
          unidadeCompraSimbolo: i.unidadeCompra ?? 'UN',
          fornecedorId: i.fornecedorId ?? data.fornecedorId,
        });
        return {
          produtoId: i.produtoId,
          quantidade: i.quantidade,
          unidadeCompra: i.unidadeCompra ?? 'UN',
          fatorAplicado: conversao.fator.toNumber(),
          quantidadeBase: conversao.quantidadeDestino.toNumber(),
          valorUnit: i.valorUnit,
        };
      }));

      const compra = await prisma.compra.create({
        data: {
          empresaId: req.user.empresaId,
          filialId: data.filialId,
          fornecedorId: data.fornecedorId,
          valorTotal,
          condPagamento: data.condPagamento,
          origem: data.origem,
          itens: { create: itensComConversao },
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
            quantidade: Number(item.quantidadeBase ?? item.quantidade),
            motivo: `Recebimento compra ${id}`,
            documento: id,
            origem: compra.origem,
          });
          // Etapa 4 — custo médio ponderado (política aprovada).
          // preco por unidade base = valorUnit / fatorAplicado (se houver fator)
          const fator = item.fatorAplicado && Number(item.fatorAplicado) > 0 ? Number(item.fatorAplicado) : 1;
          const precoUnitarioBase = Number(item.valorUnit) / fator;

          const estoqueAtual = await tx.estoque.findUnique({
            where: { filialId_produtoId: { filialId: compra.filialId, produtoId: produto.id } },
            select: { quantidade: true, valorTotal: true },
          });
          const qtdAtual = Number(estoqueAtual?.quantidade ?? 0);
          const valorAtual = Number(estoqueAtual?.valorTotal ?? 0);

          const novaQtd = qtdAtual + Number(item.quantidadeBase ?? item.quantidade);
          const novoValorTotal = valorAtual + (Number(item.quantidadeBase ?? item.quantidade) * precoUnitarioBase);
          const novoCusto = novaQtd > 0 ? novoValorTotal / novaQtd : precoUnitarioBase;

          await tx.produto.update({ where: { id: produto.id }, data: { custo: novoCusto } });
          if (estoqueAtual) {
            await tx.estoque.update({
              where: { filialId_produtoId: { filialId: compra.filialId, produtoId: produto.id } },
              data: { quantidade: novaQtd, valorTotal: novoValorTotal },
            });
          }
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
    // `status` passou a ser aceito aqui. Antes o schema não tinha o campo, o
    // POST/PUT gravavam SEMPRE ATIVO e a aba corrigia o status numa segunda
    // chamada (PATCH /clientes/:id/status). Essa segunda chamada podia falhar
    // (usuário com `criar` e sem `editar`, ou queda de rede) DEPOIS do
    // cadastro já gravado — a tela acusava erro, o modal continuava aberto e
    // o retry criava um cliente DUPLICADO. Uma escrita só, atômica, elimina
    // essa janela.
    //
    // ARQUIVADO continua exigindo `clientes.excluir` (ver guarda abaixo), o
    // mesmo que o PATCH exige — aceitar `status` no PUT não pode virar uma
    // porta paralela que burla a permissão de arquivar.
    status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']).optional(),
    origem: origemSchema.default('MANUAL'),
  });

  /** Arquivar é "excluir" no catálogo de permissões (mesma regra do PATCH). */
  async function podeMudarStatus(
    usuarioId: string,
    status: string | undefined,
  ): Promise<boolean> {
    if (status !== 'ARQUIVADO') return true;
    return temPermissao(usuarioId, 'clientes', 'excluir');
  }

  /**
   * Números do cliente DERIVADOS de `Venda` (fonte da verdade), em vez de lidos
   * das colunas `valorTotalComprado`/`frequencia`/`ticketMedio`/`ultimaCompra`.
   *
   * Motivo concreto: em `POST /vendas/:id/cancelar` o módulo Vendas recalcula
   * essas colunas ANTES de marcar a venda como CANCELADA — a consulta filtra
   * `status: 'FINALIZADA'` enquanto a venda ainda está FINALIZADA, então a venda
   * cancelada continua sendo contada. Na prática, estornar uma venda NUNCA
   * reduzia o valor do cliente: a aba Clientes mostrava para sempre o total da
   * venda estornada.
   *
   * Não corrigi o módulo Vendas (pertence a outra aba). Aqui a conta é feita na
   * leitura, então a aba mostra o número certo mesmo com essa falha lá — e os
   * nomes dos campos devolvidos são os mesmos, sem breaking change.
   *
   * Só vendas FINALIZADA contam: criar já grava FINALIZADA e cancelar vira
   * CANCELADA, então o filtro cobre exatamente os dois caminhos.
   */
  type NumerosCliente = { total: number; freq: number; ultima: Date | null };

  async function numerosReais(empresaId: string): Promise<Map<string, NumerosCliente>> {
    const grouped = await prisma.venda.groupBy({
      by: ['clienteId'],
      where: { empresaId, clienteId: { not: null }, status: 'FINALIZADA' },
      _sum: { total: true },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const mapa = new Map<string, NumerosCliente>();
    for (const g of grouped) {
      if (!g.clienteId) continue;
      const total = Number(g._sum.total ?? 0);
      const freq = g._count._all;
      mapa.set(g.clienteId, { total, freq, ultima: g._max.createdAt ?? null });
    }
    return mapa;
  }

  /** Sobrescreve as colunas desnormalizadas pelos números reais. */
  function comNumerosReais<T extends { id: string }>(cliente: T, mapa: Map<string, NumerosCliente>): T {
    const n = mapa.get(cliente.id);
    return {
      ...cliente,
      valorTotalComprado: n?.total ?? 0,
      frequencia: n?.freq ?? 0,
      ticketMedio: n && n.freq > 0 ? n.total / n.freq : 0,
      ultimaCompra: n?.ultima ?? null,
    };
  }

  app.get(
    '/clientes',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const query = z
        .object({ search: z.string().optional(), status: z.enum(['ATIVO', 'INATIVO', 'ARQUIVADO']).optional() })
        .parse(req.query);
      const [clientes, mapa] = await Promise.all([
        prisma.cliente.findMany({
          where: {
            empresaId: req.user.empresaId,
            ...(query.search ? { nome: { contains: query.search, mode: 'insensitive' } } : {}),
            ...(query.status ? { status: query.status } : { status: { in: ['ATIVO', 'INATIVO'] } }),
          },
          orderBy: { nome: 'asc' },
        }),
        numerosReais(req.user.empresaId),
      ]);
      return clientes.map((c) => comNumerosReais(c, mapa));
    },
  );

  app.get(
    '/clientes/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'visualizar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      const cliente = await prisma.cliente.findFirst({ where: { id, empresaId: req.user.empresaId } });
      if (!cliente) throw NaoEncontrado('Cliente não encontrado nesta empresa.');
      const [historicoVendas, mapa] = await Promise.all([
        prisma.venda.findMany({
          where: { clienteId: id, empresaId: req.user.empresaId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, total: true, status: true, createdAt: true, filialId: true },
        }),
        numerosReais(req.user.empresaId),
      ]);
      return { ...comNumerosReais(cliente, mapa), historicoVendas };
    },
  );

  app.post(
    '/clientes',
    { preHandler: [app.authenticate, await permissaoMiddleware('clientes', 'criar')] },
    async (req: FastifyRequest) => {
      const data = clienteSchema.parse(req.body);
      if (!(await podeMudarStatus(req.user.id, data.status))) {
        throw new ErroDeNegocio('Sem permissão: clientes.excluir (necessário para cadastrar já arquivado).', 403);
      }
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
      if (!(await podeMudarStatus(req.user.id, data.status))) {
        throw new ErroDeNegocio('Sem permissão: clientes.excluir (necessário para arquivar).', 403);
      }
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

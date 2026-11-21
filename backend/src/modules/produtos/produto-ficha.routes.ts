/**
 * Ficha completa do produto (cadastro ERP por abas) — 2026-11-21.
 *
 * Complementa produtos.routes.ts (que segue dono de POST/PUT /produtos e do status)
 * com o que cada aba da ficha precisa: catálogos, dados fiscais, códigos de
 * barras, configuração por filial, histórico (movimentações, documentos, preços,
 * cadastro), exportação e o estado REAL das integrações.
 *
 * Isolamento: toda consulta filtra por empresaId (e o RLS do banco garante o mesmo).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { temPermissao } from '../../lib/permissoes.js';
import { ErroDeNegocio, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { gerarPdf } from '../../lib/pdf.js';
import { garantirCatalogoPadrao } from './catalogo-produtos.service.js';
import { codigoEmUsoPorOutroProduto, registrarHistoricoPrecos } from './produto-campos.js';
import {
  REGIMES, TIPOS_CODIGO, calcularPrecificacao, inferirTipoCodigo, somaImpostosSobreVenda, validarCodigo, validarFiscal,
  type DadosFiscais, type Regime, type TipoCodigo,
} from './produto-regras.js';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function produtoDaEmpresa(empresaId: string, id: string) {
  const p = await prisma.produto.findFirst({ where: { id, empresaId } });
  if (!p) throw NaoEncontrado('Produto não encontrado nesta empresa.');
  return p;
}

/** Marca o produto como alterado: o PDV offline sincroniza por updatedAt. */
async function tocarProduto(tx: Prisma.TransactionClient, id: string) {
  await tx.produto.update({ where: { id }, data: { updatedAt: new Date() } });
}

async function regimeDaEmpresa(empresaId: string): Promise<Regime | null> {
  const e = await prisma.empresa.findFirst({ where: { id: empresaId }, select: { regimeTributario: true } });
  return (REGIMES as readonly string[]).includes(e?.regimeTributario ?? '') ? (e!.regimeTributario as Regime) : null;
}

/** Saldo por filial com reservado (carrinhos do PDV) e comprometido (vendas em aberto). */
async function saldosPorFilial(empresaId: string, produtoId: string) {
  const [filiais, estoques, reservas, comprometidas, configs] = await Promise.all([
    prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true, status: true }, orderBy: { nome: 'asc' } }),
    prisma.estoque.findMany({ where: { empresaId, produtoId }, select: { filialId: true, quantidade: true, valorTotal: true, local: true, lote: true } }),
    prisma.estoqueReserva.groupBy({ by: ['filialId'], where: { empresaId, produtoId, status: 'ATIVA', expiraEm: { gt: new Date() } }, _sum: { quantidade: true } }),
    prisma.$queryRaw<Array<{ filialId: string; qtd: number }>>`
      SELECT v."filialId", COALESCE(SUM(COALESCE(i."quantidadeBase", i."quantidade")), 0)::float AS qtd
      FROM "VendaItem" i JOIN "Venda" v ON v."id" = i."vendaId"
      WHERE v."empresaId" = ${empresaId} AND i."produtoId" = ${produtoId} AND v."status" = 'ABERTA'
      GROUP BY v."filialId"`,
    prisma.produtoFilial.findMany({ where: { empresaId, produtoId } }),
  ]);
  const est = new Map(estoques.map((e) => [e.filialId, e]));
  const res = new Map(reservas.map((r) => [r.filialId, Number(r._sum.quantidade ?? 0)]));
  const comp = new Map(comprometidas.map((c) => [c.filialId, Number(c.qtd)]));
  const cfg = new Map(configs.map((c) => [c.filialId, c]));
  return filiais.map((f) => {
    const e = est.get(f.id);
    const c = cfg.get(f.id);
    const atual = Number(e?.quantidade ?? 0);
    const reservado = res.get(f.id) ?? 0;
    const comprometido = comp.get(f.id) ?? 0;
    return {
      filialId: f.id, filialNome: f.nome, filialStatus: f.status,
      vinculado: c ? c.ativo : true,
      disponivelVenda: c ? c.disponivelVenda : true,
      atual, reservado, comprometido, disponivel: atual - reservado - comprometido,
      valorTotal: Number(e?.valorTotal ?? 0),
      local: e?.local ?? null, lote: e?.lote ?? null,
      precoVenda: num(c?.precoVenda), custo: num(c?.custo),
      estoqueMinimo: num(c?.estoqueMinimo), estoqueMaximo: num(c?.estoqueMaximo),
    };
  });
}

const filtrosMovimento = z.object({
  inicio: z.string().optional(),
  fim: z.string().optional(),
  filialId: z.string().optional(),
  tipo: z.string().optional(),
  usuarioId: z.string().optional(),
  documento: z.string().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

function whereMovimentos(empresaId: string, produtoId: string, f: z.infer<typeof filtrosMovimento>): Prisma.EstoqueMovimentacaoWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (f.inicio) createdAt.gte = new Date(`${f.inicio.slice(0, 10)}T00:00:00.000Z`);
  if (f.fim) createdAt.lte = new Date(`${f.fim.slice(0, 10)}T23:59:59.999Z`);
  return {
    empresaId, produtoId,
    ...(f.inicio || f.fim ? { createdAt } : {}),
    ...(f.filialId ? { filialId: f.filialId } : {}),
    ...(f.tipo ? { tipo: f.tipo as Prisma.EnumTipoMovEstoqueFilter['equals'] } : {}),
    ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
    ...(f.documento ? { documento: { contains: f.documento, mode: 'insensitive' as const } } : {}),
  };
}

async function listarMovimentos(req: FastifyRequest, produtoId: string, f: z.infer<typeof filtrosMovimento>, todos = false) {
  const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
  const where = whereMovimentos(req.user.empresaId, produtoId, f);
  const [linhas, total] = await Promise.all([
    prisma.estoqueMovimentacao.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: todos ? 0 : (f.pagina - 1) * f.limite,
      take: todos ? 5000 : f.limite,
      include: { filial: { select: { nome: true } }, filialDestino: { select: { nome: true } }, usuario: { select: { nome: true } }, kitProduto: { select: { id: true, nome: true } } },
    }),
    prisma.estoqueMovimentacao.count({ where }),
  ]);
  return {
    total, pagina: f.pagina, limite: f.limite,
    itens: linhas.map((m) => ({
      id: m.id, data: m.createdAt, tipo: m.tipo, quantidade: Number(m.quantidade),
      filial: m.filial?.nome ?? null, filialDestino: m.filialDestino?.nome ?? null,
      usuario: m.usuario?.nome ?? null, documento: m.documento, motivo: m.motivo, origem: m.origem,
      // Baixa feita pela venda de um KIT: qual kit originou a movimentação deste componente.
      kit: m.kitProduto ? { id: m.kitProduto.id, nome: m.kitProduto.nome } : null,
      saldoAnterior: num(m.saldoAnterior), saldoPosterior: num(m.saldoPosterior),
      ...(podeVerCusto ? { custoUnitario: num(m.custoUnitario) } : {}),
    })),
  };
}

export async function produtoFichaRoutes(app: FastifyInstance): Promise<void> {
  const ver = [app.authenticate, await permissaoMiddleware('produtos', 'visualizar')];
  const editar = [app.authenticate, await permissaoMiddleware('produtos', 'editar')];
  const verEstoque = [app.authenticate, await permissaoMiddleware('estoque', 'visualizar')];

  // ------------------------------------------------------------------ catálogos
  app.get('/produtos/catalogos', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    await prisma.$transaction((tx) => garantirCatalogoPadrao(empresaId, tx));
    const [unidades, tipos, categorias, filiais, fornecedores, regime] = await Promise.all([
      prisma.unidade.findMany({ where: { empresaId, ativo: true }, select: { id: true, simbolo: true, nome: true, fatorCanonico: true, dimensao: { select: { codigo: true, nome: true } } }, orderBy: [{ dimensaoId: 'asc' }, { fatorCanonico: 'asc' }] }),
      prisma.tipoProduto.findMany({ where: { empresaId, ativo: true }, select: { id: true, codigo: true, nome: true, descricao: true }, orderBy: { nome: 'asc' } }),
      prisma.categoria.findMany({ where: { empresaId }, select: { id: true, nome: true, categoriaPaiId: true, nivel: true }, orderBy: [{ nivel: 'asc' }, { nome: 'asc' }] }),
      prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true, status: true }, orderBy: { nome: 'asc' } }),
      prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      regimeDaEmpresa(empresaId),
    ]);
    return { unidades: unidades.map((u) => ({ ...u, fatorCanonico: Number(u.fatorCanonico) })), tipos, categorias, filiais, fornecedores, regimeTributario: regime, tiposCodigo: TIPOS_CODIGO };
  });

  // ------------------------------------------------------------------ ficha
  app.get('/produtos/:id/ficha', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const produto = await prisma.produto.findFirst({
      where: { id, empresaId },
      include: {
        categoria: { select: { id: true, nome: true, nivel: true, categoriaPaiId: true } },
        fornecedor: { select: { id: true, nome: true } },
        tipoProduto: { select: { id: true, codigo: true, nome: true } },
        unidadeBase: { select: { id: true, simbolo: true } },
        unidadeCompra: { select: { id: true, simbolo: true } },
        unidadeVenda: { select: { id: true, simbolo: true } },
        unidadeTributavel: { select: { id: true, simbolo: true } },
        fiscal: true,
        codigosBarras: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] },
        fatoresConversao: { where: { ativo: true }, include: { unidadeOrigem: { select: { simbolo: true } }, unidadeDestino: { select: { simbolo: true } } } },
      },
    });
    if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
    const [podeVerCusto, regime, filiais] = await Promise.all([
      temPermissao(req.user.id, 'custos', 'visualizar'),
      regimeDaEmpresa(empresaId),
      saldosPorFilial(empresaId, id),
    ]);

    // Cadeia grupo > subgrupos (até 4 níveis).
    const cadeia: Array<{ id: string; nome: string; nivel: number }> = [];
    let atual = produto.categoria;
    for (let i = 0; atual && i < 4; i++) {
      cadeia.unshift({ id: atual.id, nome: atual.nome, nivel: atual.nivel });
      atual = atual.categoriaPaiId
        ? await prisma.categoria.findFirst({ where: { id: atual.categoriaPaiId, empresaId }, select: { id: true, nome: true, nivel: true, categoriaPaiId: true } })
        : null;
    }

    const fiscal = produto.fiscal;
    const impostos = fiscal ? somaImpostosSobreVenda({
      aliquotaIcms: num(fiscal.aliquotaIcms), aliquotaPis: num(fiscal.aliquotaPis), aliquotaCofins: num(fiscal.aliquotaCofins),
      aliquotaIbs: num(fiscal.aliquotaIbs), aliquotaCbs: num(fiscal.aliquotaCbs),
    }) : 0;
    const precificacao = calcularPrecificacao({
      custo: Number(produto.custo), precoVenda: Number(produto.precoVenda), impostosPercentual: impostos,
      comissaoPercentual: num(produto.comissaoPercentual) ?? 0, despesasPercentual: num(produto.despesasPercentual) ?? 0,
      descontoMaximoPercentual: num(produto.descontoMaximoPercentual) ?? undefined,
    });

    const consolidado = filiais.reduce((s, f) => ({
      atual: s.atual + f.atual, reservado: s.reservado + f.reservado, comprometido: s.comprometido + f.comprometido,
      disponivel: s.disponivel + f.disponivel, valorTotal: s.valorTotal + f.valorTotal,
    }), { atual: 0, reservado: 0, comprometido: 0, disponivel: 0, valorTotal: 0 });

    const { custo, margem, precoCompra, ultimoCustoAquisicao, ...semCusto } = produto;
    return {
      produto: podeVerCusto ? produto : semCusto,
      podeVerCusto,
      regimeTributario: regime,
      categoriaCadeia: cadeia,
      estoque: {
        consolidado: podeVerCusto ? consolidado : { ...consolidado, valorTotal: undefined },
        filiais: filiais.map((f) => (podeVerCusto ? f : { ...f, valorTotal: undefined, custo: undefined })),
      },
      precificacao: podeVerCusto ? precificacao : null,
      impostosSobreVendaPercentual: impostos,
    };
  });

  // ------------------------------------------------------------------ fator de conversão (ex.: 1 CX = 12 UN)
  app.put('/produtos/:id/fator-conversao', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const corpo = z.object({
      unidadeOrigemId: z.string().min(1),
      unidadeDestinoId: z.string().min(1),
      fator: z.number().positive().max(1e7),
    }).parse(req.body);
    if (corpo.unidadeOrigemId === corpo.unidadeDestinoId) throw new ErroDeNegocio('Origem e destino da conversão devem ser unidades diferentes.', 400);
    await produtoDaEmpresa(empresaId, id);
    const unidades = await prisma.unidade.count({ where: { empresaId, id: { in: [corpo.unidadeOrigemId, corpo.unidadeDestinoId] } } });
    if (unidades !== 2) throw NaoEncontrado('Unidade de medida inválida para esta empresa.');
    const salvo = await prisma.$transaction(async (tx) => {
      // Um fator ativo por par (origem, destino) do produto, sem fornecedor específico: desativa o anterior.
      const anterior = await tx.fatorConversao.findFirst({ where: { empresaId, produtoId: id, unidadeOrigemId: corpo.unidadeOrigemId, unidadeDestinoId: corpo.unidadeDestinoId, fornecedorId: null, ativo: true } });
      if (anterior && Number(anterior.fator) === corpo.fator) return anterior;
      if (anterior) await tx.fatorConversao.update({ where: { id: anterior.id }, data: { ativo: false, vigenciaAte: new Date() } });
      const novo = await tx.fatorConversao.create({ data: { empresaId, produtoId: id, unidadeOrigemId: corpo.unidadeOrigemId, unidadeDestinoId: corpo.unidadeDestinoId, fator: corpo.fator, vigenciaDe: new Date() } });
      await tocarProduto(tx, id);
      return novo;
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Produto', entidadeId: id, valorNovo: { fatorConversao: { ...corpo } }, origem: 'MANUAL', ip: req.ip, contexto: 'Aba Dados (conversão de unidade)' });
    return { ...salvo, fator: Number(salvo.fator) };
  });

  // ------------------------------------------------------------------ tributos
  const fiscalSchema = z.object({
    ncm: z.string().trim().nullable().optional(),
    origemMercadoria: z.number().int().nullable().optional(),
    cest: z.string().trim().nullable().optional(),
    cfopEntrada: z.string().trim().nullable().optional(),
    cfopSaida: z.string().trim().nullable().optional(),
    cstIcms: z.string().trim().nullable().optional(),
    csosn: z.string().trim().nullable().optional(),
    aliquotaIcms: z.number().nullable().optional(),
    reducaoBaseIcms: z.number().nullable().optional(),
    cstPis: z.string().trim().nullable().optional(),
    aliquotaPis: z.number().nullable().optional(),
    cstCofins: z.string().trim().nullable().optional(),
    aliquotaCofins: z.number().nullable().optional(),
    cstIpi: z.string().trim().nullable().optional(),
    aliquotaIpi: z.number().nullable().optional(),
    codigoEnquadramentoIpi: z.string().trim().nullable().optional(),
    cstIbsCbs: z.string().trim().nullable().optional(),
    classificacaoTributaria: z.string().trim().nullable().optional(),
    aliquotaIbs: z.number().nullable().optional(),
    aliquotaCbs: z.number().nullable().optional(),
    naturezaOperacao: z.string().trim().max(120).nullable().optional(),
    informacoesAdicionais: z.string().trim().max(2000).nullable().optional(),
  });

  app.put('/produtos/:id/fiscal', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const corpo = fiscalSchema.parse(req.body);
    // Normaliza máscaras (pontos/hífens) antes de validar: o NCM chega como 0000.00.00 da tela.
    const d: Record<string, unknown> = { ...corpo };
    for (const c of ['ncm', 'cest', 'cfopEntrada', 'cfopSaida']) if (typeof d[c] === 'string') d[c] = (d[c] as string).replace(/\D/g, '') || null;
    for (const [k, v] of Object.entries(d)) if (v === '') d[k] = null;
    const anterior = await produtoDaEmpresa(empresaId, id);
    const regime = await regimeDaEmpresa(empresaId);
    const { erros, avisos } = validarFiscal(regime, d as DadosFiscais);
    if (erros.length) return reply.status(422).send({ error: 'Dados fiscais inválidos.', erros, avisos });
    const { ncm, ...fiscal } = d as DadosFiscais & { naturezaOperacao?: string | null; informacoesAdicionais?: string | null };
    const anteriorFiscal = await prisma.produtoFiscal.findUnique({ where: { produtoId: id } });
    const salvo = await prisma.$transaction(async (tx) => {
      if (ncm !== undefined) await tx.produto.update({ where: { id }, data: { ncm } });
      const r = await tx.produtoFiscal.upsert({
        where: { produtoId: id },
        create: { ...(fiscal as Prisma.ProdutoFiscalUncheckedCreateInput), empresaId, produtoId: id },
        update: fiscal as Prisma.ProdutoFiscalUncheckedUpdateInput,
      });
      await tocarProduto(tx, id);
      return r;
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Produto', entidadeId: id,
      valorAnterior: { ncm: anterior.ncm, fiscal: anteriorFiscal }, valorNovo: { ncm: ncm ?? anterior.ncm, fiscal: salvo },
      origem: 'MANUAL', ip: req.ip, contexto: 'Aba Tributos',
    });
    return { fiscal: salvo, avisos, regimeTributario: regime };
  });

  // ------------------------------------------------------------------ códigos de barras
  app.get('/produtos/:id/codigos-barras', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    await produtoDaEmpresa(req.user.empresaId, id);
    return prisma.produtoCodigoBarras.findMany({ where: { empresaId: req.user.empresaId, produtoId: id }, orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] });
  });

  app.post('/produtos/:id/codigos-barras', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const corpo = z.object({
      codigo: z.string().trim().min(1).max(30),
      tipo: z.enum(TIPOS_CODIGO).optional(),
      descricao: z.string().trim().max(120).optional(),
      principal: z.boolean().optional(),
    }).parse(req.body);
    await produtoDaEmpresa(empresaId, id);
    const tipo: TipoCodigo = corpo.tipo ?? inferirTipoCodigo(corpo.codigo);
    const erro = validarCodigo(corpo.codigo, tipo);
    if (erro) throw new ErroDeNegocio(erro, 422);
    if (corpo.principal && !['EAN13', 'EAN8', 'UPCA'].includes(tipo)) {
      throw new ErroDeNegocio('O código principal precisa ser EAN-13, EAN-8 ou UPC-A (é o lido pelo PDV e impresso na etiqueta).', 422);
    }
    if (await codigoEmUsoPorOutroProduto(empresaId, corpo.codigo, id)) throw Conflito('Este código já identifica outro produto da empresa.');
    const mesmo = await prisma.produtoCodigoBarras.findFirst({ where: { empresaId, produtoId: id, codigo: corpo.codigo } });
    if (mesmo) throw Conflito('Este código já está cadastrado neste produto.');
    const criado = await prisma.$transaction(async (tx) => {
      if (corpo.principal) {
        await tx.produtoCodigoBarras.updateMany({ where: { empresaId, produtoId: id }, data: { principal: false } });
        await tx.produto.update({ where: { id }, data: { codigoBarras: corpo.codigo } });
      }
      const c = await tx.produtoCodigoBarras.create({ data: { empresaId, produtoId: id, codigo: corpo.codigo, tipo, descricao: corpo.descricao, principal: corpo.principal ?? false } });
      await tocarProduto(tx, id);
      return c;
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'CRIAR', entidade: 'Produto', entidadeId: id, valorNovo: { codigo: criado.codigo, tipo, principal: criado.principal }, origem: 'MANUAL', ip: req.ip, contexto: 'Aba Código de Barras' });
    return criado;
  });

  app.delete('/produtos/:id/codigos-barras/:codigoId', { preHandler: editar }, async (req) => {
    const { id, codigoId } = req.params as { id: string; codigoId: string };
    const empresaId = req.user.empresaId;
    const c = await prisma.produtoCodigoBarras.findFirst({ where: { id: codigoId, empresaId, produtoId: id } });
    if (!c) throw NaoEncontrado('Código não encontrado neste produto.');
    await prisma.$transaction(async (tx) => {
      await tx.produtoCodigoBarras.delete({ where: { id: c.id } });
      if (c.principal) await tx.produto.update({ where: { id }, data: { codigoBarras: null } });
      await tocarProduto(tx, id);
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'EXCLUIR', entidade: 'Produto', entidadeId: id, valorAnterior: { codigo: c.codigo, tipo: c.tipo, principal: c.principal }, origem: 'MANUAL', ip: req.ip, contexto: 'Aba Código de Barras' });
    return { ok: true };
  });

  /** Busca um produto por QUALQUER código (principal, adicional, SKU ou referência) — leitor de código de barras. */
  app.get('/produtos/codigo/:codigo', { preHandler: ver }, async (req) => {
    const { codigo } = req.params as { codigo: string };
    const empresaId = req.user.empresaId;
    const limpo = codigo.trim();
    const adicional = await prisma.produtoCodigoBarras.findFirst({ where: { empresaId, codigo: limpo }, select: { produtoId: true, tipo: true } });
    const produto = await prisma.produto.findFirst({
      where: { empresaId, OR: [{ id: adicional?.produtoId ?? '__nenhum__' }, { codigoBarras: limpo }, { sku: limpo }, { referencia: limpo }] },
      select: { id: true, nome: true, sku: true, codigoBarras: true, precoVenda: true, status: true },
    });
    if (!produto) throw NaoEncontrado('Nenhum produto com este código.');
    return { ...produto, precoVenda: Number(produto.precoVenda), tipoCodigo: adicional?.tipo ?? null };
  });

  // ------------------------------------------------------------------ filiais
  app.get('/produtos/:id/filiais', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const produto = await produtoDaEmpresa(req.user.empresaId, id);
    const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
    const filiais = await saldosPorFilial(req.user.empresaId, id);
    return filiais.map((f) => ({
      ...f,
      precoEfetivo: f.precoVenda ?? Number(produto.precoVenda),
      estoqueMinimoEfetivo: f.estoqueMinimo ?? Number(produto.estoqueMinimo),
      estoqueMaximoEfetivo: f.estoqueMaximo ?? Number(produto.estoqueMaximo),
      ...(podeVerCusto ? { custoEfetivo: f.custo ?? Number(produto.custo) } : { custo: undefined, valorTotal: undefined }),
    }));
  });

  app.put('/produtos/:id/filiais', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const corpo = z.object({
      filiais: z.array(z.object({
        filialId: z.string().min(1),
        ativo: z.boolean().optional(),
        disponivelVenda: z.boolean().optional(),
        precoVenda: z.number().positive().nullable().optional(),
        custo: z.number().min(0).nullable().optional(),
        estoqueMinimo: z.number().min(0).nullable().optional(),
        estoqueMaximo: z.number().min(0).nullable().optional(),
      })).min(1).max(500),
      justificativa: z.string().trim().max(300).optional(),
    }).parse(req.body);
    const produto = await produtoDaEmpresa(empresaId, id);
    const ids = [...new Set(corpo.filiais.map((f) => f.filialId))];
    const filiaisValidas = await prisma.filial.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true, nome: true } });
    if (filiaisValidas.length !== ids.length) throw NaoEncontrado('Uma ou mais filiais não pertencem a esta empresa.');
    if (corpo.filiais.some((f) => f.custo !== undefined) && !(await temPermissao(req.user.id, 'custos', 'editar'))) {
      throw new ErroDeNegocio('Sem permissão: custos.editar', 403);
    }
    const anteriores = new Map((await prisma.produtoFilial.findMany({ where: { empresaId, produtoId: id } })).map((c) => [c.filialId, c]));
    const saldos = new Map((await prisma.estoque.findMany({ where: { empresaId, produtoId: id }, select: { filialId: true, quantidade: true } })).map((e) => [e.filialId, Number(e.quantidade)]));
    const desvinculos = corpo.filiais.filter((f) => f.ativo === false && (anteriores.get(f.filialId)?.ativo ?? true));
    if (desvinculos.length) {
      // "Desvincular mediante autorização": exige produtos.administrar e saldo zerado (estoque não pode ficar órfão).
      if (!(await temPermissao(req.user.id, 'produtos', 'administrar'))) throw new ErroDeNegocio('Desvincular filial exige a permissão produtos.administrar.', 403);
      const comSaldo = desvinculos.filter((f) => (saldos.get(f.filialId) ?? 0) !== 0);
      if (comSaldo.length) {
        const nomes = comSaldo.map((f) => filiaisValidas.find((x) => x.id === f.filialId)?.nome).join(', ');
        throw new ErroDeNegocio(`Não é possível desvincular filial com saldo em estoque (${nomes}). Transfira ou ajuste o saldo antes.`, 422);
      }
    }
    for (const f of corpo.filiais) {
      const a = anteriores.get(f.filialId);
      const min = f.estoqueMinimo !== undefined ? f.estoqueMinimo : num(a?.estoqueMinimo);
      const max = f.estoqueMaximo !== undefined ? f.estoqueMaximo : num(a?.estoqueMaximo);
      if (min != null && max != null && max < min) throw new ErroDeNegocio('Estoque máximo da filial não pode ser menor que o mínimo.', 400);
    }
    await prisma.$transaction(async (tx) => {
      for (const f of corpo.filiais) {
        const a = anteriores.get(f.filialId);
        const dados = {
          ...(f.ativo !== undefined ? { ativo: f.ativo } : {}),
          ...(f.disponivelVenda !== undefined ? { disponivelVenda: f.disponivelVenda } : {}),
          ...(f.precoVenda !== undefined ? { precoVenda: f.precoVenda } : {}),
          ...(f.custo !== undefined ? { custo: f.custo } : {}),
          ...(f.estoqueMinimo !== undefined ? { estoqueMinimo: f.estoqueMinimo } : {}),
          ...(f.estoqueMaximo !== undefined ? { estoqueMaximo: f.estoqueMaximo } : {}),
        };
        await tx.produtoFilial.upsert({
          where: { produtoId_filialId: { produtoId: id, filialId: f.filialId } },
          create: { empresaId, produtoId: id, filialId: f.filialId, ...dados },
          update: dados,
        });
        // Vincular garante a linha de saldo (quantidade 0) na filial.
        if (f.ativo !== false) {
          await tx.estoque.createMany({ data: [{ empresaId, filialId: f.filialId, produtoId: id, quantidade: 0, valorTotal: 0 }], skipDuplicates: true });
        }
        if (f.precoVenda !== undefined && num(a?.precoVenda) !== f.precoVenda) {
          await tx.produtoPrecoHistorico.create({ data: {
            empresaId, produtoId: id, filialId: f.filialId, campo: 'PRECO_FILIAL',
            valorAnterior: num(a?.precoVenda) ?? Number(produto.precoVenda), valorNovo: f.precoVenda ?? Number(produto.precoVenda),
            usuarioId: req.user.id, justificativa: corpo.justificativa ?? null,
          } });
        }
      }
      await tocarProduto(tx, id);
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Produto', entidadeId: id, valorAnterior: Object.fromEntries(anteriores), valorNovo: corpo.filiais, origem: 'MANUAL', ip: req.ip, contexto: 'Aba Filial' });
    return { ok: true, atualizadas: corpo.filiais.length };
  });

  // ------------------------------------------------------------------ movimento (histórico)
  app.get('/produtos/:id/movimentacoes', { preHandler: verEstoque }, async (req) => {
    const { id } = req.params as { id: string };
    await produtoDaEmpresa(req.user.empresaId, id);
    return listarMovimentos(req, id, filtrosMovimento.parse(req.query));
  });

  app.get('/produtos/:id/movimentacoes/exportar', { preHandler: verEstoque }, async (req) => {
    const { id } = req.params as { id: string };
    const { formato, ...q } = z.object({ formato: z.enum(['xlsx', 'pdf']) }).passthrough().parse(req.query);
    const produto = await produtoDaEmpresa(req.user.empresaId, id);
    const { itens, total } = await listarMovimentos(req, id, filtrosMovimento.parse(q), true);
    const nomeBase = `movimentacoes-${(produto.sku || produto.id).replace(/[^A-Za-z0-9-]/g, '')}`;
    const cabecalho = ['Data', 'Tipo', 'Filial', 'Quantidade', 'Saldo anterior', 'Saldo posterior', 'Custo unit.', 'Documento', 'Usuário', 'Motivo'];
    const linhas = itens.map((m) => [
      new Date(m.data).toISOString().replace('T', ' ').slice(0, 16), m.tipo, m.filial ?? '', m.quantidade,
      m.saldoAnterior ?? '', m.saldoPosterior ?? '', 'custoUnitario' in m ? (m.custoUnitario ?? '') : '', m.documento ?? '', m.usuario ?? '', m.motivo ?? '',
    ]);
    if (formato === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Movimentações');
      ws.addRow([`Movimentações — ${produto.nome}`]).font = { bold: true, size: 13 };
      ws.addRow([`${total} registro(s)${itens.length < total ? ` (primeiros ${itens.length})` : ''}`]);
      ws.addRow([]);
      ws.addRow(cabecalho).font = { bold: true };
      for (const l of linhas) ws.addRow(l);
      ws.columns.forEach((c, i) => { c.width = [17, 16, 18, 11, 14, 14, 12, 26, 18, 30][i] ?? 14; });
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      return { nome: `${nomeBase}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buffer.toString('base64'), registros: itens.length };
    }
    const larguras = [17, 15, 14, 9, 9, 9];
    const linhaTexto = (cols: Array<string | number>) => cols.slice(0, 6).map((c, i) => String(c).slice(0, larguras[i]).padEnd(larguras[i])).join(' ') + `  ${String(cols[7] ?? '').slice(0, 24)}`;
    const pdf = gerarPdf({
      titulo: `Movimentações — ${produto.nome}`,
      subtitulo: `${total} registro(s)${itens.length < total ? ` (primeiros ${itens.length})` : ''} · SKU ${produto.sku ?? '—'}`,
      blocos: [
        { texto: linhaTexto(['Data', 'Tipo', 'Filial', 'Qtd', 'Anterior', 'Posterior', '', 'Documento']), negrito: true, tamanho: 8 },
        ...linhas.map((l) => ({ texto: linhaTexto(l), tamanho: 8 })),
      ],
      rodape: `NEXUS OS · gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    });
    return { nome: `${nomeBase}.pdf`, mime: 'application/pdf', base64: pdf.toString('base64'), registros: itens.length };
  });

  /** Documentos que envolveram o produto: notas de entrada (compras), saídas (vendas), cupons (PDV) e notas manuais. */
  app.get('/produtos/:id/documentos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const q = z.object({
      tipo: z.enum(['entrada', 'saida', 'cupom', 'manual', 'servico']),
      inicio: z.string().optional(), fim: z.string().optional(), filialId: z.string().optional(), fornecedorId: z.string().optional(),
      pagina: z.coerce.number().int().min(1).default(1), limite: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    await produtoDaEmpresa(empresaId, id);
    const inicio = q.inicio ? new Date(`${q.inicio.slice(0, 10)}T00:00:00.000Z`) : null;
    const fim = q.fim ? new Date(`${q.fim.slice(0, 10)}T23:59:59.999Z`) : null;
    const skip = (q.pagina - 1) * q.limite;

    if (q.tipo === 'servico') {
      return { itens: [], total: 0, aviso: 'O NEXUS OS ainda não emite nem registra notas de serviço.' };
    }
    if (q.tipo === 'entrada') {
      const where: Prisma.CompraItemWhereInput = {
        produtoId: id,
        compra: {
          empresaId,
          ...(q.filialId ? { filialId: q.filialId } : {}),
          ...(q.fornecedorId ? { fornecedorId: q.fornecedorId } : {}),
          ...(inicio || fim ? { dataCompra: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } } : {}),
        },
      };
      const [itens, total] = await Promise.all([
        prisma.compraItem.findMany({ where, skip, take: q.limite, orderBy: { compra: { dataCompra: 'desc' } }, include: { compra: { select: { id: true, status: true, dataCompra: true, dataRecebimento: true, fornecedor: { select: { nome: true } }, filial: { select: { nome: true } } } } } }),
        prisma.compraItem.count({ where }),
      ]);
      return {
        total,
        aviso: 'Entradas registradas por pedido de compra. A importação de NF-e (XML) ainda não existe.',
        itens: itens.map((i) => ({
          documento: i.compra.id, modelo: 'Pedido de compra', status: i.compra.status, parceiro: i.compra.fornecedor?.nome ?? null,
          filial: i.compra.filial?.nome ?? null, dataEmissao: i.compra.dataCompra, dataEntrada: i.compra.dataRecebimento,
          quantidade: Number(i.quantidade), unidade: i.unidadeCompra, valorUnitario: Number(i.valorUnit), valorTotal: Number(i.quantidade) * Number(i.valorUnit),
        })),
      };
    }
    if (q.tipo === 'saida' || q.tipo === 'cupom') {
      const where: Prisma.VendaItemWhereInput = {
        produtoId: id,
        venda: {
          empresaId,
          caixaId: q.tipo === 'cupom' ? { not: null } : null,
          ...(q.filialId ? { filialId: q.filialId } : {}),
          ...(inicio || fim ? { createdAt: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } } : {}),
        },
      };
      const [itens, total] = await Promise.all([
        prisma.vendaItem.findMany({ where, skip, take: q.limite, orderBy: { venda: { createdAt: 'desc' } }, include: { venda: { select: { id: true, status: true, createdAt: true, filialId: true, cliente: { select: { nome: true } } } } } }),
        prisma.vendaItem.count({ where }),
      ]);
      const nomesFilial = new Map((await prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
      return {
        total,
        aviso: q.tipo === 'cupom' ? 'Cupons do PDV (não fiscais). A emissão de NFC-e ainda não existe.' : 'Vendas fora do PDV. A emissão de NF-e ainda não existe.',
        itens: itens.map((i) => ({
          documento: i.venda.id, modelo: q.tipo === 'cupom' ? 'Cupom PDV (não fiscal)' : 'Venda', status: i.venda.status,
          parceiro: i.venda.cliente?.nome ?? 'Consumidor', filial: nomesFilial.get(i.venda.filialId) ?? null,
          dataEmissao: i.venda.createdAt, dataEntrada: null,
          quantidade: Number(i.quantidade), unidade: i.unidadeVenda, valorUnitario: Number(i.preco), valorTotal: Number(i.total),
        })),
      };
    }
    // manual: movimentações manuais com documento informado
    const where: Prisma.EstoqueMovimentacaoWhereInput = {
      empresaId, produtoId: id, origem: 'MANUAL', documento: { not: null },
      tipo: { in: ['ENTRADA', 'SAIDA', 'AJUSTE', 'PERDA', 'AVARIA', 'DESCARTE', 'DEVOLUCAO'] },
      ...(q.filialId ? { filialId: q.filialId } : {}),
      ...(inicio || fim ? { createdAt: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } } : {}),
    };
    const [itens, total] = await Promise.all([
      prisma.estoqueMovimentacao.findMany({ where, skip, take: q.limite, orderBy: { createdAt: 'desc' }, include: { filial: { select: { nome: true } }, usuario: { select: { nome: true } } } }),
      prisma.estoqueMovimentacao.count({ where }),
    ]);
    return {
      total,
      itens: itens.map((m) => ({
        documento: m.documento, modelo: `Manual (${m.tipo})`, status: null, parceiro: m.usuario?.nome ?? null, filial: m.filial?.nome ?? null,
        dataEmissao: m.createdAt, dataEntrada: m.createdAt, quantidade: Number(m.quantidade), unidade: null, valorUnitario: num(m.custoUnitario), valorTotal: m.custoUnitario == null ? null : Math.abs(Number(m.quantidade)) * Number(m.custoUnitario),
      })),
    };
  });

  app.get('/produtos/:id/historico-precos', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    await produtoDaEmpresa(req.user.empresaId, id);
    const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
    const linhas = await prisma.produtoPrecoHistorico.findMany({
      where: { empresaId: req.user.empresaId, produtoId: id, ...(podeVerCusto ? {} : { campo: { notIn: ['CUSTO', 'PRECO_COMPRA'] } }) },
      orderBy: { createdAt: 'desc' }, take: 500,
      include: { usuario: { select: { nome: true } }, filial: { select: { nome: true } } },
    });
    return linhas.map((l) => ({
      id: l.id, data: l.createdAt, campo: l.campo, valorAnterior: num(l.valorAnterior), valorNovo: num(l.valorNovo),
      usuario: l.usuario?.nome ?? null, filial: l.filial?.nome ?? null, justificativa: l.justificativa, origem: l.origem,
    }));
  });

  app.get('/produtos/:id/historico-cadastro', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    await produtoDaEmpresa(req.user.empresaId, id);
    const podeVerCusto = await temPermissao(req.user.id, 'custos', 'visualizar');
    const OCULTOS = podeVerCusto ? new Set<string>() : new Set(['custo', 'margem', 'precoCompra', 'ultimoCustoAquisicao']);
    const IGNORAR = new Set(['updatedAt', 'createdAt', 'id', 'empresaId']);
    const linhas = await prisma.auditoria.findMany({ where: { empresaId: req.user.empresaId, entidade: 'Produto', entidadeId: id }, orderBy: { createdAt: 'desc' }, take: 300 });
    const usuarios = new Map((await prisma.usuario.findMany({ where: { empresaId: req.user.empresaId, id: { in: [...new Set(linhas.map((l) => l.usuarioId).filter((u): u is string => !!u))] } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    return linhas.map((l) => {
      const antes = (l.valorAnterior ?? {}) as Record<string, unknown>;
      const depois = (l.valorNovo ?? {}) as Record<string, unknown>;
      const campos = [...new Set([...Object.keys(antes), ...Object.keys(depois)])]
        .filter((k) => !IGNORAR.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
        .map((k) => (OCULTOS.has(k) ? { campo: k, antes: '•••', depois: '•••' } : { campo: k, antes: antes[k] ?? null, depois: depois[k] ?? null }));
      return { id: l.id, data: l.createdAt, acao: l.acao, usuario: l.usuarioId ? usuarios.get(l.usuarioId) ?? null : null, contexto: l.contexto, campos: campos.slice(0, 40) };
    });
  });

  // ------------------------------------------------------------------ integrações (estado REAL)
  app.get('/produtos/:id/integracoes', { preHandler: ver }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const p = await prisma.produto.findFirst({ where: { id, empresaId }, include: { fiscal: true, codigosBarras: true, fornecedor: { select: { nome: true } } } });
    if (!p) throw NaoEncontrado('Produto não encontrado nesta empresa.');
    const [compras, ultimaCompra, fornecedoresDistintos, contaMl, contaShopee, chavesApi, empresa] = await Promise.all([
      prisma.compraItem.count({ where: { produtoId: id, compra: { empresaId } } }),
      prisma.compraItem.findFirst({ where: { produtoId: id, compra: { empresaId } }, orderBy: { compra: { dataCompra: 'desc' } }, select: { compra: { select: { dataCompra: true } } } }),
      prisma.compra.findMany({ where: { empresaId, itens: { some: { produtoId: id } } }, select: { fornecedorId: true }, distinct: ['fornecedorId'] }),
      prisma.integracaoExterno.findFirst({ where: { empresaId, tipo: 'MERCADO_LIVRE' }, select: { status: true } }),
      prisma.shopeeConexao.findFirst({ where: { empresaId }, select: { status: true } }).catch(() => null),
      prisma.chaveApi.count({ where: { empresaId, status: 'ATIVA' } }),
      prisma.empresa.findFirst({ where: { id: empresaId }, select: { regimeTributario: true } }),
    ]);
    const codigoBalanca = p.codigosBarras.find((c) => c.tipo === 'BALANCA');
    const fiscalCompleto = !!(p.ncm && p.fiscal?.cfopSaida && (p.fiscal?.cstIcms || p.fiscal?.csosn));
    const ativo = p.status === 'ATIVO';
    return [
      { chave: 'pdv', nome: 'PDV', estado: ativo && p.disponivelPdv ? 'ATIVO' : 'INATIVO',
        detalhe: ativo && p.disponivelPdv ? `No catálogo do PDV (offline incluso), com ${p.codigosBarras.length} código(s) de leitura.` : 'Fora do catálogo do PDV (produto inativo ou indisponível no PDV).' },
      { chave: 'balanca', nome: 'Balança', estado: p.controlaBalanca ? (codigoBalanca ? 'PARCIAL' : 'PENDENTE') : 'NAO_APLICAVEL',
        detalhe: p.controlaBalanca
          ? `${codigoBalanca ? `PLU ${codigoBalanca.codigo} cadastrado.` : 'Cadastre o código de balança (PLU).'} O NEXUS OS ainda não envia itens à balança nem lê etiqueta de peso no PDV.`
          : 'Produto sem controle por balança.' },
      { chave: 'impressoras', nome: 'Impressoras', estado: 'PARCIAL',
        detalhe: `Cupom não fiscal impresso pelo navegador no PDV.${p.enviaCozinha || p.imprimeFichaExpedicao ? ' Envio à cozinha e ficha de expedição estão marcados no cadastro, mas a impressão de produção ainda não existe.' : ''}` },
      { chave: 'fiscal', nome: 'Sistema fiscal', estado: 'NAO_IMPLEMENTADO',
        detalhe: `Emissão de NF-e/NFC-e não implementada (sem provedor fiscal homologado). Cadastro fiscal do produto: ${fiscalCompleto ? 'NCM, CFOP de saída e CST/CSOSN preenchidos' : 'incompleto (falta NCM, CFOP de saída ou CST/CSOSN)'}. Regime da empresa: ${empresa?.regimeTributario ?? 'não informado'}.` },
      { chave: 'compras', nome: 'Compras', estado: compras > 0 ? 'ATIVO' : 'SEM_MOVIMENTO',
        detalhe: compras > 0 ? `${compras} item(ns) de compra; última em ${ultimaCompra?.compra.dataCompra.toISOString().slice(0, 10)}. O recebimento atualiza estoque e custo.` : 'Nenhuma compra deste produto ainda.' },
      { chave: 'fornecedores', nome: 'Fornecedores', estado: p.fornecedorId ? 'ATIVO' : 'PENDENTE',
        detalhe: `${p.fornecedor ? `Fornecedor principal: ${p.fornecedor.nome}.` : 'Sem fornecedor principal.'} ${fornecedoresDistintos.length} fornecedor(es) já forneceram este produto.` },
      { chave: 'marketplaces', nome: 'Marketplaces', estado: p.sku?.startsWith('ML-') ? 'ATIVO' : contaMl || contaShopee ? 'NAO_VINCULADO' : 'NAO_CONFIGURADO',
        detalhe: `Mercado Livre: ${contaMl ? `conta ${contaMl.status}` : 'não conectado'}${p.sku?.startsWith('ML-') ? ' — produto vinculado a anúncio (SKU ML-).' : ''}. Shopee: ${contaShopee ? `conta ${contaShopee.status}` : 'não conectada'}.` },
      { chave: 'api', nome: 'Integrações externas (API pública)', estado: chavesApi > 0 && ativo ? 'ATIVO' : 'NAO_CONFIGURADO',
        detalhe: chavesApi > 0 ? `Exposto em GET /api/v1/produtos para ${chavesApi} chave(s) de API ativa(s) com o escopo produtos:leitura.` : 'Nenhuma chave de API ativa.' },
    ];
  });
}

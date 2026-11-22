import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { Conflito, ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { converterParaUnidadeBaseCompra } from '../estoque/conversao.service.js';
import { STATUS_QUE_RECEBEM_PEDIDO } from '../fornecedores/fornecedor-ficha.service.js';
import { baixarObjeto, configStorage, contentTypeDe, enviarObjeto, extensaoDe, montaChave, storageConfigurado, validaTamanho } from '../../lib/storage.js';
import {
  EDITAVEIS, ENVIAVEIS, RECEBEM, ROTULO_STATUS, calcularTotais, confirmarRecebimento, cronograma, numeroExibido, pdfDoPedido, proximoNumeroCompra,
} from './compra.service.js';
import { canaisConfigurados, enviarPorEmail, enviarPorWhatsApp, linkConversaWhatsApp } from './canais-envio.js';

/**
 * Módulo Compras — ficha completa e telas de acompanhamento (prefixo /api/v1/compras).
 * As rotas antigas (/compras, /compras/:id/confirmar|receber|cancelar) continuam em compras.routes.ts e
 * usam as mesmas regras (o recebimento antigo virou o "recebimento total" de compra.service.ts).
 */

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const dinheiro = z.number().finite().min(0).max(1e10);

const itemSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().finite().positive().refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-8, 'Até 3 casas decimais.'),
  valorUnit: z.number().finite().min(0).max(1e9),
  unidadeCompra: z.string().trim().min(1).max(10).optional(),
  desconto: dinheiro.optional(),
  observacao: z.string().trim().max(300).nullable().optional(),
});
const fichaSchema = z.object({
  filialId: z.string().min(1).optional(),
  fornecedorId: z.string().min(1).optional(),
  responsavelId: z.string().min(1).nullable().optional(),
  dataCompra: data,
  previsaoEntrega: data,
  prioridade: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).optional(),
  condPagamento: z.string().trim().max(40).nullable().optional(),
  formaPagamento: z.enum(['BOLETO', 'PIX', 'TRANSFERENCIA', 'CARTAO', 'DINHEIRO', 'OUTRO']).nullable().optional(),
  parcelas: z.number().int().min(1).max(60).optional(),
  primeiroVencimento: data,
  contaFinanceira: z.string().trim().max(80).nullable().optional(),
  centroCusto: z.string().trim().max(60).nullable().optional(),
  planoContas: z.string().trim().max(60).nullable().optional(),
  observacoesFinanceiras: z.string().trim().max(1000).nullable().optional(),
  observacoes: z.string().trim().max(4000).nullable().optional(),
  observacoesFornecedor: z.string().trim().max(2000).nullable().optional(),
  desconto: dinheiro.optional(),
  frete: dinheiro.optional(),
  outrasDespesas: dinheiro.optional(),
  itens: z.array(itemSchema).max(300).optional(),
});
type Ficha = z.infer<typeof fichaSchema>;
const CAMPOS_AUDITADOS = ['filialId', 'fornecedorId', 'responsavelId', 'dataCompra', 'previsaoEntrega', 'prioridade', 'condPagamento', 'formaPagamento', 'parcelas',
  'primeiroVencimento', 'contaFinanceira', 'centroCusto', 'planoContas', 'observacoesFinanceiras', 'observacoes', 'observacoesFornecedor', 'desconto', 'frete',
  'outrasDespesas', 'valorTotal', 'status'];

function diferencas(a: Record<string, unknown>, b: Record<string, unknown>, campos: string[]) {
  const n = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v instanceof Prisma.Decimal ? Number(v) : v ?? null);
  return campos.filter((c) => JSON.stringify(n(a[c])) !== JSON.stringify(n(b[c]))).map((c) => ({ campo: c, anterior: n(a[c]), novo: n(b[c]) }));
}

async function auditar(req: FastifyRequest, compraId: string, acao: 'CRIAR' | 'EDITAR' | 'EXCLUIR', contexto: string, valorAnterior?: unknown, valorNovo?: unknown) {
  await registrarAuditoria({
    usuarioId: req.user.id, empresaId: req.user.empresaId, acao, entidade: 'Compra', entidadeId: compraId,
    valorAnterior: valorAnterior as Prisma.InputJsonValue, valorNovo: valorNovo as Prisma.InputJsonValue, origem: 'MANUAL', ip: req.ip, contexto,
  });
}

/** Valida fornecedor (empresa e status), filial, responsável e produtos; converte itens para a base. */
async function prepararItens(empresaId: string, fornecedorId: string, itens: Ficha['itens']) {
  if (!itens) return undefined;
  const saida = [];
  for (const i of itens) {
    const produto = await prisma.produto.findFirst({ where: { id: i.produtoId, empresaId }, select: { id: true, unidade: true, unidadeBaseId: true, status: true, nome: true } });
    if (!produto) throw NaoEncontrado('Produto inválido para esta empresa.');
    if ((i.desconto ?? 0) > i.quantidade * i.valorUnit) throw new ErroDeNegocio(`Desconto maior que o valor do item ${produto.nome}.`, 400);
    const unidade = i.unidadeCompra ?? produto.unidade ?? 'UN';
    const conv = await converterParaUnidadeBaseCompra({ empresaId, produtoId: produto.id, unidadeBaseId: produto.unidadeBaseId ?? undefined, quantidadeCompra: i.quantidade, unidadeCompraSimbolo: unidade, fornecedorId });
    saida.push({ produtoId: produto.id, quantidade: i.quantidade, valorUnit: i.valorUnit, unidadeCompra: unidade, fatorAplicado: conv.fator.toNumber(), quantidadeBase: conv.quantidadeDestino.toNumber(), desconto: i.desconto ?? 0, observacao: i.observacao ?? null });
  }
  return saida;
}

async function conferirReferencias(empresaId: string, d: Ficha) {
  if (d.filialId && !(await prisma.filial.findFirst({ where: { id: d.filialId, empresaId }, select: { id: true } }))) throw NaoEncontrado('Filial inválida para esta empresa.');
  if (d.responsavelId && !(await prisma.usuario.findFirst({ where: { id: d.responsavelId, empresaId }, select: { id: true } }))) throw NaoEncontrado('Responsável inválido para esta empresa.');
  if (d.fornecedorId) {
    const f = await prisma.fornecedor.findFirst({ where: { id: d.fornecedorId, empresaId }, select: { status: true } });
    if (!f) throw NaoEncontrado('Fornecedor inválido para esta empresa.');
    if (!STATUS_QUE_RECEBEM_PEDIDO.includes(f.status)) throw new ErroDeNegocio(`Fornecedor ${f.status.toLowerCase()} não pode receber novos pedidos de compra.`, 422);
  }
}

const paraData = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(`${v}T00:00:00.000Z`) : null);
function camposSimples(d: Ficha) {
  const { itens: _i, dataCompra, previsaoEntrega, primeiroVencimento, ...resto } = d;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resto)) if (v !== undefined) out[k] = v;
  if (dataCompra !== undefined && dataCompra) out.dataCompra = paraData(dataCompra);
  if (previsaoEntrega !== undefined) out.previsaoEntrega = paraData(previsaoEntrega);
  if (primeiroVencimento !== undefined) out.primeiroVencimento = paraData(primeiroVencimento);
  return out;
}

/** Ações do fluxo disponíveis para o status atual (a tela mostra só os botões válidos). */
function acoesDisponiveis(status: string, exigeAprovacao: boolean, temRecebimento: boolean) {
  const a: string[] = [];
  if (['RASCUNHO', 'SOLICITADA'].includes(status)) a.push(exigeAprovacao ? 'ENVIAR_APROVACAO' : 'APROVAR');
  if (status === 'AGUARDANDO_APROVACAO') a.push('APROVAR', 'DEVOLVER');
  if (ENVIAVEIS.includes(status) && !(exigeAprovacao && status === 'SOLICITADA')) a.push('ENVIAR', 'MARCAR_ENVIADA');
  if (['APROVADA', 'ENVIADA', 'SOLICITADA'].includes(status)) a.push('CONFIRMAR_FORNECEDOR');
  if (RECEBEM.includes(status) && !(exigeAprovacao && status === 'SOLICITADA')) a.push('RECEBER');
  if (status === 'RECEBIDA' || status === 'PARCIAL') a.push('CONCLUIR');
  if (!temRecebimento && !['CANCELADA', 'RECEBIDA', 'CONCLUIDA', 'PARCIAL'].includes(status)) a.push('CANCELAR');
  return a;
}

async function montarFicha(req: FastifyRequest, id: string) {
  const empresaId = req.user.empresaId;
  const [podeCusto, podeFinanceiro, podeAprovar] = await Promise.all([
    temPermissao(req.user.id, 'custos', 'visualizar'), temPermissao(req.user.id, 'financeiro', 'visualizar'), temPermissao(req.user.id, 'compras', 'administrar'),
  ]);
  const c = await prisma.compra.findFirst({
    where: { id, empresaId },
    include: {
      empresa: { select: { id: true, nome: true, cnpj: true, comprasExigeAprovacao: true } },
      filial: { select: { id: true, nome: true } },
      responsavel: { select: { id: true, nome: true } }, aprovadoPor: { select: { nome: true } },
      criadoPor: { select: { nome: true } }, atualizadoPor: { select: { nome: true } },
      fornecedor: { include: { contatos: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] } } },
      itens: { include: { produto: { select: { id: true, nome: true, sku: true, custo: true, unidade: true, status: true, unidadeBase: { select: { simbolo: true } } } } } },
      recebimentos: { orderBy: { numero: 'asc' }, include: { usuario: { select: { nome: true } }, notaFiscal: { select: { numero: true, serie: true } }, itens: true } },
      notasFiscais: { orderBy: { createdAt: 'desc' } },
      envios: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
  const [vinculos, documentos, financeiro, movimentos] = await Promise.all([
    prisma.fornecedorProduto.findMany({ where: { empresaId, fornecedorId: c.fornecedorId, produtoId: { in: c.itens.map((i) => i.produtoId) } } }),
    prisma.documento.findMany({ where: { empresaId, entidadeTipo: { in: ['Compra', 'CompraNotaFiscal'] }, entidadeId: { in: [c.id, ...c.notasFiscais.map((n) => n.id)] }, situacao: 'disponivel' }, orderBy: { createdAt: 'desc' }, include: { enviadoPor: { select: { nome: true } } } }),
    podeFinanceiro ? prisma.financeiro.findMany({ where: { empresaId, compraId: c.id }, orderBy: [{ vencimento: 'asc' }, { createdAt: 'asc' }], select: { id: true, descricao: true, valor: true, vencimento: true, status: true } }) : Promise.resolve(null),
    prisma.estoqueMovimentacao.findMany({ where: { empresaId, documento: c.id }, orderBy: { createdAt: 'asc' }, select: { id: true, produtoId: true, quantidade: true, tipo: true, recebimentoId: true, createdAt: true, saldoPosterior: true } }),
  ]);
  const vinc = new Map(vinculos.map((v) => [v.produtoId, v]));
  const f = c.fornecedor;
  const principal = f.contatos[0];
  const temRecebimento = c.recebimentos.length > 0;
  const total = Number(c.valorTotal);
  return {
    compra: {
      id: c.id, numero: c.numero, numeroExibido: numeroExibido(c.numero), status: c.status, statusRotulo: ROTULO_STATUS[c.status] ?? c.status,
      dataCompra: c.dataCompra, previsaoEntrega: c.previsaoEntrega, prioridade: c.prioridade, filial: c.filial, empresa: { id: c.empresa.id, nome: c.empresa.nome },
      responsavel: c.responsavel, condPagamento: c.condPagamento, formaPagamento: c.formaPagamento, parcelas: c.parcelas, primeiroVencimento: c.primeiroVencimento,
      contaFinanceira: c.contaFinanceira, centroCusto: c.centroCusto, planoContas: c.planoContas, observacoesFinanceiras: c.observacoesFinanceiras,
      observacoes: c.observacoes, observacoesFornecedor: c.observacoesFornecedor,
      valorProdutos: num(c.valorProdutos) ?? c.itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.valorUnit) - Number(i.desconto), 0),
      desconto: Number(c.desconto), frete: Number(c.frete), outrasDespesas: Number(c.outrasDespesas), valorTotal: total,
      aprovadoPor: c.aprovadoPor?.nome ?? null, aprovadoEm: c.aprovadoEm, enviadoEm: c.enviadoEm, confirmadoEm: c.confirmadoEm, dataRecebimento: c.dataRecebimento,
      motivoCancelamento: c.motivoCancelamento,
    },
    itens: c.itens.map((i) => {
      const v = vinc.get(i.produtoId);
      const q = Number(i.quantidade);
      return {
        id: i.id, produtoId: i.produtoId, codigo: i.produto.sku, nome: i.produto.nome, produtoAtivo: i.produto.status === 'ATIVO',
        quantidade: q, unidade: i.unidadeCompra ?? i.produto.unidade, unidadeBase: i.produto.unidadeBase?.simbolo ?? i.produto.unidade,
        quantidadeBase: num(i.quantidadeBase), fator: num(i.fatorAplicado), valorUnit: Number(i.valorUnit), desconto: Number(i.desconto), observacao: i.observacao,
        subtotal: Math.round((q * Number(i.valorUnit) - Number(i.desconto)) * 100) / 100,
        quantidadeRecebida: Number(i.quantidadeRecebida), quantidadePendente: Math.max(0, Math.round((q - Number(i.quantidadeRecebida)) * 1000) / 1000),
        situacao: Number(i.quantidadeRecebida) >= q ? 'RECEBIDO' : Number(i.quantidadeRecebida) > 0 ? 'PARCIAL' : 'PENDENTE',
        referenciaFornecedor: v?.referencia ?? null, vinculadoAoFornecedor: !!v,
        ...(podeCusto ? { custoAtual: Number(i.produto.custo), ultimoPrecoFornecedor: num(v?.ultimoPrecoCompra), precoFornecedor: num(v?.preco) } : {}),
      };
    }),
    fornecedor: {
      id: f.id, codigo: f.codigo, nome: f.nome, nomeFantasia: f.nomeFantasia, documento: f.cnpj, tipoPessoa: f.tipoPessoa, status: f.status,
      contato: principal ? { nome: principal.nome, telefone: principal.telefone, whatsapp: principal.whatsapp || principal.celular, email: principal.email } : { nome: f.contato, telefone: f.telefone, whatsapp: f.whatsapp, email: f.email },
      emailPedidos: f.emailPedidos ?? principal?.email ?? f.email, telefone: f.telefone, whatsapp: principal?.whatsapp || principal?.celular || f.whatsapp,
      endereco: [f.logradouro, f.numero, f.complemento, f.bairro, f.cidade && `${f.cidade}/${f.uf ?? ''}`, f.cep].filter(Boolean).join(', ') || f.endereco,
      condicaoPagamento: f.condicaoPagamento, prazoEntregaDias: f.prazoEntregaDias, transportadora: f.transportadora, modalidadeFrete: f.modalidadeFrete,
      condicoesComerciais: f.condicoesComerciais, recebePedidos: STATUS_QUE_RECEBEM_PEDIDO.includes(f.status),
    },
    financeiro: {
      cronogramaPrevisto: cronograma(total, c.previsaoEntrega ?? c.dataCompra, c.condPagamento, c.parcelas, c.primeiroVencimento),
      contas: financeiro ? financeiro.map((x) => ({ ...x, valor: Number(x.valor) })) : null,
    },
    recebimentos: c.recebimentos.map((r) => ({
      id: r.id, numero: r.numero, data: r.dataRecebimento, usuario: r.usuario?.nome ?? null, valorRecebido: Number(r.valorRecebido), observacoes: r.observacoes,
      notaFiscal: r.notaFiscal ? `${r.notaFiscal.numero}${r.notaFiscal.serie ? `/${r.notaFiscal.serie}` : ''}` : null,
      itens: r.itens.map((ri) => ({ compraItemId: ri.compraItemId, produtoId: ri.produtoId, recebida: Number(ri.quantidadeRecebida), base: Number(ri.quantidadeBase), avariada: Number(ri.quantidadeAvariada), recusada: Number(ri.quantidadeRecusada), divergencia: ri.divergencia })),
      movimentacoes: movimentos.filter((m) => m.recebimentoId === r.id).map((m) => ({ ...m, quantidade: Number(m.quantidade), saldoPosterior: num(m.saldoPosterior) })),
    })),
    notasFiscais: c.notasFiscais.map((n) => ({ ...n, valorTotal: num(n.valorTotal) })),
    envios: c.envios,
    documentos: documentos.map((d) => ({ id: d.id, entidadeTipo: d.entidadeTipo, entidadeId: d.entidadeId, nome: d.nomeOriginal, descricao: d.descricao, tamanho: d.tamanho, enviadoPor: d.enviadoPor?.nome ?? null, enviadoEm: d.createdAt })),
    acoes: acoesDisponiveis(c.status, c.empresa.comprasExigeAprovacao, temRecebimento),
    editavel: EDITAVEIS.includes(c.status),
    exigeAprovacao: c.empresa.comprasExigeAprovacao,
    permissoes: { custo: podeCusto, financeiro: podeFinanceiro, aprovar: podeAprovar },
    canais: canaisConfigurados(),
    storageConfigurado: storageConfigurado(),
    auditoria: { criadoPor: c.criadoPor?.nome ?? null, criadoEm: c.createdAt, atualizadoPor: c.atualizadoPor?.nome ?? null, atualizadoEm: c.atualizadoEm ?? c.createdAt },
  };
}

async function carregarParaEnvio(empresaId: string, id: string) {
  const c = await prisma.compra.findFirst({
    where: { id, empresaId },
    include: { empresa: { select: { nome: true, cnpj: true } }, filial: { select: { nome: true } }, fornecedor: { include: { contatos: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] } } }, itens: { include: { produto: { select: { nome: true, sku: true } } } } },
  });
  if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
  const itens = c.itens.map((i) => ({ codigo: i.produto.sku, nome: i.produto.nome, quantidade: Number(i.quantidade), unidade: i.unidadeCompra ?? 'UN', valorUnit: Number(i.valorUnit), desconto: Number(i.desconto), subtotal: Math.round((Number(i.quantidade) * Number(i.valorUnit) - Number(i.desconto)) * 100) / 100 }));
  const valorProdutos = num(c.valorProdutos) ?? itens.reduce((s, i) => s + i.subtotal, 0);
  const pdf = pdfDoPedido({
    numero: c.numero, dataCompra: c.dataCompra, previsaoEntrega: c.previsaoEntrega, condPagamento: c.condPagamento, formaPagamento: c.formaPagamento,
    observacoesFornecedor: c.observacoesFornecedor, valorProdutos, desconto: Number(c.desconto), frete: Number(c.frete), outrasDespesas: Number(c.outrasDespesas),
    valorTotal: Number(c.valorTotal), empresa: c.empresa, filial: c.filial,
    fornecedor: { nome: c.fornecedor.nome, nomeFantasia: c.fornecedor.nomeFantasia, cnpj: c.fornecedor.cnpj, email: c.fornecedor.emailPedidos ?? c.fornecedor.email, telefone: c.fornecedor.telefone },
    itens,
  });
  const numeroTxt = numeroExibido(c.numero) ?? c.id;
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const linhas = itens.map((i) => `• ${i.nome}: ${i.quantidade} ${i.unidade} × ${brl(i.valorUnit)} = ${brl(i.subtotal)}`);
  const texto = [
    `Olá, ${c.fornecedor.nomeFantasia ?? c.fornecedor.nome}!`,
    `Segue o pedido de compra ${numeroTxt} de ${c.empresa.nome}.`, '', ...linhas, '',
    `Total: ${brl(Number(c.valorTotal))}`,
    `Condição de pagamento: ${c.condPagamento ?? '—'}`,
    `Previsão de entrega: ${c.previsaoEntrega ? c.previsaoEntrega.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}`,
    ...(c.observacoesFornecedor ? ['', `Observações: ${c.observacoesFornecedor}`] : []),
    '', 'Por favor, confirme o recebimento deste pedido.',
  ].join('\n');
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const html = `<p>${esc(texto).replace(/\n/g, '<br>')}</p><p style="color:#888;font-size:12px">Pedido em PDF anexo · enviado pelo NEXUS OS</p>`;
  const principal = c.fornecedor.contatos[0];
  return {
    compra: c, pdf: { nome: `pedido-${numeroTxt}.pdf`, base64: pdf.toString('base64') }, texto, html, assunto: `Pedido de compra ${numeroTxt} — ${c.empresa.nome}`,
    email: c.fornecedor.emailPedidos ?? principal?.email ?? c.fornecedor.email ?? null,
    whatsapp: principal?.whatsapp || principal?.celular || c.fornecedor.whatsapp || c.fornecedor.telefone || null,
  };
}

export async function compraFichaRoutes(app: FastifyInstance): Promise<void> {
  const ver = [app.authenticate, await permissaoMiddleware('compras', 'visualizar')];
  const criar = [app.authenticate, await permissaoMiddleware('compras', 'criar')];
  const editar = [app.authenticate, await permissaoMiddleware('compras', 'editar')];
  const administrar = [app.authenticate, await permissaoMiddleware('compras', 'administrar')];

  // ------------------------------------------------------------------ painel (indicadores e catálogos)
  app.get('/api/v1/compras/painel', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const q = z.object({ de: data, ate: data }).parse(req.query);
    const de = q.de ? new Date(`${q.de}T00:00:00.000Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const ate = q.ate ? new Date(`${q.ate}T23:59:59.999Z`) : new Date();
    const [porStatus, periodo, filiais, fornecedores, responsaveis, empresa, nfs] = await Promise.all([
      prisma.compra.groupBy({ by: ['status'], where: { empresaId }, _count: { _all: true } }),
      prisma.compra.aggregate({ where: { empresaId, status: { not: 'CANCELADA' }, dataCompra: { gte: de, lte: ate } }, _count: { _all: true }, _sum: { valorTotal: true } }),
      prisma.filial.findMany({ where: { empresaId }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true, nomeFantasia: true, codigo: true, status: true, condicaoPagamento: true, prazoEntregaDias: true }, orderBy: { nome: 'asc' } }),
      prisma.usuario.findMany({ where: { empresaId, status: 'ATIVO' }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nome: true, comprasExigeAprovacao: true } }),
      prisma.compraNotaFiscal.count({ where: { empresaId } }),
    ]);
    const n = (...s: string[]) => porStatus.filter((p) => s.includes(p.status)).reduce((t, p) => t + p._count._all, 0);
    return {
      indicadores: {
        total: n(...Object.keys(ROTULO_STATUS)), pendentes: n('RASCUNHO', 'SOLICITADA', 'APROVADA', 'ENVIADA', 'PEDIDO'), aguardandoAprovacao: n('AGUARDANDO_APROVACAO'),
        enviados: n('ENVIADA', 'PEDIDO'), recebimentosPendentes: n('APROVADA', 'ENVIADA', 'PEDIDO', 'SOLICITADA'), recebimentosParciais: n('PARCIAL'),
        comprasNoPeriodo: periodo._count._all, valorNoPeriodo: Number(periodo._sum.valorTotal ?? 0), notasFiscais: nfs,
      },
      periodo: { de, ate }, filiais, fornecedores, responsaveis, empresa,
      statusRotulos: ROTULO_STATUS, canais: canaisConfigurados(), storageConfigurado: storageConfigurado(),
      podeAdministrar: await temPermissao(req.user.id, 'compras', 'administrar'),
    };
  });

  app.put('/api/v1/compras/configuracao', { preHandler: administrar }, async (req) => {
    const { exigeAprovacao } = z.object({ exigeAprovacao: z.boolean() }).parse(req.body);
    const antes = await prisma.empresa.findUnique({ where: { id: req.user.empresaId }, select: { comprasExigeAprovacao: true } });
    await prisma.empresa.update({ where: { id: req.user.empresaId }, data: { comprasExigeAprovacao: exigeAprovacao } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG', entidade: 'Empresa', entidadeId: req.user.empresaId, valorAnterior: antes ?? undefined, valorNovo: { comprasExigeAprovacao: exigeAprovacao }, origem: 'MANUAL', ip: req.ip, contexto: 'Compras: aprovação obrigatória' });
    return { exigeAprovacao };
  });

  // ------------------------------------------------------------------ listas (abas da tela principal)
  app.get('/api/v1/compras', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const q = z.object({
      busca: z.string().trim().max(80).optional(), status: z.string().optional(), fornecedorId: z.string().optional(), filialId: z.string().optional(),
      responsavelId: z.string().optional(), de: data, ate: data, take: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);
    const codigo = q.busca ? /^(?:cp-?)?0*(\d{1,9})$/i.exec(q.busca)?.[1] : undefined;
    const where: Prisma.CompraWhereInput = {
      empresaId,
      ...(q.status ? { status: { in: q.status.split(',') as Prisma.EnumStatusCompraFilter['in'] } } : {}),
      ...(q.fornecedorId ? { fornecedorId: q.fornecedorId } : {}), ...(q.filialId ? { filialId: q.filialId } : {}), ...(q.responsavelId ? { responsavelId: q.responsavelId } : {}),
      ...(q.de || q.ate ? { dataCompra: { ...(q.de ? { gte: new Date(`${q.de}T00:00:00.000Z`) } : {}), ...(q.ate ? { lte: new Date(`${q.ate}T23:59:59.999Z`) } : {}) } } : {}),
      ...(q.busca ? { OR: [...(codigo ? [{ numero: Number(codigo) }] : []), { fornecedor: { nome: { contains: q.busca, mode: 'insensitive' } } }, { fornecedor: { nomeFantasia: { contains: q.busca, mode: 'insensitive' } } }, { id: q.busca }] } : {}),
    };
    const lista = await prisma.compra.findMany({
      where, orderBy: [{ createdAt: 'desc' }], take: q.take,
      include: { fornecedor: { select: { id: true, nome: true, nomeFantasia: true } }, filial: { select: { nome: true } }, responsavel: { select: { nome: true } }, _count: { select: { itens: true, recebimentos: true } } },
    });
    return lista.map((c) => ({
      id: c.id, numero: numeroExibido(c.numero), criadoEm: c.createdAt, dataCompra: c.dataCompra, fornecedor: c.fornecedor, filial: c.filial.nome,
      responsavel: c.responsavel?.nome ?? null, itens: c._count.itens, recebimentos: c._count.recebimentos, valorTotal: Number(c.valorTotal), previsaoEntrega: c.previsaoEntrega,
      status: c.status, statusRotulo: ROTULO_STATUS[c.status] ?? c.status, prioridade: c.prioridade, atualizadoEm: c.atualizadoEm ?? c.createdAt,
    }));
  });

  app.get('/api/v1/compras/recebimentos', { preHandler: ver }, async (req) => {
    const empresaId = req.user.empresaId;
    const q = z.object({ fornecedorId: z.string().optional(), filialId: z.string().optional(), situacao: z.enum(['TODOS', 'PENDENTES', 'PARCIAIS', 'CONCLUIDOS']).default('TODOS'), de: data, ate: data, busca: z.string().trim().max(40).optional() }).parse(req.query);
    const codigo = q.busca ? /^(?:cp-?)?0*(\d{1,9})$/i.exec(q.busca)?.[1] : undefined;
    const statusPorSituacao: Record<string, string[]> = { PENDENTES: ['APROVADA', 'ENVIADA', 'PEDIDO', 'SOLICITADA'], PARCIAIS: ['PARCIAL'], CONCLUIDOS: ['RECEBIDA', 'CONCLUIDA'], TODOS: ['APROVADA', 'ENVIADA', 'PEDIDO', 'SOLICITADA', 'PARCIAL', 'RECEBIDA', 'CONCLUIDA'] };
    const compras = await prisma.compra.findMany({
      where: {
        empresaId, status: { in: statusPorSituacao[q.situacao] as Prisma.EnumStatusCompraFilter['in'] },
        ...(q.fornecedorId ? { fornecedorId: q.fornecedorId } : {}), ...(q.filialId ? { filialId: q.filialId } : {}), ...(codigo ? { numero: Number(codigo) } : {}),
        ...(q.de || q.ate ? { dataCompra: { ...(q.de ? { gte: new Date(`${q.de}T00:00:00.000Z`) } : {}), ...(q.ate ? { lte: new Date(`${q.ate}T23:59:59.999Z`) } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 200,
      include: {
        fornecedor: { select: { nome: true, nomeFantasia: true } }, filial: { select: { nome: true } }, itens: { select: { quantidade: true, quantidadeRecebida: true } },
        recebimentos: { orderBy: { numero: 'desc' }, include: { usuario: { select: { nome: true } }, notaFiscal: { select: { numero: true } }, itens: { select: { quantidadeAvariada: true, quantidadeRecusada: true, divergencia: true } } } },
      },
    });
    return compras.map((c) => {
      const sol = c.itens.reduce((s, i) => s + Number(i.quantidade), 0);
      const rec = c.itens.reduce((s, i) => s + Number(i.quantidadeRecebida), 0);
      const ult = c.recebimentos[0];
      return {
        compraId: c.id, numero: numeroExibido(c.numero), fornecedor: c.fornecedor.nomeFantasia ?? c.fornecedor.nome, filial: c.filial.nome,
        notaFiscal: ult?.notaFiscal?.numero ?? null, ultimoRecebimento: ult?.dataRecebimento ?? null, responsavel: ult?.usuario?.nome ?? null,
        recebimentos: c.recebimentos.length, solicitada: sol, recebida: rec, pendente: Math.max(0, Math.round((sol - rec) * 1000) / 1000),
        divergencias: c.recebimentos.reduce((s, r) => s + r.itens.filter((i) => i.divergencia || Number(i.quantidadeAvariada) > 0 || Number(i.quantidadeRecusada) > 0).length, 0),
        status: c.status, statusRotulo: ROTULO_STATUS[c.status] ?? c.status,
      };
    });
  });

  app.get('/api/v1/compras/notas-fiscais', { preHandler: ver }, async (req) => {
    const q = z.object({ busca: z.string().trim().max(60).optional(), fornecedorId: z.string().optional() }).parse(req.query);
    const nfs = await prisma.compraNotaFiscal.findMany({
      where: {
        empresaId: req.user.empresaId, ...(q.fornecedorId ? { compra: { fornecedorId: q.fornecedorId } } : {}),
        ...(q.busca ? { OR: [{ numero: { contains: q.busca } }, { chaveAcesso: { contains: q.busca.replace(/\D/g, '') || q.busca } }] } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 200,
      include: { compra: { select: { id: true, numero: true, fornecedor: { select: { nome: true, nomeFantasia: true } } } }, _count: { select: { recebimentos: true } } },
    });
    const docs = await prisma.documento.groupBy({ by: ['entidadeId'], where: { empresaId: req.user.empresaId, entidadeTipo: 'CompraNotaFiscal', entidadeId: { in: nfs.map((n) => n.id) }, situacao: 'disponivel' }, _count: { _all: true } });
    const nDocs = new Map(docs.map((d) => [d.entidadeId, d._count._all]));
    return nfs.map((n) => ({
      id: n.id, numero: n.numero, serie: n.serie, chaveAcesso: n.chaveAcesso, fornecedor: n.compra.fornecedor.nomeFantasia ?? n.compra.fornecedor.nome,
      dataEmissao: n.dataEmissao, dataEntrada: n.dataEntrada, valorTotal: num(n.valorTotal), compraId: n.compra.id, pedido: numeroExibido(n.compra.numero),
      status: n.status, divergencias: n.divergencias, recebimentos: n._count.recebimentos, anexos: nDocs.get(n.id) ?? 0,
    }));
  });

  app.get('/api/v1/compras/historico', { preHandler: ver }, async (req) => {
    const { compraId } = z.object({ compraId: z.string().min(1).optional() }).parse(req.query);
    const eventos = await prisma.auditoria.findMany({
      where: { empresaId: req.user.empresaId, entidade: 'Compra', ...(compraId ? { entidadeId: compraId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, acao: true, entidadeId: true, contexto: true, createdAt: true, valorAnterior: true, valorNovo: true, usuario: { select: { nome: true } } },
    });
    const ids = [...new Set(eventos.map((e) => e.entidadeId).filter(Boolean))] as string[];
    const compras = await prisma.compra.findMany({ where: { empresaId: req.user.empresaId, id: { in: ids } }, select: { id: true, numero: true, fornecedor: { select: { nome: true } } } });
    const porId = new Map(compras.map((c) => [c.id, c]));
    return eventos.map((e) => ({ id: e.id, data: e.createdAt, usuario: e.usuario?.nome ?? null, acao: e.acao, evento: e.contexto ?? (e.acao === 'CRIAR' ? 'Pedido criado' : 'Alteração'), compraId: e.entidadeId, pedido: numeroExibido(porId.get(e.entidadeId ?? '')?.numero), fornecedor: porId.get(e.entidadeId ?? '')?.fornecedor.nome ?? null, anterior: e.valorAnterior, novo: e.valorNovo }));
  });

  // ------------------------------------------------------------------ ficha
  app.get('/api/v1/compras/:id/ficha', { preHandler: ver }, async (req) => montarFicha(req, (req.params as { id: string }).id));

  app.post('/api/v1/compras/ficha', { preHandler: criar }, async (req, reply) => {
    const empresaId = req.user.empresaId;
    const d = fichaSchema.extend({ filialId: z.string().min(1), fornecedorId: z.string().min(1), itens: z.array(itemSchema).min(1, 'Adicione ao menos um produto.').max(300) }).parse(req.body);
    await conferirReferencias(empresaId, d);
    const itens = (await prepararItens(empresaId, d.fornecedorId, d.itens))!;
    const { valorProdutos, valorTotal } = calcularTotais(itens, d);
    const compra = await prisma.$transaction(async (tx) => tx.compra.create({
      data: {
        ...(camposSimples(d) as Prisma.CompraUncheckedCreateInput), empresaId, filialId: d.filialId, fornecedorId: d.fornecedorId,
        numero: await proximoNumeroCompra(tx, empresaId), status: 'RASCUNHO', responsavelId: d.responsavelId ?? req.user.id,
        valorProdutos, valorTotal, criadoPorId: req.user.id, atualizadoPorId: req.user.id, atualizadoEm: new Date(), origem: 'MANUAL',
        itens: { create: itens },
      },
    }));
    await auditar(req, compra.id, 'CRIAR', 'Pedido criado', undefined, { numero: numeroExibido(compra.numero), itens: itens.length, valorTotal });
    return reply.status(201).send(await montarFicha(req, compra.id));
  });

  app.put('/api/v1/compras/:id/ficha', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const d = fichaSchema.parse(req.body);
    const antes = await prisma.compra.findFirst({ where: { id, empresaId }, include: { itens: true } });
    if (!antes) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (['CANCELADA', 'CONCLUIDA'].includes(antes.status)) throw new ErroDeNegocio(`Compra ${ROTULO_STATUS[antes.status].toLowerCase()} não pode ser alterada.`, 409);
    const editavel = EDITAVEIS.includes(antes.status);
    const camposDeValor = ['itens', 'desconto', 'frete', 'outrasDespesas', 'fornecedorId', 'filialId'] as const;
    if (!editavel && camposDeValor.some((c) => d[c] !== undefined)) {
      throw new ErroDeNegocio('Itens, valores, fornecedor e filial só mudam enquanto o pedido está em rascunho ou aguardando aprovação.', 409);
    }
    if (d.itens && (d.itens.some((i) => i.valorUnit !== undefined) && antes.itens.length) && !(await temPermissao(req.user.id, 'compras', 'editar'))) throw new ErroDeNegocio('Sem permissão para alterar valores.', 403);
    await conferirReferencias(empresaId, d);
    const fornecedorId = d.fornecedorId ?? antes.fornecedorId;
    const itens = await prepararItens(empresaId, fornecedorId, d.itens);
    const baseItens = itens ?? antes.itens.map((i) => ({ quantidade: Number(i.quantidade), valorUnit: Number(i.valorUnit), desconto: Number(i.desconto) }));
    const { valorProdutos, valorTotal } = calcularTotais(baseItens, { desconto: d.desconto ?? Number(antes.desconto), frete: d.frete ?? Number(antes.frete), outrasDespesas: d.outrasDespesas ?? Number(antes.outrasDespesas) });
    const depois = await prisma.$transaction(async (tx) => {
      if (itens) {
        await tx.compraItem.deleteMany({ where: { compraId: id } });
        await tx.compraItem.createMany({ data: itens.map((i) => ({ ...i, compraId: id })) });
      }
      return tx.compra.update({
        where: { id },
        data: { ...(camposSimples(d) as Prisma.CompraUncheckedUpdateInput), ...(editavel ? { valorProdutos, valorTotal } : {}), numero: antes.numero ?? (await proximoNumeroCompra(tx, empresaId)), atualizadoPorId: req.user.id, atualizadoEm: new Date() },
      });
    });
    const mudancas = diferencas(antes as unknown as Record<string, unknown>, depois as unknown as Record<string, unknown>, CAMPOS_AUDITADOS);
    if (itens) mudancas.push({ campo: 'itens', anterior: antes.itens.length, novo: itens.length });
    if (mudancas.length) await auditar(req, id, 'EDITAR', 'Pedido alterado', undefined, { alteracoes: mudancas });
    return montarFicha(req, id);
  });

  app.post('/api/v1/compras/:id/duplicar', { preHandler: criar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const o = await prisma.compra.findFirst({ where: { id, empresaId }, include: { itens: true, fornecedor: { select: { status: true } } } });
    if (!o) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (!STATUS_QUE_RECEBEM_PEDIDO.includes(o.fornecedor.status)) throw new ErroDeNegocio(`Fornecedor ${o.fornecedor.status.toLowerCase()} não pode receber novos pedidos de compra.`, 422);
    const nova = await prisma.$transaction(async (tx) => tx.compra.create({
      data: {
        empresaId, filialId: o.filialId, fornecedorId: o.fornecedorId, numero: await proximoNumeroCompra(tx, empresaId), status: 'RASCUNHO', responsavelId: req.user.id,
        prioridade: o.prioridade, condPagamento: o.condPagamento, formaPagamento: o.formaPagamento, parcelas: o.parcelas, centroCusto: o.centroCusto, planoContas: o.planoContas,
        contaFinanceira: o.contaFinanceira, observacoesFornecedor: o.observacoesFornecedor, desconto: o.desconto, frete: o.frete, outrasDespesas: o.outrasDespesas,
        valorProdutos: o.valorProdutos, valorTotal: o.valorTotal, criadoPorId: req.user.id, atualizadoPorId: req.user.id, atualizadoEm: new Date(), origem: 'MANUAL',
        itens: { create: o.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, unidadeCompra: i.unidadeCompra, fatorAplicado: i.fatorAplicado, quantidadeBase: i.quantidadeBase, valorUnit: i.valorUnit, desconto: i.desconto, observacao: i.observacao })) },
      },
    }));
    await auditar(req, nova.id, 'CRIAR', `Pedido duplicado de ${numeroExibido(o.numero) ?? o.id}`, undefined, { origem: o.id });
    return reply.status(201).send({ id: nova.id, numero: numeroExibido(nova.numero) });
  });

  // ------------------------------------------------------------------ fluxo (aprovação, envio, confirmação, conclusão)
  app.post('/api/v1/compras/:id/acao', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const { acao, motivo } = z.object({ acao: z.enum(['ENVIAR_APROVACAO', 'APROVAR', 'DEVOLVER', 'MARCAR_ENVIADA', 'CONFIRMAR_FORNECEDOR', 'CONCLUIR']), motivo: z.string().trim().max(300).optional() }).parse(req.body);
    const c = await prisma.compra.findFirst({ where: { id, empresaId }, include: { empresa: { select: { comprasExigeAprovacao: true } }, fornecedor: { select: { status: true } }, _count: { select: { recebimentos: true } } } });
    if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (!acoesDisponiveis(c.status, c.empresa.comprasExigeAprovacao, c._count.recebimentos > 0).includes(acao)) {
      throw new ErroDeNegocio(`Ação inválida para uma compra "${ROTULO_STATUS[c.status] ?? c.status}".`, 409);
    }
    if (acao === 'APROVAR' && c.empresa.comprasExigeAprovacao && !(await temPermissao(req.user.id, 'compras', 'administrar'))) throw new ErroDeNegocio('Aprovar exige a permissão compras.administrar.', 403);
    if (['APROVAR', 'MARCAR_ENVIADA', 'ENVIAR_APROVACAO'].includes(acao) && !STATUS_QUE_RECEBEM_PEDIDO.includes(c.fornecedor.status)) {
      throw new ErroDeNegocio(`Fornecedor ${c.fornecedor.status.toLowerCase()}: o pedido não pode seguir.`, 422);
    }
    const agora = new Date();
    const novo: Record<string, Prisma.CompraUncheckedUpdateInput> = {
      ENVIAR_APROVACAO: { status: 'AGUARDANDO_APROVACAO' },
      APROVAR: { status: 'APROVADA', aprovadoPorId: req.user.id, aprovadoEm: agora },
      DEVOLVER: { status: 'RASCUNHO' },
      MARCAR_ENVIADA: { status: 'ENVIADA', enviadoEm: agora },
      CONFIRMAR_FORNECEDOR: { status: 'PEDIDO', confirmadoEm: agora },
      CONCLUIR: { status: 'CONCLUIDA' },
    };
    const atualizado = await prisma.compra.update({ where: { id }, data: { ...novo[acao], atualizadoPorId: req.user.id, atualizadoEm: agora } });
    const rotulo: Record<string, string> = { ENVIAR_APROVACAO: 'Enviado para aprovação', APROVAR: 'Pedido aprovado', DEVOLVER: 'Devolvido para rascunho', MARCAR_ENVIADA: 'Marcado como enviado ao fornecedor', CONFIRMAR_FORNECEDOR: 'Confirmado pelo fornecedor', CONCLUIR: c.status === 'PARCIAL' ? 'Concluído com saldo pendente encerrado' : 'Pedido concluído' };
    await auditar(req, id, 'EDITAR', rotulo[acao] + (motivo ? ` — ${motivo}` : ''), { status: c.status }, { status: atualizado.status });
    return montarFicha(req, id);
  });

  // ------------------------------------------------------------------ recebimento (parcial ou total) — ÚNICA entrada de estoque
  app.post('/api/v1/compras/:id/recebimentos', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const corpo = z.object({
      idempotencyKey: z.string().trim().min(8).max(160),
      itens: z.array(z.object({
        compraItemId: z.string().min(1), quantidadeRecebida: z.number().finite().min(0),
        quantidadeAvariada: z.number().finite().min(0).optional(), quantidadeRecusada: z.number().finite().min(0).optional(), divergencia: z.string().trim().max(300).nullable().optional(),
      })).min(1).max(300),
      notaFiscalId: z.string().min(1).nullable().optional(),
      observacoes: z.string().trim().max(1000).nullable().optional(),
      dataRecebimento: data,
    }).parse(req.body);
    const c = await prisma.compra.findFirst({ where: { id, empresaId: req.user.empresaId }, select: { status: true, empresa: { select: { comprasExigeAprovacao: true } } } });
    if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (c.empresa.comprasExigeAprovacao && c.status === 'SOLICITADA') throw new ErroDeNegocio('A empresa exige aprovação: aprove o pedido antes de receber.', 409);
    let r;
    try {
      r = await prisma.$transaction((tx) => confirmarRecebimento(tx, {
        empresaId: req.user.empresaId, usuarioId: req.user.id, compraId: id, itens: corpo.itens, idempotencyKey: corpo.idempotencyKey,
        notaFiscalId: corpo.notaFiscalId, observacoes: corpo.observacoes, dataRecebimento: corpo.dataRecebimento ? new Date(`${corpo.dataRecebimento}T12:00:00.000Z`) : undefined,
      }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Conflito('Este recebimento já foi confirmado (chave repetida).');
      throw e;
    }
    if (!r.duplicado) {
      await auditar(req, id, 'EDITAR', `Recebimento ${r.recebimento.numero} confirmado (${r.completo ? 'total' : 'parcial'}) → entrada no estoque e contas a pagar`, undefined, {
        recebimento: r.recebimento.numero, itens: corpo.itens.filter((i) => i.quantidadeRecebida > 0).length, valor: Number(r.recebimento.valorRecebido), status: r.compra.status,
      });
    }
    return reply.status(r.duplicado ? 200 : 201).send({ duplicado: r.duplicado, recebimentoId: r.recebimento.id, ficha: await montarFicha(req, id) });
  });

  // ------------------------------------------------------------------ notas fiscais de entrada
  const nfSchema = z.object({
    numero: z.string().trim().min(1).max(20), serie: z.string().trim().max(5).nullable().optional(),
    chaveAcesso: z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((v) => v === '' || v.length === 44, 'A chave de acesso tem 44 dígitos.').nullable().optional(),
    dataEmissao: data, dataEntrada: data, valorTotal: dinheiro.nullable().optional(), observacoes: z.string().trim().max(1000).nullable().optional(),
  });
  app.post('/api/v1/compras/:id/notas-fiscais', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const d = nfSchema.parse(req.body);
    const c = await prisma.compra.findFirst({ where: { id, empresaId }, select: { id: true, valorTotal: true, status: true } });
    if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (c.status === 'CANCELADA') throw new ErroDeNegocio('Compra cancelada não recebe nota fiscal.', 409);
    if (d.chaveAcesso && (await prisma.compraNotaFiscal.findFirst({ where: { empresaId, chaveAcesso: d.chaveAcesso } }))) throw Conflito('Esta chave de acesso já está vinculada a outra compra.');
    // Divergência de valor (informativa): total da NF diferente do total do pedido.
    const divergencias = d.valorTotal != null && Math.abs(d.valorTotal - Number(c.valorTotal)) > 0.009 ? `Valor da NF (${d.valorTotal.toFixed(2)}) diferente do pedido (${Number(c.valorTotal).toFixed(2)}).` : null;
    const nf = await prisma.compraNotaFiscal.create({
      data: { empresaId, compraId: id, numero: d.numero, serie: d.serie ?? null, chaveAcesso: d.chaveAcesso || null, dataEmissao: paraData(d.dataEmissao) ?? null, dataEntrada: paraData(d.dataEntrada) ?? null,
        valorTotal: d.valorTotal ?? null, observacoes: d.observacoes ?? null, status: divergencias ? 'DIVERGENTE' : 'REGISTRADA', divergencias, usuarioId: req.user.id },
    });
    await auditar(req, id, 'EDITAR', `NF-e ${nf.numero}${nf.serie ? `/${nf.serie}` : ''} vinculada${divergencias ? ' (com divergência)' : ''}`, undefined, { notaFiscal: nf.numero, chave: nf.chaveAcesso, valor: num(nf.valorTotal) });
    return reply.status(201).send(nf);
  });

  app.put('/api/v1/compras/:id/notas-fiscais/:nfId', { preHandler: editar }, async (req) => {
    const { id, nfId } = req.params as { id: string; nfId: string };
    const d = z.object({ status: z.enum(['REGISTRADA', 'CONFERIDA', 'DIVERGENTE']).optional(), divergencias: z.string().trim().max(1000).nullable().optional(), observacoes: z.string().trim().max(1000).nullable().optional() }).parse(req.body);
    const nf = await prisma.compraNotaFiscal.findFirst({ where: { id: nfId, compraId: id, empresaId: req.user.empresaId } });
    if (!nf) throw NaoEncontrado('Nota fiscal não encontrada nesta compra.');
    const depois = await prisma.compraNotaFiscal.update({ where: { id: nfId }, data: d });
    await auditar(req, id, 'EDITAR', `NF-e ${nf.numero}: ${d.status ? `status ${d.status}` : 'atualizada'}`, { status: nf.status }, { status: depois.status });
    return depois;
  });

  // ------------------------------------------------------------------ documentos (anexos da compra, XML e DANFE da NF)
  app.post('/api/v1/compras/:id/documentos', { preHandler: editar }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const d = z.object({ notaFiscalId: z.string().min(1).nullable().optional(), descricao: z.string().trim().max(120).optional(), arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1) }) }).parse(req.body);
    const c = await prisma.compra.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!c) throw NaoEncontrado('Compra não encontrada nesta empresa.');
    if (d.notaFiscalId && !(await prisma.compraNotaFiscal.findFirst({ where: { id: d.notaFiscalId, compraId: id, empresaId } }))) throw NaoEncontrado('Nota fiscal não encontrada nesta compra.');
    if (!storageConfigurado()) throw new ErroDeNegocio('Armazenamento de arquivos não configurado (STORAGE_BUCKET). Configure o storage para anexar documentos.', 503);
    const buffer = Buffer.from(d.arquivo.base64, 'base64');
    validaTamanho(buffer.length);
    let ext = extensaoDe(d.arquivo.nome);
    // XML da NF-e: o storage aceita a lista do RH; o XML é guardado como texto.
    const xml = ext === 'xml';
    if (xml) ext = 'txt';
    const chave = montaChave(empresaId, 'compra', ext);
    const contentType = xml ? 'application/xml' : contentTypeDe(d.arquivo.nome);
    await enviarObjeto(chave, buffer, contentType);
    const cfg = configStorage();
    const doc = await prisma.documento.create({
      data: { empresaId, entidadeTipo: d.notaFiscalId ? 'CompraNotaFiscal' : 'Compra', entidadeId: d.notaFiscalId ?? id, nomeOriginal: d.arquivo.nome, chave, bucket: cfg.bucket, provedor: cfg.provedor, contentType, tamanho: buffer.length, descricao: d.descricao ?? (xml ? 'XML da NF-e' : null), enviadoPorId: req.user.id },
    });
    await auditar(req, id, 'EDITAR', `Documento anexado: ${doc.nomeOriginal}`, undefined, { documento: doc.nomeOriginal, notaFiscalId: d.notaFiscalId ?? null });
    return reply.status(201).send({ id: doc.id });
  });

  app.get('/api/v1/compras/:id/documentos/:docId/arquivo', { preHandler: ver }, async (req) => {
    const { id, docId } = req.params as { id: string; docId: string };
    const empresaId = req.user.empresaId;
    const nfs = await prisma.compraNotaFiscal.findMany({ where: { compraId: id, empresaId }, select: { id: true } });
    const doc = await prisma.documento.findFirst({ where: { id: docId, empresaId, entidadeId: { in: [id, ...nfs.map((n) => n.id)] }, entidadeTipo: { in: ['Compra', 'CompraNotaFiscal'] } } });
    if (!doc) throw NaoEncontrado('Documento não encontrado.');
    const { corpo, contentType } = await baixarObjeto(doc.chave);
    return { nome: doc.nomeOriginal, mime: contentType, base64: corpo.toString('base64') };
  });

  // ------------------------------------------------------------------ PDF e envio ao fornecedor
  app.get('/api/v1/compras/:id/pdf', { preHandler: ver }, async (req) => {
    const e = await carregarParaEnvio(req.user.empresaId, (req.params as { id: string }).id);
    return { nome: e.pdf.nome, mime: 'application/pdf', base64: e.pdf.base64 };
  });

  app.get('/api/v1/compras/:id/envio/previa', { preHandler: ver }, async (req) => {
    const e = await carregarParaEnvio(req.user.empresaId, (req.params as { id: string }).id);
    return {
      assunto: e.assunto, texto: e.texto, email: e.email, whatsapp: e.whatsapp,
      linkWhatsApp: e.whatsapp ? linkConversaWhatsApp(e.whatsapp, e.texto) : null, pdf: { nome: e.pdf.nome },
      canais: canaisConfigurados(), podeEnviar: ENVIAVEIS.includes(e.compra.status), status: e.compra.status,
    };
  });

  app.post('/api/v1/compras/:id/envio', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const d = z.object({ canal: z.enum(['EMAIL', 'WHATSAPP']), modo: z.enum(['API', 'CONVERSA']).default('API'), destinatario: z.string().trim().max(160).optional() }).parse(req.body);
    const e = await carregarParaEnvio(empresaId, id);
    if (!ENVIAVEIS.includes(e.compra.status)) throw new ErroDeNegocio(`Compra "${ROTULO_STATUS[e.compra.status] ?? e.compra.status}" não pode ser enviada ao fornecedor${['RASCUNHO', 'AGUARDANDO_APROVACAO'].includes(e.compra.status) ? ' (aprove antes)' : ''}.`, 409);
    if (!STATUS_QUE_RECEBEM_PEDIDO.includes(e.compra.fornecedor.status)) throw new ErroDeNegocio(`Fornecedor ${e.compra.fornecedor.status.toLowerCase()}: o pedido não pode ser enviado.`, 422);
    const destinatario = d.destinatario || (d.canal === 'EMAIL' ? e.email : e.whatsapp);
    if (!destinatario) throw new ErroDeNegocio(d.canal === 'EMAIL' ? 'O fornecedor não tem e-mail para pedidos cadastrado.' : 'O fornecedor não tem WhatsApp/telefone cadastrado.', 422);
    if (d.canal === 'EMAIL' && !z.string().email().safeParse(destinatario).success) throw new ErroDeNegocio('E-mail do destinatário inválido.', 400);

    let resultado: Awaited<ReturnType<typeof enviarPorEmail>>;
    let link: string | null = null;
    if (d.canal === 'EMAIL') resultado = await enviarPorEmail({ para: destinatario, assunto: e.assunto, html: e.html, texto: e.texto, pdf: e.pdf });
    else if (d.modo === 'CONVERSA') {
      link = linkConversaWhatsApp(destinatario, e.texto);
      if (!link) throw new ErroDeNegocio('Telefone do fornecedor inválido para WhatsApp.', 422);
      resultado = { status: 'CONVERSA_ABERTA', provedor: 'wa.me' };
    } else resultado = await enviarPorWhatsApp({ telefone: destinatario, mensagem: e.texto, pdf: e.pdf });

    const envio = await prisma.compraEnvio.create({ data: { empresaId, compraId: id, canal: d.canal, destinatario, status: resultado.status, provedor: resultado.provedor, provedorId: resultado.provedorId ?? null, erro: resultado.erro ?? null, usuarioId: req.user.id } });
    // Só o envio ACEITO pelo provedor muda o status para ENVIADA. Abrir conversa não é envio.
    if (resultado.status === 'ENVIADO' && ['APROVADA', 'SOLICITADA'].includes(e.compra.status)) {
      await prisma.compra.update({ where: { id }, data: { status: 'ENVIADA', enviadoEm: new Date(), atualizadoPorId: req.user.id, atualizadoEm: new Date() } });
    }
    const rot: Record<string, string> = { ENVIADO: 'enviado', FALHOU: 'falhou', NAO_CONFIGURADO: 'canal não configurado', CONVERSA_ABERTA: 'conversa aberta (envio manual)' };
    await auditar(req, id, 'EDITAR', `Pedido por ${d.canal === 'EMAIL' ? 'e-mail' : 'WhatsApp'}: ${rot[resultado.status]}`, undefined, { canal: d.canal, destinatario, status: resultado.status, erro: resultado.erro ?? null });
    return { envio, link, ficha: await montarFicha(req, id) };
  });
}

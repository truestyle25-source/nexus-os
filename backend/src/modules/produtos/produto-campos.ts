import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { temPermissao } from '../../lib/permissoes.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';

/**
 * Campos do cadastro ERP aceitos por POST/PUT /produtos (todos opcionais).
 * Separados aqui para os dois endpoints validarem exatamente igual.
 */
const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const decimal = (min = 0, max = 1e9) => z.number().finite().min(min).max(max).nullable().optional();
const percentual = z.number().finite().min(0).max(100).nullable().optional();
const id = z.string().min(1).nullable().optional();

export const camposErpSchema = z.object({
  referencia: texto(60),
  descricaoResumida: texto(60),
  fabricante: texto(120),
  codigoExterno: texto(60),
  tipoProdutoId: id,
  unidadeBaseId: id,
  unidadeCompraId: id,
  unidadeVendaId: id,
  unidadeTributavelId: id,
  centroCustoVenda: texto(60),
  centroCustoContabil: texto(60),
  quantidadeEmbalagem: decimal(0),
  diasValidade: z.number().int().min(0).max(36500).nullable().optional(),
  embalagem: z.boolean().optional(),
  vendaFracionada: z.boolean().optional(),
  controlaBalanca: z.boolean().optional(),
  enviaCozinha: z.boolean().optional(),
  produtoGlp: z.boolean().optional(),
  imprimeFichaExpedicao: z.boolean().optional(),
  controlaEstoque: z.boolean().optional(),
  permiteEstoqueNegativo: z.boolean().optional(),
  permiteTransferenciaNegativa: z.boolean().optional(),
  controlaValidade: z.boolean().optional(),
  controlaLote: z.boolean().optional(),
  estoqueSeguranca: z.number().finite().min(0).optional(),
  estoqueIdeal: decimal(0),
  densidade: decimal(0),
  pesoEmbalagem: decimal(0),
  politicaCusto: z.enum(['ULTIMO_CUSTO', 'MEDIO_PONDERADO', 'PADRAO']).optional(),
  precoCompra: decimal(0),
  precoTabelaA: decimal(0),
  precoTabelaB: decimal(0),
  precoTabelaC: decimal(0),
  descontoMaximoPercentual: percentual,
  comissaoPercentual: percentual,
  despesasPercentual: percentual,
  premiacaoPercentual: percentual,
  premiacaoInicio: z.string().datetime().nullable().optional(),
  premiacaoFim: z.string().datetime().nullable().optional(),
  premiacaoRegra: texto(500),
  disponivelPdv: z.boolean().optional(),
  posicaoPdv: z.number().int().min(0).max(100000).nullable().optional(),
  imagem: z.string().trim().max(2000).nullable().optional(),
  /** Exigida quando o preço de venda cai mais de 10% ou fica abaixo do custo. */
  justificativaPreco: z.string().trim().min(5).max(300).optional(),
});
export type CamposErp = z.infer<typeof camposErpSchema>;

const CAMPOS_DE_CUSTO = ['politicaCusto', 'precoCompra'] as const;
const CAMPOS_DE_ADMINISTRACAO = ['descontoMaximoPercentual', 'comissaoPercentual', 'premiacaoPercentual', 'premiacaoInicio', 'premiacaoFim', 'premiacaoRegra'] as const;

/** Permissões por grupo de campo: custo exige custos.editar; comissão/premiação/desconto exige produtos.administrar. */
export async function exigirPermissoesDosCampos(req: FastifyRequest, dados: CamposErp): Promise<void> {
  if (CAMPOS_DE_CUSTO.some((c) => dados[c] !== undefined) && !(await temPermissao(req.user.id, 'custos', 'editar'))) {
    throw new ErroDeNegocio('Sem permissão: custos.editar', 403);
  }
  if (CAMPOS_DE_ADMINISTRACAO.some((c) => dados[c] !== undefined) && !(await temPermissao(req.user.id, 'produtos', 'administrar'))) {
    throw new ErroDeNegocio('Sem permissão: produtos.administrar (comissão, premiação e desconto máximo)', 403);
  }
}

/** Confere que tipo e unidades informados pertencem à empresa (o RLS já isola; isto dá a mensagem certa). */
export async function validarReferenciasDosCampos(empresaId: string, dados: CamposErp): Promise<void> {
  if (dados.tipoProdutoId) {
    const t = await prisma.tipoProduto.findFirst({ where: { id: dados.tipoProdutoId, empresaId }, select: { id: true } });
    if (!t) throw NaoEncontrado('Tipo de produto inválido para esta empresa.');
  }
  const unidades = [dados.unidadeBaseId, dados.unidadeCompraId, dados.unidadeVendaId, dados.unidadeTributavelId].filter((u): u is string => !!u);
  if (unidades.length) {
    const achadas = await prisma.unidade.count({ where: { empresaId, id: { in: [...new Set(unidades)] } } });
    if (achadas !== new Set(unidades).size) throw NaoEncontrado('Unidade de medida inválida para esta empresa.');
  }
  if (dados.premiacaoInicio && dados.premiacaoFim && new Date(dados.premiacaoInicio) > new Date(dados.premiacaoFim)) {
    throw new ErroDeNegocio('Início da premiação não pode ser posterior ao fim.', 400);
  }
}

/** Converte os campos validados para o formato do Prisma (datas, nulos). */
export function camposErpParaPrisma(dados: CamposErp): Prisma.ProdutoUncheckedUpdateInput {
  const { justificativaPreco: _j, premiacaoInicio, premiacaoFim, ...resto } = dados;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resto)) if (v !== undefined) data[k] = v;
  if (premiacaoInicio !== undefined) data.premiacaoInicio = premiacaoInicio ? new Date(premiacaoInicio) : null;
  if (premiacaoFim !== undefined) data.premiacaoFim = premiacaoFim ? new Date(premiacaoFim) : null;
  return data as Prisma.ProdutoUncheckedUpdateInput;
}

// ============================================================================
// Histórico de preços
// ============================================================================

const CAMPOS_PRECO = [
  ['precoVenda', 'PRECO_VENDA'],
  ['custo', 'CUSTO'],
  ['precoCompra', 'PRECO_COMPRA'],
  ['precoTabelaA', 'TABELA_A'],
  ['precoTabelaB', 'TABELA_B'],
  ['precoTabelaC', 'TABELA_C'],
] as const;

type ComPrecos = Partial<Record<(typeof CAMPOS_PRECO)[number][0], unknown>>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Regra da justificativa: preço de venda reduzido em mais de 10% ou abaixo do custo. */
export function exigeJustificativa(anterior: ComPrecos, novo: ComPrecos): boolean {
  const antes = num(anterior.precoVenda);
  const depois = novo.precoVenda === undefined ? antes : num(novo.precoVenda);
  const custo = novo.custo === undefined ? num(anterior.custo) : num(novo.custo);
  if (antes == null || depois == null || antes === depois) return false;
  return depois < antes * 0.9 || (custo != null && depois < custo);
}

/** Grava uma linha de histórico para cada preço/custo que mudou. */
export async function registrarHistoricoPrecos(
  tx: Prisma.TransactionClient,
  args: { empresaId: string; produtoId: string; usuarioId?: string | null; filialId?: string | null; anterior: ComPrecos; novo: ComPrecos; justificativa?: string | null; origem?: string },
): Promise<number> {
  const linhas = CAMPOS_PRECO.flatMap(([campo, rotulo]) => {
    if (args.novo[campo] === undefined) return [];
    const a = num(args.anterior[campo]);
    const n = num(args.novo[campo]);
    if (a === n) return [];
    return [{ empresaId: args.empresaId, produtoId: args.produtoId, filialId: args.filialId ?? null, campo: rotulo, valorAnterior: a, valorNovo: n, usuarioId: args.usuarioId ?? null, justificativa: args.justificativa ?? null, origem: args.origem ?? 'MANUAL' }];
  });
  if (linhas.length) await tx.produtoPrecoHistorico.createMany({ data: linhas });
  return linhas.length;
}

const CHAVES_ERP = Object.keys(camposErpSchema.shape) as Array<keyof CamposErp>;

/** Só os campos ERP de um objeto já validado (descarta nome, custo, local etc.). */
export function soCamposErp(obj: Record<string, unknown>): CamposErp {
  const saida: Record<string, unknown> = {};
  for (const k of CHAVES_ERP) if (obj[k] !== undefined) saida[k] = obj[k];
  return saida as CamposErp;
}

// ============================================================================
// Código de barras principal (Produto.codigoBarras) x códigos adicionais
// ============================================================================

/** Um código só pode identificar UM produto da empresa, seja como principal ou como adicional. */
export async function codigoEmUsoPorOutroProduto(empresaId: string, codigo: string, produtoId?: string): Promise<boolean> {
  const [principal, adicional] = await Promise.all([
    prisma.produto.findFirst({ where: { empresaId, codigoBarras: codigo, ...(produtoId ? { NOT: { id: produtoId } } : {}) }, select: { id: true } }),
    prisma.produtoCodigoBarras.findFirst({ where: { empresaId, codigo, ...(produtoId ? { NOT: { produtoId } } : {}) }, select: { id: true } }),
  ]);
  return !!(principal || adicional);
}

/** Mantém a linha "principal" de ProdutoCodigoBarras igual a Produto.codigoBarras. */
export async function sincronizarCodigoPrincipal(tx: Prisma.TransactionClient, empresaId: string, produtoId: string, codigo: string | null | undefined): Promise<void> {
  if (codigo === undefined) return;
  await tx.produtoCodigoBarras.updateMany({ where: { empresaId, produtoId, principal: true }, data: { principal: false } });
  if (!codigo) return;
  const existente = await tx.produtoCodigoBarras.findFirst({ where: { empresaId, codigo }, select: { id: true, produtoId: true } });
  if (existente && existente.produtoId !== produtoId) throw new ErroDeNegocio('Este código já identifica outro produto da empresa.', 409);
  if (existente) await tx.produtoCodigoBarras.update({ where: { id: existente.id }, data: { principal: true } });
  else await tx.produtoCodigoBarras.create({ data: { empresaId, produtoId, codigo, tipo: codigo.length === 8 ? 'EAN8' : codigo.length === 12 ? 'UPCA' : 'EAN13', principal: true } });
}

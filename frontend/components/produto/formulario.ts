// Estado do formulário da ficha (compartilhado entre as abas: trocar de aba não perde nada)
// e conversão para o corpo de PUT /produtos/:id, enviando só o que mudou.
import { lerNumero, type Ficha } from '@/lib/produto-ficha';

export const CAMPOS_TEXTO = ['nome', 'sku', 'referencia', 'descricaoResumida', 'fabricante', 'marca', 'codigoExterno', 'tipoProdutoId', 'categoriaId', 'unidade', 'unidadeBaseId', 'unidadeCompraId', 'unidadeVendaId', 'unidadeTributavelId', 'centroCustoVenda', 'centroCustoContabil', 'descricao', 'imagem', 'premiacaoRegra', 'fornecedorId', 'politicaCusto', 'local'] as const;
export const CAMPOS_NUMERO = ['quantidadeEmbalagem', 'custo', 'precoCompra', 'precoVenda', 'precoTabelaA', 'precoTabelaB', 'precoTabelaC', 'descontoMaximoPercentual', 'comissaoPercentual', 'despesasPercentual', 'premiacaoPercentual', 'estoqueMinimo', 'estoqueMaximo', 'estoqueSeguranca', 'estoqueIdeal', 'pontoPedido', 'densidade', 'pesoEmbalagem', 'precoPromocional'] as const;
export const CAMPOS_INTEIRO = ['diasValidade', 'posicaoPdv', 'promocaoLimite'] as const;
export const CAMPOS_DATA = ['premiacaoInicio', 'premiacaoFim', 'promocaoInicio', 'promocaoFim'] as const;
export const CAMPOS_BOOLEANO = ['embalagem', 'vendaFracionada', 'controlaBalanca', 'enviaCozinha', 'produtoGlp', 'imprimeFichaExpedicao', 'controlaEstoque', 'permiteEstoqueNegativo', 'permiteTransferenciaNegativa', 'controlaValidade', 'controlaLote', 'disponivelPdv'] as const;

type ChaveTexto = (typeof CAMPOS_TEXTO)[number] | (typeof CAMPOS_NUMERO)[number] | (typeof CAMPOS_INTEIRO)[number] | (typeof CAMPOS_DATA)[number];
type ChaveBool = (typeof CAMPOS_BOOLEANO)[number];
export type FormProduto = Record<ChaveTexto, string> & Record<ChaveBool, boolean>;

/** Campos que, se vazios, não podem ser enviados como null (são obrigatórios no banco). */
const OBRIGATORIOS = new Set(['nome', 'unidade', 'custo', 'precoVenda', 'estoqueMinimo', 'estoqueMaximo', 'pontoPedido', 'estoqueSeguranca', 'politicaCusto']);
/** Campos de texto que o backend aceita como nulos (os demais só como texto). */
const TEXTO_SEM_NULO = new Set(['sku']);

const paraTexto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const paraNumeroTexto = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
const paraData = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export function formDaFicha(f: Ficha): FormProduto {
  const p = f.produto;
  const form = {} as FormProduto;
  for (const c of CAMPOS_TEXTO) (form as any)[c] = paraTexto(p[c]);
  for (const c of [...CAMPOS_NUMERO, ...CAMPOS_INTEIRO]) (form as any)[c] = paraNumeroTexto(p[c]);
  for (const c of CAMPOS_DATA) (form as any)[c] = paraData(p[c]);
  for (const c of CAMPOS_BOOLEANO) (form as any)[c] = Boolean(p[c]);
  form.local = f.estoque.filiais.find((x) => x.local)?.local ?? '';
  if (!form.politicaCusto) form.politicaCusto = 'MEDIO_PONDERADO';
  return form;
}

/** Diferença entre o formulário atual e o original, já no formato da API. */
export function payloadAlterado(original: FormProduto, atual: FormProduto, podeVerCusto: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const c of CAMPOS_TEXTO) {
    const v = atual[c].trim();
    if (original[c].trim() === v) continue;
    if (!v && OBRIGATORIOS.has(c)) continue;
    if (!v && TEXTO_SEM_NULO.has(c)) continue;
    saida[c] = v || null;
  }
  for (const c of [...CAMPOS_NUMERO, ...CAMPOS_INTEIRO]) {
    if (original[c] === atual[c]) continue;
    if (!podeVerCusto && (c === 'custo' || c === 'precoCompra')) continue;
    const n = lerNumero(atual[c]);
    if (n === null && OBRIGATORIOS.has(c)) continue;
    saida[c] = CAMPOS_INTEIRO.includes(c as any) && n !== null ? Math.round(n) : n;
  }
  for (const c of CAMPOS_DATA) {
    if (original[c] === atual[c]) continue;
    const fim = c.endsWith('Fim');
    saida[c] = atual[c] ? `${atual[c]}T${fim ? '23:59:59.999' : '00:00:00.000'}Z` : null;
  }
  for (const c of CAMPOS_BOOLEANO) if (original[c] !== atual[c]) saida[c] = atual[c];
  return saida;
}

export const ORIGENS_MERCADORIA = [
  ['0', '0 — Nacional'], ['1', '1 — Estrangeira, importação direta'], ['2', '2 — Estrangeira, mercado interno'],
  ['3', '3 — Nacional, conteúdo de importação > 40% e ≤ 70%'], ['4', '4 — Nacional, processos produtivos básicos'],
  ['5', '5 — Nacional, conteúdo de importação ≤ 40%'], ['6', '6 — Estrangeira, importação direta, sem similar (CAMEX)'],
  ['7', '7 — Estrangeira, mercado interno, sem similar (CAMEX)'], ['8', '8 — Nacional, conteúdo de importação > 70%'],
] as const;

export const CST_ICMS = ['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90'];
export const CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
export const CST_PIS_COFINS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49', '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '98', '99'];
export const CST_IPI = ['00', '01', '02', '03', '04', '05', '49', '50', '51', '52', '53', '54', '55', '99'];

/**
 * Regras puras do cadastro de produtos (sem banco): precificação, validação
 * fiscal por regime tributário e códigos de identificação (GS1).
 * Testadas em tests/produto-regras.test.ts.
 */

const arred = (n: number, casas = 2) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

// ============================================================================
// Precificação
// ============================================================================

export interface EntradaPrecificacao {
  custo: number; // custo unitário (custo médio / política de custo do produto)
  precoVenda: number;
  /** Percentuais que incidem SOBRE O PREÇO de venda, todos informados pelo usuário (nada é presumido). */
  impostosPercentual?: number; // soma das alíquotas sobre a venda informadas na aba Tributos
  comissaoPercentual?: number;
  despesasPercentual?: number; // despesas operacionais rateadas sobre a venda
  descontoMaximoPercentual?: number;
}

export interface ResultadoPrecificacao {
  lucroBruto: number; // R$ = preço − custo
  markupPercentual: number | null; // (preço − custo) ÷ CUSTO × 100 — null sem custo
  margemBrutaPercentual: number | null; // (preço − custo) ÷ PREÇO × 100 — null sem preço
  deducoesPercentual: number; // impostos + comissão + despesas (sobre o preço)
  deducoesValor: number; // R$
  lucroLiquido: number; // R$ = preço − custo − deduções
  margemLiquidaPercentual: number | null; // lucro líquido ÷ preço × 100
  precoMinimoComDesconto: number | null; // preço com o desconto máximo permitido
  lucroLiquidoNoDescontoMaximo: number | null;
  abaixoDoCusto: boolean;
}

/**
 * Markup e margem NÃO são a mesma coisa:
 *  - markup é sobre o CUSTO: custo 10, preço 15 → markup 50%;
 *  - margem é sobre o PREÇO: custo 10, preço 15 → margem 33,33%.
 * A margem líquida desconta o que incide sobre o preço (impostos, comissão, despesas).
 */
export function calcularPrecificacao(e: EntradaPrecificacao): ResultadoPrecificacao {
  const custo = Math.max(0, Number(e.custo) || 0);
  const preco = Math.max(0, Number(e.precoVenda) || 0);
  const deducoesPercentual = arred((e.impostosPercentual ?? 0) + (e.comissaoPercentual ?? 0) + (e.despesasPercentual ?? 0), 4);
  const lucroBruto = arred(preco - custo);
  const deducoesValor = arred((preco * deducoesPercentual) / 100);
  const lucroLiquido = arred(preco - custo - deducoesValor);
  const desc = e.descontoMaximoPercentual ?? null;
  const precoMinimo = desc == null ? null : arred(preco * (1 - desc / 100));
  const lucroNoDesconto = precoMinimo == null ? null : arred(precoMinimo - custo - (precoMinimo * deducoesPercentual) / 100);
  return {
    lucroBruto,
    markupPercentual: custo > 0 ? arred(((preco - custo) / custo) * 100) : null,
    margemBrutaPercentual: preco > 0 ? arred(((preco - custo) / preco) * 100) : null,
    deducoesPercentual,
    deducoesValor,
    lucroLiquido,
    margemLiquidaPercentual: preco > 0 ? arred((lucroLiquido / preco) * 100) : null,
    precoMinimoComDesconto: precoMinimo,
    lucroLiquidoNoDescontoMaximo: lucroNoDesconto,
    abaixoDoCusto: preco < custo,
  };
}

/** Preço que aplica um markup sobre o custo. */
export function precoPorMarkup(custo: number, markupPercentual: number): number {
  return arred(custo * (1 + markupPercentual / 100));
}

/** Preço que entrega a margem LÍQUIDA desejada, dadas as deduções sobre o preço. Null se impossível (≥ 100%). */
export function precoPorMargemLiquida(custo: number, margemPercentual: number, deducoesPercentual = 0): number | null {
  const denominador = 1 - (margemPercentual + deducoesPercentual) / 100;
  return denominador <= 0 ? null : arred(custo / denominador);
}

// ============================================================================
// Fiscal
// ============================================================================

export const REGIMES = ['SIMPLES_NACIONAL', 'SIMPLES_EXCESSO_SUBLIMITE', 'REGIME_NORMAL'] as const;
export type Regime = (typeof REGIMES)[number];

/** Tabelas oficiais (NF-e / leiaute vigente). Valores fora delas são recusados. */
export const CST_ICMS = ['00', '02', '10', '15', '20', '30', '40', '41', '50', '51', '53', '60', '61', '70', '90'];
export const CSOSN = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
export const CST_PIS_COFINS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '49', '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '98', '99'];
export const CST_IPI = ['00', '01', '02', '03', '04', '05', '49', '50', '51', '52', '53', '54', '55', '99'];

export interface DadosFiscais {
  ncm?: string | null;
  origemMercadoria?: number | null;
  cest?: string | null;
  cfopEntrada?: string | null;
  cfopSaida?: string | null;
  cstIcms?: string | null;
  csosn?: string | null;
  aliquotaIcms?: number | null;
  reducaoBaseIcms?: number | null;
  cstPis?: string | null;
  aliquotaPis?: number | null;
  cstCofins?: string | null;
  aliquotaCofins?: number | null;
  cstIpi?: string | null;
  aliquotaIpi?: number | null;
  codigoEnquadramentoIpi?: string | null;
  cstIbsCbs?: string | null;
  classificacaoTributaria?: string | null;
  aliquotaIbs?: number | null;
  aliquotaCbs?: number | null;
}

export interface ProblemaFiscal { campo: keyof DadosFiscais | 'regime'; mensagem: string }

const vazio = (v: unknown) => v === null || v === undefined || v === '';

/**
 * Valida FORMATO e coerência com o regime. Não decide qual alíquota ou CST é o
 * correto para o produto — isso é do contador; aqui só se impede o que é inválido
 * pela tabela oficial ou incompatível com o regime da empresa.
 */
export function validarFiscal(regime: Regime | null | undefined, d: DadosFiscais): { erros: ProblemaFiscal[]; avisos: ProblemaFiscal[] } {
  const erros: ProblemaFiscal[] = [];
  const avisos: ProblemaFiscal[] = [];
  const err = (campo: ProblemaFiscal['campo'], mensagem: string) => erros.push({ campo, mensagem });

  if (!vazio(d.ncm) && !/^\d{8}$/.test(String(d.ncm))) err('ncm', 'NCM deve ter 8 dígitos.');
  if (!vazio(d.origemMercadoria) && !(Number.isInteger(d.origemMercadoria) && d.origemMercadoria! >= 0 && d.origemMercadoria! <= 8)) err('origemMercadoria', 'Origem da mercadoria deve ser de 0 a 8.');
  if (!vazio(d.cest) && !/^\d{7}$/.test(String(d.cest))) err('cest', 'CEST deve ter 7 dígitos.');
  if (!vazio(d.cfopEntrada) && !/^[123]\d{3}$/.test(String(d.cfopEntrada))) err('cfopEntrada', 'CFOP de entrada deve ter 4 dígitos e começar com 1, 2 ou 3.');
  if (!vazio(d.cfopSaida) && !/^[567]\d{3}$/.test(String(d.cfopSaida))) err('cfopSaida', 'CFOP de saída deve ter 4 dígitos e começar com 5, 6 ou 7.');
  if (!vazio(d.cstIcms) && !CST_ICMS.includes(String(d.cstIcms))) err('cstIcms', 'CST de ICMS fora da tabela oficial.');
  if (!vazio(d.csosn) && !CSOSN.includes(String(d.csosn))) err('csosn', 'CSOSN fora da tabela oficial.');
  if (!vazio(d.cstPis) && !CST_PIS_COFINS.includes(String(d.cstPis))) err('cstPis', 'CST de PIS fora da tabela oficial.');
  if (!vazio(d.cstCofins) && !CST_PIS_COFINS.includes(String(d.cstCofins))) err('cstCofins', 'CST de COFINS fora da tabela oficial.');
  if (!vazio(d.cstIpi) && !CST_IPI.includes(String(d.cstIpi))) err('cstIpi', 'CST de IPI fora da tabela oficial.');
  if (!vazio(d.codigoEnquadramentoIpi) && !/^\d{3}$/.test(String(d.codigoEnquadramentoIpi))) err('codigoEnquadramentoIpi', 'Código de enquadramento do IPI deve ter 3 dígitos.');
  if (!vazio(d.cstIbsCbs) && !/^\d{3}$/.test(String(d.cstIbsCbs))) err('cstIbsCbs', 'CST de IBS/CBS deve ter 3 dígitos.');
  if (!vazio(d.classificacaoTributaria) && !/^\d{6}$/.test(String(d.classificacaoTributaria))) err('classificacaoTributaria', 'Classificação tributária (cClassTrib) deve ter 6 dígitos.');
  for (const campo of ['aliquotaIcms', 'reducaoBaseIcms', 'aliquotaPis', 'aliquotaCofins', 'aliquotaIpi', 'aliquotaIbs', 'aliquotaCbs'] as const) {
    const v = d[campo];
    if (!vazio(v) && !(Number.isFinite(v) && v! >= 0 && v! <= 100)) err(campo, 'Alíquota deve estar entre 0 e 100%.');
  }

  // Coerência com o regime da empresa.
  if (!regime) {
    if (!vazio(d.cstIcms) || !vazio(d.csosn)) avisos.push({ campo: 'regime', mensagem: 'Regime tributário da empresa não informado: não é possível conferir CST x CSOSN.' });
  } else if (regime === 'SIMPLES_NACIONAL') {
    if (!vazio(d.cstIcms)) err('cstIcms', 'Empresa do Simples Nacional usa CSOSN, não CST de ICMS.');
  } else {
    // Regime normal e Simples com excesso de sublimite usam CST de ICMS.
    if (!vazio(d.csosn)) err('csosn', 'CSOSN é exclusivo do Simples Nacional; este regime usa CST de ICMS.');
  }
  return { erros, avisos };
}

/** Soma das alíquotas sobre a venda informadas (para a margem líquida). IPI fica de fora: não incide sobre a venda no varejo. */
export function somaImpostosSobreVenda(d: DadosFiscais): number {
  return arred(['aliquotaIcms', 'aliquotaPis', 'aliquotaCofins', 'aliquotaIbs', 'aliquotaCbs']
    .reduce((s, c) => s + (Number(d[c as keyof DadosFiscais]) || 0), 0), 4);
}

// ============================================================================
// Códigos de identificação
// ============================================================================

export const TIPOS_CODIGO = ['EAN13', 'EAN8', 'UPCA', 'GTIN14', 'INTERNO', 'BALANCA'] as const;
export type TipoCodigo = (typeof TIPOS_CODIGO)[number];

/** Dígito verificador GS1 (módulo 10) do corpo do código. */
export function digitoGs1(corpo: string): number {
  const soma = [...corpo].reverse().reduce((t, d, i) => t + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10;
}

export function gtinValido(codigo: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(codigo)) return false;
  return digitoGs1(codigo.slice(0, -1)) === Number(codigo.at(-1));
}

/** Tipo inferido de um código numérico (para quem não informa o tipo). */
export function inferirTipoCodigo(codigo: string): TipoCodigo {
  if (/^\d{13}$/.test(codigo)) return 'EAN13';
  if (/^\d{8}$/.test(codigo)) return 'EAN8';
  if (/^\d{12}$/.test(codigo)) return 'UPCA';
  if (/^\d{14}$/.test(codigo)) return 'GTIN14';
  return 'INTERNO';
}

/** Valida o código conforme o tipo. Devolve a mensagem de erro, ou null se válido. */
export function validarCodigo(codigo: string, tipo: TipoCodigo): string | null {
  const c = codigo.trim();
  switch (tipo) {
    case 'EAN13': return /^\d{13}$/.test(c) && gtinValido(c) ? null : 'EAN-13 deve ter 13 dígitos e dígito verificador válido.';
    case 'EAN8': return /^\d{8}$/.test(c) && gtinValido(c) ? null : 'EAN-8 deve ter 8 dígitos e dígito verificador válido.';
    case 'UPCA': return /^\d{12}$/.test(c) && gtinValido(c) ? null : 'UPC-A deve ter 12 dígitos e dígito verificador válido.';
    case 'GTIN14': return /^\d{14}$/.test(c) && gtinValido(c) ? null : 'GTIN-14 deve ter 14 dígitos e dígito verificador válido.';
    case 'BALANCA': return /^\d{4,6}$/.test(c) ? null : 'Código de balança (PLU) deve ter de 4 a 6 dígitos.';
    case 'INTERNO': return /^[A-Za-z0-9._-]{1,30}$/.test(c) ? null : 'Código interno: até 30 caracteres (letras, números, ponto, hífen ou sublinhado).';
    default: return 'Tipo de código desconhecido.';
  }
}

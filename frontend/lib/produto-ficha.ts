// Ficha do produto (cadastro ERP por abas): tipos, chamadas à API e cálculos de preço.
// Os cálculos repetem EXATAMENTE os do backend (backend/src/modules/produtos/produto-regras.ts)
// para a tela mostrar o resultado enquanto o usuário digita; o valor gravado vem do servidor.
import api, { ApiHttpError } from './api';

export type Id = string;

export interface Unidade { id: Id; simbolo: string; nome: string; fatorCanonico: number; dimensao: { codigo: string; nome: string } }
export interface TipoProduto { id: Id; codigo: string; nome: string; descricao?: string | null }
export interface Categoria { id: Id; nome: string; categoriaPaiId: Id | null; nivel: number }
export interface Catalogos {
  unidades: Unidade[]; tipos: TipoProduto[]; categorias: Categoria[];
  filiais: Array<{ id: Id; nome: string; status: string }>;
  fornecedores: Array<{ id: Id; nome: string }>;
  regimeTributario: 'SIMPLES_NACIONAL' | 'SIMPLES_EXCESSO_SUBLIMITE' | 'REGIME_NORMAL' | null;
  tiposCodigo: string[];
}

export interface SaldoFilial {
  filialId: Id; filialNome: string; filialStatus: string; vinculado: boolean; disponivelVenda: boolean;
  atual: number; reservado: number; comprometido: number; disponivel: number; valorTotal?: number;
  local: string | null; lote: string | null; precoVenda: number | null; custo?: number | null;
  estoqueMinimo: number | null; estoqueMaximo: number | null;
  precoEfetivo?: number; estoqueMinimoEfetivo?: number; estoqueMaximoEfetivo?: number; custoEfetivo?: number;
}

export interface CodigoBarras { id: Id; codigo: string; tipo: string; principal: boolean; descricao: string | null; createdAt: string }

export interface Ficha {
  produto: Record<string, any> & { id: Id; nome: string; status: string; codigosBarras: CodigoBarras[]; fiscal: Record<string, any> | null; fatoresConversao: Array<{ id: Id; fator: string | number; unidadeOrigemId: Id; unidadeDestinoId: Id; unidadeOrigem: { simbolo: string }; unidadeDestino: { simbolo: string } }> };
  podeVerCusto: boolean;
  regimeTributario: Catalogos['regimeTributario'];
  categoriaCadeia: Array<{ id: Id; nome: string; nivel: number }>;
  estoque: { consolidado: { atual: number; reservado: number; comprometido: number; disponivel: number; valorTotal?: number }; filiais: SaldoFilial[] };
  precificacao: Precificacao | null;
  impostosSobreVendaPercentual: number;
}

export interface Precificacao {
  lucroBruto: number; markupPercentual: number | null; margemBrutaPercentual: number | null; deducoesPercentual: number;
  deducoesValor: number; lucroLiquido: number; margemLiquidaPercentual: number | null; precoMinimoComDesconto: number | null;
  lucroLiquidoNoDescontoMaximo: number | null; abaixoDoCusto: boolean;
}

const arred = (n: number, c = 2) => Math.round((n + Number.EPSILON) * 10 ** c) / 10 ** c;

/** Mesma fórmula do backend: markup sobre o CUSTO, margem sobre o PREÇO, deduções sobre o preço. */
export function calcularPrecificacao(e: { custo: number; precoVenda: number; impostosPercentual?: number; comissaoPercentual?: number; despesasPercentual?: number; descontoMaximoPercentual?: number | null }): Precificacao {
  const custo = Math.max(0, Number(e.custo) || 0);
  const preco = Math.max(0, Number(e.precoVenda) || 0);
  const deducoesPercentual = arred((e.impostosPercentual ?? 0) + (e.comissaoPercentual ?? 0) + (e.despesasPercentual ?? 0), 4);
  const deducoesValor = arred((preco * deducoesPercentual) / 100);
  const lucroLiquido = arred(preco - custo - deducoesValor);
  const desc = e.descontoMaximoPercentual ?? null;
  const precoMinimo = desc == null ? null : arred(preco * (1 - desc / 100));
  return {
    lucroBruto: arred(preco - custo),
    markupPercentual: custo > 0 ? arred(((preco - custo) / custo) * 100) : null,
    margemBrutaPercentual: preco > 0 ? arred(((preco - custo) / preco) * 100) : null,
    deducoesPercentual, deducoesValor, lucroLiquido,
    margemLiquidaPercentual: preco > 0 ? arred((lucroLiquido / preco) * 100) : null,
    precoMinimoComDesconto: precoMinimo,
    lucroLiquidoNoDescontoMaximo: precoMinimo == null ? null : arred(precoMinimo - custo - (precoMinimo * deducoesPercentual) / 100),
    abaixoDoCusto: preco < custo,
  };
}

export const precoPorMarkup = (custo: number, markup: number) => arred(custo * (1 + markup / 100));
export const precoPorMargemLiquida = (custo: number, margem: number, deducoes = 0) => {
  const d = 1 - (margem + deducoes) / 100;
  return d <= 0 ? null : arred(custo / d);
};

/** Número digitado no padrão brasileiro ("1.234,56") ou internacional. Vazio → null. */
export function lerNumero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export const fmtNum = (v: number | null | undefined, casas = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmtQtd = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${fmtNum(v)}%`);
export const fmtData = (v: string | Date | null | undefined, comHora = true) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', comHora ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' });
};

/** Mensagem legível de um erro da API (inclui a lista de erros de campo do 422 fiscal). */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const d = e.data as { error?: string; message?: string } | undefined;
    return d?.error || d?.message || e.message;
  }
  return e instanceof Error ? e.message : 'Erro inesperado.';
}
export function errosDeCampo(e: unknown): Record<string, string> {
  if (!(e instanceof ApiHttpError)) return {};
  const lista = (e.data as { erros?: Array<{ campo: string; mensagem: string }> } | undefined)?.erros ?? [];
  return Object.fromEntries(lista.map((x) => [x.campo, x.mensagem]));
}

/** Baixa um arquivo devolvido pela API como base64. */
export function baixarBase64(nome: string, mime: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const fichaApi = {
  catalogos: () => api.get<Catalogos>('/produtos/catalogos').then((r) => r.data),
  ficha: (id: Id) => api.get<Ficha>(`/produtos/${id}/ficha`).then((r) => r.data),
  salvar: (id: Id, dados: Record<string, unknown>) => api.put(`/produtos/${id}`, dados).then((r) => r.data),
  status: (id: Id, status: 'ATIVO' | 'INATIVO') => api.patch(`/produtos/${id}/status`, { status }).then((r) => r.data),
  fiscal: (id: Id, dados: Record<string, unknown>) => api.put<{ avisos: Array<{ campo: string; mensagem: string }> }>(`/produtos/${id}/fiscal`, dados).then((r) => r.data),
  fator: (id: Id, dados: { unidadeOrigemId: Id; unidadeDestinoId: Id; fator: number }) => api.put(`/produtos/${id}/fator-conversao`, dados).then((r) => r.data),
  novaCategoria: (nome: string, categoriaPaiId?: Id) => api.post<Categoria>('/categorias', { nome, ...(categoriaPaiId ? { categoriaPaiId } : {}) }).then((r) => r.data),
  codigos: (id: Id) => api.get<CodigoBarras[]>(`/produtos/${id}/codigos-barras`).then((r) => r.data),
  addCodigo: (id: Id, dados: { codigo: string; tipo?: string; descricao?: string; principal?: boolean }) => api.post<CodigoBarras>(`/produtos/${id}/codigos-barras`, dados).then((r) => r.data),
  delCodigo: (id: Id, codigoId: Id) => api.delete(`/produtos/${id}/codigos-barras/${codigoId}`).then((r) => r.data),
  filiais: (id: Id) => api.get<SaldoFilial[]>(`/produtos/${id}/filiais`).then((r) => r.data),
  salvarFiliais: (id: Id, filiais: Array<Record<string, unknown>>, justificativa?: string) => api.put(`/produtos/${id}/filiais`, { filiais, ...(justificativa ? { justificativa } : {}) }).then((r) => r.data),
  movimentacoes: (id: Id, params: Record<string, unknown>) => api.get<{ total: number; itens: any[] }>(`/produtos/${id}/movimentacoes`, { params }).then((r) => r.data),
  exportar: (id: Id, params: Record<string, unknown>) => api.get<{ nome: string; mime: string; base64: string }>(`/produtos/${id}/movimentacoes/exportar`, { params }).then((r) => r.data),
  documentos: (id: Id, params: Record<string, unknown>) => api.get<{ total: number; itens: any[]; aviso?: string }>(`/produtos/${id}/documentos`, { params }).then((r) => r.data),
  historicoPrecos: (id: Id) => api.get<any[]>(`/produtos/${id}/historico-precos`).then((r) => r.data),
  historicoCadastro: (id: Id) => api.get<any[]>(`/produtos/${id}/historico-cadastro`).then((r) => r.data),
  integracoes: (id: Id) => api.get<Array<{ chave: string; nome: string; estado: string; detalhe: string }>>(`/produtos/${id}/integracoes`).then((r) => r.data),
  movimentar: (dados: Record<string, unknown>) => api.post('/estoque/movimentar', dados).then((r) => r.data),
  transferir: (dados: Record<string, unknown>) => api.post('/estoque/transferir', dados).then((r) => r.data),
};

/** Rótulos dos tipos de movimentação. */
export const TIPOS_MOVIMENTO: Record<string, string> = {
  ENTRADA: 'Entrada', SAIDA: 'Saída', COMPRA: 'Entrada por compra', VENDA: 'Saída por venda', TRANSFERENCIA: 'Transferência',
  AJUSTE: 'Ajuste', INVENTARIO: 'Inventário', PERDA: 'Perda', AVARIA: 'Avaria', DESCARTE: 'Descarte', DEVOLUCAO: 'Devolução',
  PRODUCAO: 'Produção', CONSUMO_INSUMO: 'Consumo de insumo',
};

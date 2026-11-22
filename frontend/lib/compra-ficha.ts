// Módulo Compras: tipos e chamadas à API (ficha da compra, painel, recebimentos, NF, envio).
// Toda regra (fluxo de status, recebimento, financeiro, permissões) é validada no servidor.
import api from './api';

export type Id = string;
export type StatusCompra = 'RASCUNHO' | 'SOLICITADA' | 'AGUARDANDO_APROVACAO' | 'APROVADA' | 'ENVIADA' | 'PEDIDO' | 'PARCIAL' | 'RECEBIDA' | 'CONCLUIDA' | 'CANCELADA';
export type Acao = 'ENVIAR_APROVACAO' | 'APROVAR' | 'DEVOLVER' | 'MARCAR_ENVIADA' | 'CONFIRMAR_FORNECEDOR' | 'CONCLUIR' | 'ENVIAR' | 'RECEBER' | 'CANCELAR';

export const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: 'Rascunho', SOLICITADA: 'Rascunho', AGUARDANDO_APROVACAO: 'Aguardando aprovação', APROVADA: 'Aprovada',
  ENVIADA: 'Enviada', PEDIDO: 'Confirmada', PARCIAL: 'Parcialmente recebida', RECEBIDA: 'Recebida', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada',
};
export const TOM_STATUS: Record<string, 'ok' | 'alerta' | 'erro' | undefined> = {
  APROVADA: 'ok', ENVIADA: 'ok', PEDIDO: 'ok', RECEBIDA: 'ok', CONCLUIDA: 'ok', PARCIAL: 'alerta', AGUARDANDO_APROVACAO: 'alerta', CANCELADA: 'erro',
};
/** Etapas da barra de progresso da ficha. */
export const ETAPAS = ['Dados da compra', 'Aprovação', 'Envio', 'Confirmação', 'Recebimento', 'Concluída'] as const;
export function etapaAtual(status: string): number {
  return ({ RASCUNHO: 0, SOLICITADA: 0, AGUARDANDO_APROVACAO: 1, APROVADA: 2, ENVIADA: 3, PEDIDO: 4, PARCIAL: 4, RECEBIDA: 5, CONCLUIDA: 6, CANCELADA: -1 } as Record<string, number>)[status] ?? 0;
}

export interface ItemCompra {
  id: Id; produtoId: Id; codigo: string | null; nome: string; produtoAtivo: boolean; quantidade: number; unidade: string; unidadeBase: string;
  quantidadeBase: number | null; fator: number | null; valorUnit: number; desconto: number; observacao: string | null; subtotal: number;
  quantidadeRecebida: number; quantidadePendente: number; situacao: 'RECEBIDO' | 'PARCIAL' | 'PENDENTE';
  referenciaFornecedor: string | null; vinculadoAoFornecedor: boolean; custoAtual?: number; ultimoPrecoFornecedor?: number | null; precoFornecedor?: number | null;
}

export interface FichaCompra {
  compra: Record<string, any> & { id: Id; numeroExibido: string | null; status: StatusCompra; statusRotulo: string; valorTotal: number; valorProdutos: number };
  itens: ItemCompra[];
  fornecedor: Record<string, any> & { id: Id; nome: string; recebePedidos: boolean };
  financeiro: { cronogramaPrevisto: Array<{ parcela: number; de: number; vencimento: string; valor: number }>; contas: Array<{ id: Id; descricao: string; valor: number; vencimento: string | null; status: string }> | null };
  recebimentos: Array<{ id: Id; numero: number; data: string; usuario: string | null; valorRecebido: number; observacoes: string | null; notaFiscal: string | null; itens: Array<{ compraItemId: Id; produtoId: Id; recebida: number; base: number; avariada: number; recusada: number; divergencia: string | null }>; movimentacoes: Array<{ id: Id; produtoId: Id; quantidade: number; saldoPosterior: number | null; createdAt: string }> }>;
  notasFiscais: Array<Record<string, any> & { id: Id; numero: string }>;
  envios: Array<{ id: Id; canal: string; destinatario: string; status: string; provedor?: string | null; erro: string | null; createdAt: string; entrega?: { status: string; erro: string | null } | null }>;
  documentos: Array<{ id: Id; entidadeTipo: string; entidadeId: Id; nome: string; descricao: string | null; tamanho: number; enviadoPor: string | null; enviadoEm: string }>;
  acoes: Acao[]; editavel: boolean; exigeAprovacao: boolean;
  permissoes: { custo: boolean; financeiro: boolean; aprovar: boolean };
  // origem: CENTRAL = conta da empresa na Central de Integrações; SERVIDOR = variáveis do servidor (reserva).
  canais: { email: { configurado: boolean; provedor: string; remetente: string | null; origem?: 'CENTRAL' | 'SERVIDOR' | null }; whatsapp: { configurado: boolean; provedor: string; template: string | null; origem?: 'CENTRAL' | 'SERVIDOR' | null } };
  storageConfigurado: boolean;
  auditoria: { criadoPor: string | null; criadoEm: string; atualizadoPor: string | null; atualizadoEm: string };
}

export interface Painel {
  indicadores: { total: number; pendentes: number; aguardandoAprovacao: number; enviados: number; recebimentosPendentes: number; recebimentosParciais: number; comprasNoPeriodo: number; valorNoPeriodo: number; notasFiscais: number };
  periodo: { de: string; ate: string };
  filiais: Array<{ id: Id; nome: string }>;
  fornecedores: Array<{ id: Id; nome: string; nomeFantasia: string | null; codigo: number | null; status: string; condicaoPagamento: string | null; prazoEntregaDias: number | null }>;
  responsaveis: Array<{ id: Id; nome: string }>;
  empresa: { id: Id; nome: string; comprasExigeAprovacao: boolean } | null;
  canais: FichaCompra['canais']; storageConfigurado: boolean; podeAdministrar: boolean;
}

const b = '/api/v1/compras';
export const compraApi = {
  painel: (params?: Record<string, unknown>) => api.get<Painel>(`${b}/painel`, { params }).then((r) => r.data),
  configuracao: (exigeAprovacao: boolean) => api.put(`${b}/configuracao`, { exigeAprovacao }).then((r) => r.data),
  listar: (params: Record<string, unknown>) => api.get<any[]>(b, { params }).then((r) => r.data),
  recebimentos: (params: Record<string, unknown>) => api.get<any[]>(`${b}/recebimentos`, { params }).then((r) => r.data),
  notas: (params: Record<string, unknown>) => api.get<any[]>(`${b}/notas-fiscais`, { params }).then((r) => r.data),
  historico: (compraId?: Id) => api.get<any[]>(`${b}/historico`, { params: compraId ? { compraId } : {} }).then((r) => r.data),
  ficha: (id: Id) => api.get<FichaCompra>(`${b}/${id}/ficha`).then((r) => r.data),
  criar: (dados: Record<string, unknown>) => api.post<FichaCompra>(`${b}/ficha`, dados).then((r) => r.data),
  salvar: (id: Id, dados: Record<string, unknown>) => api.put<FichaCompra>(`${b}/${id}/ficha`, dados).then((r) => r.data),
  acao: (id: Id, acao: Acao, motivo?: string) => api.post<FichaCompra>(`${b}/${id}/acao`, { acao, ...(motivo ? { motivo } : {}) }).then((r) => r.data),
  cancelar: (id: Id, motivo: string) => api.post(`/compras/${id}/cancelar`, { motivo }).then((r) => r.data),
  duplicar: (id: Id) => api.post<{ id: Id; numero: string }>(`${b}/${id}/duplicar`).then((r) => r.data),
  receber: (id: Id, dados: Record<string, unknown>) => api.post<{ duplicado: boolean; ficha: FichaCompra }>(`${b}/${id}/recebimentos`, dados).then((r) => r.data),
  novaNota: (id: Id, dados: Record<string, unknown>) => api.post(`${b}/${id}/notas-fiscais`, dados).then((r) => r.data),
  atualizarNota: (id: Id, nfId: Id, dados: Record<string, unknown>) => api.put(`${b}/${id}/notas-fiscais/${nfId}`, dados).then((r) => r.data),
  anexar: (id: Id, dados: Record<string, unknown>) => api.post(`${b}/${id}/documentos`, dados).then((r) => r.data),
  baixar: (id: Id, docId: Id) => api.get<{ nome: string; mime: string; base64: string }>(`${b}/${id}/documentos/${docId}/arquivo`).then((r) => r.data),
  pdf: (id: Id) => api.get<{ nome: string; mime: string; base64: string }>(`${b}/${id}/pdf`).then((r) => r.data),
  previa: (id: Id) => api.get<{ assunto: string; texto: string; email: string | null; whatsapp: string | null; linkWhatsApp: string | null; canais: FichaCompra['canais']; podeEnviar: boolean }>(`${b}/${id}/envio/previa`).then((r) => r.data),
  enviar: (id: Id, dados: { canal: 'EMAIL' | 'WHATSAPP'; modo?: 'API' | 'CONVERSA'; destinatario?: string }) => api.post<{ envio: { status: string; erro: string | null }; link: string | null; ficha: FichaCompra }>(`${b}/${id}/envio`, dados).then((r) => r.data),
};

/** Totais como o servidor calcula: itens (q × valor − desconto) − desconto + frete + outras. */
export function calcularTotais(itens: Array<{ quantidade: number; valorUnit: number; desconto: number }>, desconto: number, frete: number, outras: number) {
  const arred = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const produtos = arred(itens.reduce((s, i) => s + (i.quantidade || 0) * (i.valorUnit || 0) - (i.desconto || 0), 0));
  return { produtos, total: arred(produtos - (desconto || 0) + (frete || 0) + (outras || 0)) };
}

/** Chave de idempotência do recebimento (uma por confirmação na tela). */
export const novaChave = () => `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ============================================================================
// FASE 2 PDV PRO — Política offline explícita (fonte única).
//
// O que pode ocorrer SEM conexão (enfileirado, nunca "aprovado"):
//   VENDA em DINHEIRO ......... SIM (única forma liquidável offline)
//   VENDA em PIX .............. NÃO — QR não é dinheiro recebido; exige
//                               confirmação do provider com backend online.
//   VENDA em CARTÃO ........... NÃO — exige TEF/provider online.
//   Catálogo/estoque local .... SIM (somente leitura informativa).
//   SANGRIA/SUPRIMENTO ........ NÃO por padrão (exigem caixa online e auditoria
//                               imediata) — a fila nem aceita o tipo offline.
//   ABRIR/FECHAR caixa ........ NÃO sem sincronização (exigem saldo real).
//   CANCELAMENTO/DEVOLUÇÃO .... NÃO offline (exigem estorno transacional).
//
// PIX/cartão com backend ONLINE seguem bloqueados sem provider oficial
// (503 do backend) — a política aqui só decide o que pode ser ENFILEIRADO.
// ============================================================================

/** Formas aceitas pela rota POST /vendas (espelha vendas.filtros.ts). */
export const FORMAS_PAGAMENTO_PDV = [
  'DINHEIRO',
  'PIX',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'BOLETO',
  'TRANSFERENCIA',
  'OUTRO',
] as const;

export type FormaPagamentoPdv = (typeof FORMAS_PAGAMENTO_PDV)[number];

/** Únicas formas que podem ser enfileiradas offline com segurança. */
const FORMAS_OFFLINE: ReadonlySet<string> = new Set(['DINHEIRO']);

export interface AvaliacaoOffline {
  permitida: boolean;
  motivo: string;
}

/** Uma forma de pagamento pode ser registrada com o backend inalcançável? */
export function avaliarFormaOffline(forma: string): AvaliacaoOffline {
  const normalizada = forma.toUpperCase();
  if (FORMAS_OFFLINE.has(normalizada)) {
    return { permitida: true, motivo: 'Dinheiro é liquidado no ato, sem confirmação externa.' };
  }
  if (normalizada === 'PIX') {
    return { permitida: false, motivo: 'PIX exige confirmação do provider com backend online. QR gerado não é dinheiro recebido.' };
  }
  if (normalizada === 'CARTAO_CREDITO' || normalizada === 'CARTAO_DEBITO') {
    return { permitida: false, motivo: 'Cartão exige TEF/provider online. Sem confirmação, a venda não pode ser enfileirada.' };
  }
  return { permitida: false, motivo: `Forma ${forma} não possui liquidação offline segura.` };
}

/**
 * Extrai as formas de um payload de VENDA (pagamentos[] misto ou
 * formaPagamento única) e avalia cada uma contra a política offline.
 */
export function avaliarVendaOffline(payload: Record<string, unknown>): AvaliacaoOffline {
  const pagamentos = payload.pagamentos;
  const formas: string[] = Array.isArray(pagamentos) && pagamentos.length > 0
    ? pagamentos.map((p) => String((p as { forma?: unknown }).forma ?? ''))
    : [String(payload.formaPagamento ?? '')];
  for (const forma of formas) {
    const avaliacao = avaliarFormaOffline(forma);
    if (!avaliacao.permitida) return avaliacao;
  }
  return { permitida: true, motivo: 'Todas as parcelas são liquidáveis offline.' };
}

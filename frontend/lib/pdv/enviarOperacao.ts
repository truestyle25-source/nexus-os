import api, { ApiHttpError } from '../api';
import { headerIdempotencia } from './idempotency';
import type { EnviarOperacao } from './syncQueue';

/** Sends a durable operation with its original idempotency key. */
export const enviarOperacaoPdv: EnviarOperacao = async (operacao) => {
  if (operacao.tipo !== 'VENDA') {
    return { ok: false, erro: `Operação ${operacao.tipo} não é permitida na sincronização offline.`, definitivo: true };
  }
  try {
    const { data } = await api.post('/vendas', operacao.payload, {
      headers: headerIdempotencia(operacao.idempotencyKey, operacao.tipo),
    });
    const vendaId = data?.venda?.id;
    if (typeof vendaId !== 'string' || !vendaId) {
      try {
        const consulta = await consultarIdempotencia(operacao.idempotencyKey);
        if (consulta.data.status === 'CONFIRMADA' && consulta.data.vendaId) {
          return { ok: true, resposta: { reconciliada: true, vendaId: consulta.data.vendaId }, vendaIdRemota: consulta.data.vendaId };
        }
        if (consulta.data.status === 'REJEITADA') {
          return { ok: false, erro: `O servidor registrou a operação como rejeitada (HTTP ${consulta.data.responseStatus ?? 'desconhecido'}). Revise a venda antes de tentar novamente.`, definitivo: true };
        }
        return { ok: false, erro: 'O servidor aceitou a requisição, mas ainda não foi possível confirmar a venda. A operação será reconciliada antes de novo envio.', definitivo: false };
      } catch (consultaErro: unknown) {
        const detalhe = consultaErro instanceof Error ? consultaErro.message : 'consulta indisponível';
        return { ok: false, erro: `Resposta de venda sem identificador e reconciliação indisponível: ${detalhe}`, definitivo: false };
      }
    }
    return { ok: true, resposta: data, vendaIdRemota: vendaId };
  } catch (error: any) {
    const status = error instanceof ApiHttpError ? error.status : undefined;
    const mensagem = error instanceof ApiHttpError && typeof error.data === 'object' && error.data !== null && 'error' in error.data
      ? String((error.data as { error: unknown }).error)
      : error?.message ?? 'Falha ao enviar venda.';
    // These responses prove the same request cannot succeed unchanged.
    // FASE 1 PDV PRO — 401 NÃO é definitivo: o api client limpa o token e
    // manda para /login; após novo login a fila retenta com a MESMA chave.
    // Marcar 401 como definitivo travava o terminal em DIVERGENCIA permanente.
    const definitivo = status === 400 || status === 403 || status === 404 || status === 422;
    if (definitivo) return { ok: false, erro: mensagem, definitivo: true };
    if (status === 401) {
      return { ok: false, erro: `${mensagem} Sessão expirada. Entre novamente; a venda será reconciliada com a mesma chave, sem duplicar.`, definitivo: false };
    }

    // A timeout/connection loss can happen after PostgreSQL committed the sale.
    // Consult the durable idempotency record before deciding whether to retry.
    try {
      const consulta = await consultarIdempotencia(operacao.idempotencyKey);
      if (consulta.data.status === 'CONFIRMADA' && consulta.data.vendaId) {
        return {
          ok: true,
          resposta: { reconciliada: true, vendaId: consulta.data.vendaId },
          vendaIdRemota: consulta.data.vendaId,
        };
      }
      if (consulta.data.status === 'REJEITADA') {
        return {
          ok: false,
          erro: `O servidor registrou a operação como rejeitada (HTTP ${consulta.data.responseStatus ?? 'desconhecido'}). Revise a venda antes de tentar novamente.`,
          definitivo: true,
        };
      }
      return { ok: false, erro: 'O servidor ainda processa esta chave. A fila consultará novamente sem criar outra venda.', definitivo: false };
    } catch (consultaErro: unknown) {
      if (consultaErro instanceof ApiHttpError && consultaErro.status === 404) {
        // The POST may have failed before creating its durable idempotency row.
        // Retry is safe because it keeps the exact same key.
        return { ok: false, erro: mensagem, definitivo: false };
      }
      const detalhe = consultaErro instanceof Error ? consultaErro.message : mensagem;
      return { ok: false, erro: `${mensagem} Não foi possível consultar o desfecho: ${detalhe}`, definitivo: false };
    }
  }
};

function consultarIdempotencia(key: string) {
  return api.get<{
        status: 'PROCESSANDO' | 'CONFIRMADA' | 'REJEITADA';
        vendaId: string | null;
        responseStatus: number | null;
      }>(`/vendas/idempotencia/${encodeURIComponent(key)}`);
}

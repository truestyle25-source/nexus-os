import type { Prisma, StatusIdempotencia } from '@prisma/client';
import { prisma } from './prisma.js';
import { ErroDeNegocio } from './erros.js';

type Tx = Prisma.TransactionClient;

/**
 * FASE 2 PDV PRO — Idempotência transacional.
 *
 * REGRA: mesma chave = mesma operação. Nunca uma segunda venda.
 *
 * A chave é criada UMA vez no cliente para uma operação e mantida em todos os
 * retries (offline → sync). O banco é a fonte da verdade do "já processei isto?".
 *
 * A unicidade é @@unique([empresaId, key]). Duas requisições simultâneas com a
 * mesma chave disputam o INSERT: a segunda recebe P2002 (unique violation) e,
 * em vez de virar segunda venda, relê a linha existente e devolve o mesmo
 * resultado — é isso que impede o "duplo clique" e o "retry" de duplicar venda.
 */
export type IdemResult =
  | { duplicada: false; id: string; status: 'PROCESSANDO' }
  | { duplicada: true; id: string; status: StatusIdempotencia; responseStatus: number | null; responseBody: unknown };

export class IdempotencyEmUso extends ErroDeNegocio {
  constructor() {
    super('Esta venda já está sendo processada. Aguarde a confirmação antes de tentar novamente.', 409);
  }
}

/**
 * FASE 1 PDV PRO — TTL de PROCESSANDO com reconciliação segura.
 *
 * Sem isto, uma chave ficava em PROCESSANDO para sempre se o processo morresse
 * entre a aquisição e a conclusão (crash/OOM entre COMMIT e update da chave).
 * Todo retry devolvia 409 eternamente e a fila offline caía em DIVERGENCIA.
 *
 * Regra: NUNCA apaga a chave nem cria segunda venda. Antes de liberar novo
 * processamento, consulta a venda vinculada pela chave:
 * - venda existe → conclui CONFIRMADA com o desfecho real e devolve duplicada;
 * - sem venda e chave recente → 409 (outro terminal ainda processa);
 * - sem venda e chave velha (> TTL) → permite reprocessar com a MESMA chave.
 */
export const TTL_PROCESSANDO_MS = 15 * 60 * 1000;

export async function reconciliarProcessandoPresa(registro: {
  id: string;
  key: string;
  empresaId: string;
  updatedAt: Date;
  vendaId: string | null;
}): Promise<IdemResult | null> {
  const venda = registro.vendaId
    ? await prisma.venda.findFirst({ where: { id: registro.vendaId, empresaId: registro.empresaId }, select: { id: true } })
    : await prisma.venda.findFirst({ where: { empresaId: registro.empresaId, idempotencyKey: registro.key }, select: { id: true } });
  if (venda) {
    const concluida = await prisma.idempotencyKey.update({
      where: { id: registro.id },
      data: { status: 'CONFIRMADA', vendaId: venda.id, responseStatus: 201 },
    });
    return { duplicada: true, id: concluida.id, status: concluida.status, responseStatus: concluida.responseStatus, responseBody: concluida.responseBody };
  }
  if (Date.now() - registro.updatedAt.getTime() < TTL_PROCESSANDO_MS) return null;
  // TTL expirado sem venda: libera reprocessamento com a MESMA chave.
  await prisma.idempotencyKey.update({ where: { id: registro.id }, data: { updatedAt: new Date() } });
  return { duplicada: false, id: registro.id, status: 'PROCESSANDO' };
}

/**
 * Adquire (ou recupera) o registro de idempotência.
 * Deve rodar FORA da transação principal da venda — ele coordena o acesso.
 */
export async function adquirirIdempotencia(input: {
  key: string;
  empresaId: string;
  filialId?: string | null;
  caixaId?: string | null;
  operadorId?: string | null;
}): Promise<IdemResult> {
  if (!input.key || input.key.length < 8) {
    throw new ErroDeNegocio('X-Idempotency-Key ausente ou inválida.', 400);
  }
  // Caminho rápido: relê primeiro para evitar depender do P2002 no caso comum.
  const existente = await prisma.idempotencyKey.findUnique({
    where: { empresaId_key: { empresaId: input.empresaId, key: input.key } },
  });
  if (existente) {
    if (existente.status === 'PROCESSANDO') {
      const reconciliada = await reconciliarProcessandoPresa(existente);
      if (reconciliada) return reconciliada;
      throw new IdempotencyEmUso();
    }
    return { duplicada: true, id: existente.id, status: existente.status, responseStatus: existente.responseStatus, responseBody: existente.responseBody };
  }

  try {
    const criada = await prisma.idempotencyKey.create({
      data: {
        key: input.key,
        empresaId: input.empresaId,
        filialId: input.filialId ?? null,
        caixaId: input.caixaId ?? null,
        operadorId: input.operadorId ?? null,
        status: 'PROCESSANDO',
      },
    });
    return { duplicada: false, id: criada.id, status: 'PROCESSANDO' };
  } catch (e: any) {
    // P2002 = unique violation: outra requisição simultânea criou a mesma chave.
    if (e?.code === 'P2002') {
      const atual = await prisma.idempotencyKey.findUnique({
        where: { empresaId_key: { empresaId: input.empresaId, key: input.key } },
      });
      if (!atual) throw e;
      if (atual.status === 'PROCESSANDO') {
        const reconciliada = await reconciliarProcessandoPresa(atual);
        if (reconciliada) return reconciliada;
        throw new IdempotencyEmUso();
      }
      return { duplicada: true, id: atual.id, status: atual.status, responseStatus: atual.responseStatus, responseBody: atual.responseBody };
    }
    throw e;
  }
}

/** Grava o desfecho da operação vinculada à chave. */
export async function concluirIdempotencia(
  id: string,
  resultado: { status: StatusIdempotencia; vendaId?: string | null; responseStatus: number; responseBody: unknown },
): Promise<void> {
  await prisma.idempotencyKey.update({
    where: { id },
    data: {
      status: resultado.status,
      vendaId: resultado.vendaId ?? null,
      responseStatus: resultado.responseStatus,
      responseBody: resultado.responseBody as Prisma.InputJsonValue,
    },
  });
}

/**
 * Marca a chave como PROCESSANDO dentro de uma transação (usado quando a
 * aquisição e a confirmação precisam compartilhar o mesmo TX). Mantido simples
 * de propósito: o acquire normal roda fora do TX.
 */
export async function marcarProcessando(tx: Tx, id: string): Promise<void> {
  await tx.idempotencyKey.update({ where: { id }, data: { status: 'PROCESSANDO' } });
}

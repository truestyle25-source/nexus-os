import { db } from './db';
import { novoId, novaIdempotencyKey } from './idempotency';
import type { CarrinhoLocal, ContextoLocal, OperacaoPendente, TipoOperacao, StatusSync } from './tipos';

export interface EnfileirarInput extends ContextoLocal {
  tipo: TipoOperacao;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  id?: string;
}

export interface ResultadoProcessamento {
  id: string;
  ok: boolean;
  status: StatusSync;
  resposta?: unknown;
  erro?: string;
}

export type EnviarOperacao = (op: OperacaoPendente) => Promise<
  | { ok: true; resposta?: unknown; vendaIdRemota?: string | null }
  | { ok: false; erro: string; definitivo?: boolean }
>;

/** Enfileira antes da requisição de rede para que um crash nunca perca a venda. */
export async function enfileirar(input: EnfileirarInput): Promise<OperacaoPendente> {
  const database = db();
  const id = input.id ?? novoId();
  const existente = await database.operacoes.get(id);
  if (existente) return existente;

  const operacao: OperacaoPendente = {
    id,
    empresaId: input.empresaId,
    usuarioId: input.usuarioId,
    tipo: input.tipo,
    payload: input.payload,
    status: 'PENDENTE',
    tentativas: 0,
    idempotencyKey: input.idempotencyKey && input.idempotencyKey.length >= 8
      ? input.idempotencyKey
      : novaIdempotencyKey(input.tipo),
    criadoEm: Date.now(),
    atualizadoEm: Date.now(),
    ultimoErro: null,
    vendaIdRemota: null,
  };

  try {
    await database.operacoes.add(operacao);
    return operacao;
  } catch (error) {
    // Uma segunda aba pode enfileirar a mesma operação entre get() e add().
    const corrida = await database.operacoes.get(id);
    if (corrida) return corrida;
    throw error;
  }
}

/** Atomically stores the pending sale and the cart's recovery link. */
export async function enfileirarVendaComCarrinho(
  input: EnfileirarInput,
  carrinho: Omit<CarrinhoLocal, 'chave' | 'operacaoId' | 'atualizadoEm'>,
): Promise<OperacaoPendente> {
  if (input.tipo !== 'VENDA' || input.empresaId !== carrinho.empresaId || input.usuarioId !== carrinho.usuarioId) {
    throw new Error('A venda e o carrinho precisam pertencer ao mesmo operador e empresa.');
  }
  const database = db();
  const id = input.id ?? novoId();
  const agora = Date.now();
  const operacao: OperacaoPendente = {
    id,
    empresaId: input.empresaId,
    usuarioId: input.usuarioId,
    tipo: input.tipo,
    payload: input.payload,
    status: 'PENDENTE',
    tentativas: 0,
    idempotencyKey: input.idempotencyKey && input.idempotencyKey.length >= 8 ? input.idempotencyKey : novaIdempotencyKey(input.tipo),
    criadoEm: agora,
    atualizadoEm: agora,
    ultimoErro: null,
    vendaIdRemota: null,
  };
  const chave = `${carrinho.empresaId}:${carrinho.usuarioId}:atual`;
  return database.transaction('rw', database.operacoes, database.carrinho, async () => {
    const existente = await database.operacoes.get(id);
    if (existente) return existente;
    await database.operacoes.add(operacao);
    await database.carrinho.put({ ...carrinho, chave, operacaoId: id, atualizadoEm: agora });
    return operacao;
  });
}

export async function obterOperacao(id: string, contexto: ContextoLocal): Promise<OperacaoPendente | undefined> {
  const operacao = await db().operacoes.get(id);
  return operacao?.empresaId === contexto.empresaId && operacao.usuarioId === contexto.usuarioId ? operacao : undefined;
}

export async function listarPendentes(contexto: ContextoLocal): Promise<OperacaoPendente[]> {
  return databasePendentes(contexto);
}

async function databasePendentes(contexto: ContextoLocal): Promise<OperacaoPendente[]> {
  return db().operacoes.where('[empresaId+usuarioId]').equals([contexto.empresaId, contexto.usuarioId])
    .filter((op) => op.status === 'PENDENTE' || op.status === 'ERRO').sortBy('criadoEm');
}

export async function contarPorStatus(contexto: ContextoLocal): Promise<Record<StatusSync, number>> {
  const todas = await db().operacoes.where('[empresaId+usuarioId]').equals([contexto.empresaId, contexto.usuarioId]).toArray();
  const contagem: Record<StatusSync, number> = {
    PENDENTE: 0, SINCRONIZANDO: 0, CONFIRMADO: 0, ERRO: 0, DIVERGENCIA: 0,
  };
  for (const operacao of todas) contagem[operacao.status] += 1;
  return contagem;
}

/** Atualiza uma operação atomicamente e preserva todos os outros campos. */
export async function marcar(
  id: string,
  status: StatusSync,
  extra: { ultimoErro?: string | null; vendaIdRemota?: string | null; incrementarTentativa?: boolean } = {},
): Promise<void> {
  const database = db();
  await database.transaction('rw', database.operacoes, async () => {
    const atual = await database.operacoes.get(id);
    if (!atual) return;
    await database.operacoes.put({
      ...atual,
      status,
      atualizadoEm: Date.now(),
      ...(extra.ultimoErro !== undefined ? { ultimoErro: extra.ultimoErro } : {}),
      ...(extra.vendaIdRemota !== undefined ? { vendaIdRemota: extra.vendaIdRemota } : {}),
      ...(extra.incrementarTentativa ? { tentativas: atual.tentativas + 1 } : {}),
    });
  });
}

/** Retoma operações que ficaram em voo após queda ou encerramento inesperado. */
export async function recuperarOperacoesInterrompidas(contexto: ContextoLocal): Promise<number> {
  const database = db();
  return database.transaction('rw', database.operacoes, async () => {
    const interrompidas = await database.operacoes.where('[empresaId+usuarioId]').equals([contexto.empresaId, contexto.usuarioId])
      .filter((op) => op.status === 'SINCRONIZANDO' && op.atualizadoEm < Date.now() - 60_000).toArray();
    const agora = Date.now();
    await database.operacoes.bulkPut(interrompidas.map((operacao) => ({
      ...operacao,
      status: 'PENDENTE' as const,
      atualizadoEm: agora,
      ultimoErro: operacao.ultimoErro ?? 'Envio interrompido; será retomado com a mesma chave idempotente.',
    })));
    return interrompidas.length;
  });
}

/** Claim transacional: abas diferentes nunca enviam a mesma linha ao mesmo tempo. */
async function reivindicar(id: string, contexto: ContextoLocal): Promise<OperacaoPendente | null> {
  const database = db();
  return database.transaction('rw', database.operacoes, async () => {
    const atual = await database.operacoes.get(id);
    if (!atual || atual.empresaId !== contexto.empresaId || atual.usuarioId !== contexto.usuarioId || (atual.status !== 'PENDENTE' && atual.status !== 'ERRO')) return null;
    const reivindicada: OperacaoPendente = {
      ...atual,
      status: 'SINCRONIZANDO',
      tentativas: atual.tentativas + 1,
      atualizadoEm: Date.now(),
    };
    await database.operacoes.put(reivindicada);
    return reivindicada;
  });
}

export async function processarFila(enviar: EnviarOperacao, contexto: ContextoLocal, maxTentativas = 5): Promise<ResultadoProcessamento[]> {
  if (!Number.isInteger(maxTentativas) || maxTentativas < 1) throw new Error('maxTentativas precisa ser um inteiro positivo.');
  const agora = Date.now();
  const snapshot = (await databasePendentes(contexto)).filter((operacao) =>
    operacao.status === 'PENDENTE' || (operacao.tentativas < maxTentativas && agora - operacao.atualizadoEm >= atrasoRetryMs(operacao.tentativas)),
  );
  const resultados: ResultadoProcessamento[] = [];

  for (const pendente of snapshot) {
    const operacao = await reivindicar(pendente.id, contexto);
    if (!operacao) continue;
    try {
      const resposta = await enviar(operacao);
      if (resposta.ok) {
        await marcar(operacao.id, 'CONFIRMADO', { vendaIdRemota: resposta.vendaIdRemota ?? null, ultimoErro: null });
        resultados.push({ id: operacao.id, ok: true, status: 'CONFIRMADO', resposta: resposta.resposta });
      } else {
        await tratarFalha(operacao, resposta.erro, resposta.definitivo ?? false, maxTentativas, resultados);
      }
    } catch (error: unknown) {
      const mensagem = error instanceof Error ? error.message : 'Falha desconhecida ao sincronizar.';
      await tratarFalha(operacao, mensagem, false, maxTentativas, resultados);
    }
  }
  return resultados;
}

/** Exponential retry delay prevents focus/online events from hammering the API. */
function atrasoRetryMs(tentativas: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, tentativas - 1));
}

async function tratarFalha(
  operacao: OperacaoPendente,
  erro: string,
  definitivo: boolean,
  maxTentativas: number,
  resultados: ResultadoProcessamento[],
): Promise<void> {
  const estado = definitivo || operacao.tentativas >= maxTentativas ? 'DIVERGENCIA' : 'ERRO';
  await marcar(operacao.id, estado, { ultimoErro: erro });
  resultados.push({ id: operacao.id, ok: false, status: estado, erro });
}

/** Housekeeping explícito: mantém confirmado localmente por sete dias. */
export async function limparConfirmadas(contexto: ContextoLocal, maisAntigasQueMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  if (maisAntigasQueMs < 0) throw new Error('O prazo de retenção não pode ser negativo.');
  const limite = Date.now() - maisAntigasQueMs;
  const tabela = db().operacoes;
  const antigas = await tabela.where('[empresaId+usuarioId]').equals([contexto.empresaId, contexto.usuarioId])
    .filter((op) => op.status === 'CONFIRMADO' && op.atualizadoEm < limite).primaryKeys();
  await tabela.bulkDelete(antigas);
  return antigas.length;
}

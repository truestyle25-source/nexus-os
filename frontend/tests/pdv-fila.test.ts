import 'fake-indexeddb/auto';
import { IDBKeyRange } from 'fake-indexeddb';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdvDatabase, setDb, db } from '../lib/pdv/db';
import {
  enfileirar, listarPendentes, marcar, processarFila, contarPorStatus,
  recuperarOperacoesInterrompidas,
} from '../lib/pdv/syncQueue';

(globalThis as any).IDBKeyRange = IDBKeyRange;
const operadorA = { empresaId: 'empresa-a', usuarioId: 'operador-a' };
const operadorB = { empresaId: 'empresa-b', usuarioId: 'operador-b' };

async function novoBanco(nome: string): Promise<PdvDatabase> {
  setDb(null);
  const banco = new PdvDatabase(`pdv-fila-${nome}-${Date.now()}-${Math.random()}`);
  await banco.open();
  setDb(banco);
  return banco;
}

test('SyncQueue: enfileira PENDENTE, usa chave fixa e não duplica pelo mesmo id', async () => {
  const banco = await novoBanco('dedupe');
  try {
    const a = await enfileirar({ ...operadorA, id: 'op-1', tipo: 'VENDA', payload: { total: 100 } });
    assert.equal(a.status, 'PENDENTE');
    assert.ok(a.idempotencyKey.startsWith('venda-'));
    const b = await enfileirar({ ...operadorA, id: 'op-1', tipo: 'VENDA', payload: { total: 999 } });
    assert.equal(b.id, 'op-1');
    assert.equal(b.payload.total, 100);
    assert.equal(await db().operacoes.count(), 1);
  } finally { await banco.delete(); setDb(null); }
});

test('SyncQueue: separa filas por empresa e operador', async () => {
  const banco = await novoBanco('scope');
  try {
    await enfileirar({ ...operadorA, id: 'a', tipo: 'VENDA', payload: {} });
    await enfileirar({ ...operadorB, id: 'b', tipo: 'VENDA', payload: {} });
    assert.deepEqual((await listarPendentes(operadorA)).map((op) => op.id), ['a']);
    assert.deepEqual((await listarPendentes(operadorB)).map((op) => op.id), ['b']);
  } finally { await banco.delete(); setDb(null); }
});

test('SyncQueue: retoma envio interrompido com a mesma chave idempotente', async () => {
  const banco = await novoBanco('recovery');
  try {
    const op = await enfileirar({ ...operadorA, id: 'op-recovery', tipo: 'VENDA', payload: {}, idempotencyKey: 'venda-chave-fixa-1' });
    await marcar(op.id, 'SINCRONIZANDO');
    await db().operacoes.update(op.id, { atualizadoEm: Date.now() - 61_000 });
    assert.equal(await recuperarOperacoesInterrompidas(operadorA), 1);
    const recuperada = await db().operacoes.get(op.id);
    assert.equal(recuperada?.status, 'PENDENTE');
    assert.equal(recuperada?.idempotencyKey, 'venda-chave-fixa-1');
  } finally { await banco.delete(); setDb(null); }
});

test('SyncQueue: aplica backoff no retry e mantém a chave idempotente original', async () => {
  const banco = await novoBanco('retry-backoff');
  try {
    const op = await enfileirar({ ...operadorA, id: 'op-backoff', tipo: 'VENDA', payload: {}, idempotencyKey: 'venda-chave-backoff' });
    const chaves: string[] = [];
    const enviar = async (operacao: { idempotencyKey: string }) => {
      chaves.push(operacao.idempotencyKey);
      return chaves.length === 1 ? { ok: false as const, erro: 'rede indisponível' } : { ok: true as const, vendaIdRemota: 'venda-remota-2' };
    };
    await processarFila(enviar, operadorA);
    const imediato = await processarFila(enviar, operadorA);
    assert.equal(imediato.length, 0, 'não deve repetir no mesmo ciclo de eventos');
    assert.equal(chaves.length, 1);
    await db().operacoes.update(op.id, { atualizadoEm: Date.now() - 1_001 });
    await processarFila(enviar, operadorA);
    assert.deepEqual(chaves, ['venda-chave-backoff', 'venda-chave-backoff']);
    assert.equal((await db().operacoes.get(op.id))?.status, 'CONFIRMADO');
  } finally { await banco.delete(); setDb(null); }
});

test('SyncQueue: dois processadores concorrentes reivindicam uma operação uma vez', async () => {
  const banco = await novoBanco('claim-race');
  try {
    await enfileirar({ ...operadorA, id: 'op-race', tipo: 'VENDA', payload: {} });
    let chamadas = 0;
    const enviar = async () => {
      chamadas += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true as const, vendaIdRemota: 'venda-remota-1' };
    };
    await Promise.all([processarFila(enviar, operadorA), processarFila(enviar, operadorA)]);
    assert.equal(chamadas, 1);
    assert.equal((await db().operacoes.get('op-race'))?.status, 'CONFIRMADO');
  } finally { await banco.delete(); setDb(null); }
});

test('SyncQueue: contador reflete transições apenas do operador solicitado', async () => {
  const banco = await novoBanco('status');
  try {
    await enfileirar({ ...operadorA, id: 'a', tipo: 'VENDA', payload: {} });
    await enfileirar({ ...operadorB, id: 'b', tipo: 'VENDA', payload: {} });
    await marcar('a', 'CONFIRMADO');
    const contagem = await contarPorStatus(operadorA);
    assert.equal(contagem.PENDENTE, 0);
    assert.equal(contagem.CONFIRMADO, 1);
    assert.equal((await contarPorStatus(operadorB)).PENDENTE, 1);
  } finally { await banco.delete(); setDb(null); }
});

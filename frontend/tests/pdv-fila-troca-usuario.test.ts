/**
 * MÓDULO 07 — CENÁRIO 5: fila offline após troca de usuário.
 *
 * Regra de segurança: uma operação PENDENTE enfileirada pelo operador A NÃO
 * pode ser executada silenciosamente sob a identidade do operador B depois de
 * trocar de sessão. O escopo da fila é [empresaId+usuarioId]: `processarFila`,
 * `reivindicar` e `listarPendentes` só enxergam linhas do próprio operador.
 *
 * Cobrimos dois formatos de troca:
 *   (a) mesmo tenant, outro operador (usuário diferente);
 *   (b) tenant diferente por completo.
 * Em ambos, a fila do novo usuário ignora a operação antiga e o callback de
 * envio NUNCA é chamado para ela.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, destruirBanco } from './helpers-idb';
import { enfileirar, listarPendentes, processarFila } from '../lib/pdv/syncQueue';
import { db } from '../lib/pdv/db';
import type { ContextoLocal } from '../lib/pdv/tipos';

const operadorA: ContextoLocal = { empresaId: 'emp-1', usuarioId: 'op-A' };
const operadorB: ContextoLocal = { empresaId: 'emp-1', usuarioId: 'op-B' };
const outroTenant: ContextoLocal = { empresaId: 'emp-2', usuarioId: 'op-C' };

test('S5-a: operação pendente de A não é executada sob o operador B (mesma empresa)', async () => {
  const banco = await novoBanco('s5-troca-usuario');
  try {
    await enfileirar({ ...operadorA, id: 'op-antiga', tipo: 'VENDA', payload: { total: 100 }, idempotencyKey: 'venda-op-a-chave-1' });
    let envios = 0;
    const enviar = async () => { envios += 1; return { ok: true as const, vendaIdRemota: 'não-deveria' }; };
    const resultados = await processarFila(enviar, operadorB);
    assert.equal(envios, 0, 'callback de envio não deve ser chamado para a fila de outro operador');
    assert.equal(resultados.length, 0, 'B não processa nada da fila de A');
    // A operação antiga permanece PENDENTE, íntegra, com a MESMA chave.
    const antiga = await db().operacoes.get('op-antiga');
    assert.equal(antiga?.status, 'PENDENTE');
    assert.equal(antiga?.idempotencyKey, 'venda-op-a-chave-1');
    // A fila de B está vazia; a de A continua com a operação.
    assert.deepEqual((await listarPendentes(operadorB)).map((o) => o.id), []);
    assert.deepEqual((await listarPendentes(operadorA)).map((o) => o.id), ['op-antiga']);
  } finally { await destruirBanco(banco); }
});

test('S5-b: operação pendente de A não vaza para outro tenant', async () => {
  const banco = await novoBanco('s5-troca-tenant');
  try {
    await enfileirar({ ...operadorA, id: 'op-x', tipo: 'VENDA', payload: { total: 50 }, idempotencyKey: 'venda-op-x-chave-9' });
    let envios = 0;
    const enviar = async () => { envios += 1; return { ok: true as const, vendaIdRemota: 'não-deveria' }; };
    await processarFila(enviar, outroTenant);
    assert.equal(envios, 0, 'outro tenant não executa a fila de A');
    assert.deepEqual((await listarPendentes(outroTenant)).map((o) => o.id), []);
    assert.equal((await db().operacoes.get('op-x'))?.status, 'PENDENTE');
  } finally { await destruirBanco(banco); }
});

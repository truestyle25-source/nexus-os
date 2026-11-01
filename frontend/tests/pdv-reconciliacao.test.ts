import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarOperacaoPdv } from '../lib/pdv/enviarOperacao';
import type { OperacaoPendente } from '../lib/pdv/tipos';

const operacao: OperacaoPendente = {
  id: 'op-fase4', empresaId: 'empresa-a', usuarioId: 'operador-a', tipo: 'VENDA',
  payload: { filialId: 'filial-a', itens: [] }, status: 'SINCRONIZANDO', tentativas: 1,
  idempotencyKey: 'venda-fase4-chave-unica', criadoEm: 1, atualizadoEm: 1,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function withFetch(fetcher: typeof fetch, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('timeout após commit reconcilia a venda sem reenviar operação', async () => {
  await withFetch((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/vendas')) throw new TypeError('conexão interrompida após envio');
    assert.ok(url.includes('/vendas/idempotencia/venda-fase4-chave-unica'));
    return response(200, { status: 'CONFIRMADA', vendaId: 'venda-remota-1', responseStatus: 201 });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, true);
    if (resultado.ok) assert.equal(resultado.vendaIdRemota, 'venda-remota-1');
  });
});

test('resposta de sucesso sem ID da venda consulta o registro durável', async () => {
  await withFetch((async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/vendas')) return response(201, { ok: true });
    return response(200, { status: 'CONFIRMADA', vendaId: 'venda-remota-2', responseStatus: 201 });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, true);
    if (resultado.ok) assert.equal(resultado.vendaIdRemota, 'venda-remota-2');
  });
});

test('registro PROCESSANDO permanece retryable e não é declarado como venda concluída', async () => {
  await withFetch((async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/vendas')) return response(409, { error: 'em processamento' });
    return response(200, { status: 'PROCESSANDO', vendaId: null, responseStatus: null });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.definitivo, false);
  });
});

test('registro REJEITADA vai para divergência para revisão sem retry automático', async () => {
  await withFetch((async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/vendas')) return response(409, { error: 'em processamento' });
    return response(200, { status: 'REJEITADA', vendaId: null, responseStatus: 422 });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.definitivo, true);
  });
});

test('chave inexistente continua retryable usando exatamente a mesma chave', async () => {
  const headers: Headers[] = [];
  await withFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/vendas')) {
      headers.push(new Headers(init?.headers));
      throw new TypeError('rede indisponível');
    }
    return response(404, { error: 'não encontrada' });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.definitivo, false);
    assert.equal(headers[0]?.get('x-idempotency-key'), operacao.idempotencyKey);
  });
});

test('401 sessão expirada NÃO é definitivo: retry com a mesma chave após novo login', async () => {
  const headers: Headers[] = [];
  await withFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/vendas')) {
      headers.push(new Headers(init?.headers));
      return response(401, { error: 'Token expirado.' });
    }
    return response(401, { error: 'Token expirado.' });
  }) as typeof fetch, async () => {
    const resultado = await enviarOperacaoPdv(operacao);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.definitivo, false);
    assert.equal(headers[0]?.get('x-idempotency-key'), operacao.idempotencyKey);
  });
});

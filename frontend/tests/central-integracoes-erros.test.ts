import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensagemDeErroApi, redigirMensagemDeErro } from '../lib/erros-api';

test('usa o message real do ApiHttpError (formato fetch de lib/api, sem .response.data.erro)', () => {
  const mensagem =
    'Configuração incompleta do Mercado Livre. Defina MERCADOLIVRE_CLIENT_ID e MERCADOLIVRE_CLIENT_SECRET no arquivo .env do servidor.';
  // Shape real lançado por lib/api.ts: { status, message, data }.
  const erroApi = { status: 503, message: mensagem, data: { error: mensagem } };
  assert.equal(mensagemDeErroApi(erroApi, 'fallback'), mensagem);
  // data.error puro também é aceito (contrato do backend).
  assert.equal(mensagemDeErroApi({ data: { error: 'Sem credenciais.' } }, 'fallback'), 'Sem credenciais.');
});

test('sem mensagem utilizável cai no padrão (nunca mostra undefined/vazio)', () => {
  assert.equal(mensagemDeErroApi(undefined, 'Não foi possível iniciar a conexão.'), 'Não foi possível iniciar a conexão.');
  assert.equal(mensagemDeErroApi(new Error('   '), 'padrao'), 'padrao');
  assert.equal(mensagemDeErroApi({ status: 500, message: 123 }, 'padrao'), 'padrao');
});

test('redige code/state, Bearer e JWT antes de exibir', () => {
  const m = mensagemDeErroApi(
    { message: 'Falha em /cb?code=CODIGO-SIGILOSO&state=STATE-SIGILOSO com Bearer ABCDEF123456' },
    'fallback',
  );
  assert.ok(!m.includes('CODIGO-SIGILOSO'), m);
  assert.ok(!m.includes('STATE-SIGILOSO'), m);
  assert.ok(!m.includes('ABCDEF123456'), m);
  assert.ok(m.includes('[REDACTED]'), m);
  assert.ok(m.includes('/cb'), m);

  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura';
  const comJwt = redigirMensagemDeErro(`token ${jwt} inválido`);
  assert.ok(!comJwt.includes('eyJhbGciOiJIUzI1NiJ9'), comJwt);
  assert.ok(comJwt.includes('token ') && comJwt.includes(' inválido'), comJwt);
});

test('limita o tamanho da mensagem exibida a 300 caracteres', () => {
  assert.equal(mensagemDeErroApi({ message: 'x'.repeat(1000) }, 'padrao').length, 300);
});

test('motivo vindo do callback do Mercado Livre e redigido antes de exibir', () => {
  // O ?ml=erro&motivo=... do redirect é query string forjável: a página
  // passa por redigirMensagemDeErro antes de exibir no banner de erro.
  const m = redigirMensagemDeErro(
    'Falha na troca do code=CODIGO-ML-123&state=STATE-ML-456 reportada pelo provedor',
  );
  assert.ok(!m.includes('CODIGO-ML-123'), m);
  assert.ok(!m.includes('STATE-ML-456'), m);
  assert.ok(m.includes('[REDACTED]'), m);
  assert.ok(m.includes('reportada pelo provedor'), m);
});
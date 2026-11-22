import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposFaltando, corDoStatus, ROTULO_STATUS, saudeDaCentral, type CampoProvedor } from '../lib/integracoes-central';

const campos: CampoProvedor[] = [
  { chave: 'ambiente', rotulo: 'Ambiente', tipo: 'selecao', obrigatorio: true, secreto: false },
  { chave: 'apiKey', rotulo: 'Chave de API', tipo: 'segredo', obrigatorio: true, secreto: true },
  { chave: 'obs', rotulo: 'Obs', tipo: 'texto', obrigatorio: false, secreto: false },
];

test('saúde da central: conectadas ÷ (conectadas + com erro); sem uso → null', () => {
  assert.equal(saudeDaCentral(0, 0), null);
  assert.equal(saudeDaCentral(3, 1), 75);
  assert.equal(saudeDaCentral(2, 0), 100);
});

test('campos obrigatórios: segredo já salvo conta como preenchido', () => {
  assert.deepEqual(camposFaltando(campos, {}), ['Ambiente', 'Chave de API']);
  assert.deepEqual(camposFaltando(campos, { ambiente: 'SANDBOX' }, { apiKey: '••••1234' }), []);
  assert.deepEqual(camposFaltando(campos, { ambiente: ' ', apiKey: 'x' }), ['Ambiente']);
});

test('rótulos e cores cobrem todos os estados', () => {
  for (const s of Object.keys(ROTULO_STATUS) as (keyof typeof ROTULO_STATUS)[]) assert.ok(corDoStatus(s));
  assert.equal(corDoStatus('EXPIRADO'), 'var(--nx-amber)');
  assert.equal(ROTULO_STATUS.CREDENCIAIS_SALVAS, 'CREDENCIAIS SALVAS');
});

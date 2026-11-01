import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculaCRC16,
  formataCampo,
  gerarPixPayloadUniversal,
  gerarTxid,
  normalizaTxid,
} from '../src/modules/payments/pixUniversal.js';

test('CRC-16/CCITT-FALSE do vetor clássico retorna 29B1', () => {
  assert.equal(calculaCRC16('123456789'), '29B1');
});

test('formataCampo monta ID + tamanho + valor', () => {
  assert.equal(formataCampo('00', '01'), '000201');
  assert.equal(formataCampo('59', 'FULANO'), '5906FULANO');
});

test('BR Code gerado termina com CRC válido e contém txid', () => {
  const { payload, txid } = gerarPixPayloadUniversal({
    chavePix: '12345678909',
    nomeRecebedor: 'LOJA TESTE',
    cidadeRecebedor: 'SAO PAULO',
    valor: 10.5,
    txid: 'NEXUS123',
  });
  assert.ok(payload.includes('br.gov.bcb.pix'));
  assert.ok(payload.includes('NEXUS123'));
  assert.ok(payload.startsWith('000201'));
  const semCrc = payload.slice(0, -4);
  const crc = payload.slice(-4);
  assert.equal(calculaCRC16(semCrc + ''), calculaCRC16(semCrc));
  assert.equal(calculaCRC16(semCrc), crc);
  assert.match(txid, /^[A-Za-z0-9]{1,25}$/);
});

test('normalizaTxid rejeita txid fora do padrão BACEN', () => {
  assert.throws(() => normalizaTxid('com espaço'), /txid/);
  assert.throws(() => normalizaTxid('a'.repeat(26)), /txid/);
});

test('gerarTxid sempre respeita 25 chars BACEN', () => {
  for (let i = 0; i < 20; i++) assert.match(gerarTxid(), /^[A-Za-z0-9]{1,25}$/);
});

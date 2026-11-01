import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarFormaOffline, avaliarVendaOffline } from '../lib/pdv/politicaOffline';

// FASE 2 PDV PRO — política offline explícita em código (fonte única).
// PIX/cartão nunca são "pagos" sem confirmação do provider; só dinheiro
// pode ser enfileirado offline. Cancelamento/devolução/sangria/fechamento
// nem chegam à fila (enviarOperacaoPdv só aceita VENDA).

test('política offline: dinheiro pode, PIX e cartão não', () => {
  assert.equal(avaliarFormaOffline('DINHEIRO').permitida, true);
  assert.equal(avaliarFormaOffline('PIX').permitida, false);
  assert.equal(avaliarFormaOffline('CARTAO_CREDITO').permitida, false);
  assert.equal(avaliarFormaOffline('CARTAO_DEBITO').permitida, false);
  assert.equal(avaliarFormaOffline('BOLETO').permitida, false);
});

test('política offline: pagamento misto com PIX é bloqueado offline', () => {
  const soDinheiro = avaliarVendaOffline({ formaPagamento: 'DINHEIRO', pagamentos: [{ forma: 'DINHEIRO', valor: 100 }] });
  assert.equal(soDinheiro.permitida, true);
  const misto = avaliarVendaOffline({ formaPagamento: 'DINHEIRO', pagamentos: [{ forma: 'DINHEIRO', valor: 30 }, { forma: 'PIX', valor: 70 }] });
  assert.equal(misto.permitida, false);
  assert.match(misto.motivo, /PIX/);
});

test('política offline: forma única PIX é bloqueada offline', () => {
  const pix = avaliarVendaOffline({ formaPagamento: 'PIX' });
  assert.equal(pix.permitida, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cupomDaVenda } from '../lib/pdv/cupom';

test('impressão recompõe o cupom com os dados persistidos da venda finalizada', () => {
  const cupom = cupomDaVenda({
    id: 'venda-1', status: 'FINALIZADA', createdAt: '2026-10-08T12:00:00.000Z',
    subtotal: '30.00', desconto: '2.00', total: '28.00', formaPagamento: 'DINHEIRO', parcelas: 1,
    itens: [{ produtoNome: 'Produto persistido', quantidade: 2, total: '28.00' }],
  }, 'Filial Centro', 'Operador Teste');
  assert.ok(cupom);
  assert.equal(cupom.total, 28);
  assert.equal(cupom.itens[0].nome, 'Produto persistido');
  assert.equal(cupom.itens[0].quantidade, 2);
  assert.equal(cupom.itens[0].total, 28);
  assert.equal(cupom.filialNome, 'Filial Centro');
});

test('não produz cupom para venda cancelada, sem itens ou com campos inválidos', () => {
  assert.equal(cupomDaVenda({ id: 'venda-2', status: 'CANCELADA', itens: [] }, '', ''), null);
  assert.equal(cupomDaVenda({ id: 'venda-3', status: 'FINALIZADA', itens: [] }, '', ''), null);
  assert.equal(cupomDaVenda({ id: 'venda-4', status: 'FINALIZADA', createdAt: 'invalida', subtotal: 10, desconto: 0, total: 10, itens: [{ quantidade: 1, total: 10 }] }, '', ''), null);
});

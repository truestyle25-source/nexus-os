/**
 * MÓDULO 09 — Testes do comprovante NÃO FISCAL (ETAPA 3 e ETAPA 10).
 *
 * `renderCupom` e `cupomDaVenda` foram consolidados em `lib/pdv/cupom.ts`
 * (fonte única, extraídos de `page.tsx` sem alterar a saída). Estes testes
 * cobrem a formatação do comprovante impresso com window.print():
 *   - um e vários produtos; desconto; parcelas; troco;
 *   - valores e arredondamentos exibidos; caracteres acentuados; texto longo;
 *   - quantidade elevada de itens; forma de pagamento desconhecida;
 *   - reimpressão (idempotente: mesma entrada => mesma saída, sem nova venda);
 *   - recusa de venda não FINALIZADA / dados inválidos (nunca imprime o que
 *     não é uma venda confirmada pelo backend).
 *
 * Nada aqui aciona hardware: a impressão física (térmica, corte, gaveta) segue
 * dependente do modelo equipamento — registrada como pendência de homologação.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cupomDaVenda, renderCupom } from '../lib/pdv/cupom';

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const ROTULO: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'PIX', CARTAO_DEBITO: 'Cartão de Débito',
  CARTAO_CREDITO: 'Cartão de Crédito', BOLETO: 'Boleto',
};

function cupom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'venda-abcdef12-3456', criadoEm: '2026-10-11T14:30:00.000Z', filialNome: 'Filial Centro',
    operador: 'Maria Souza', itens: [{ nome: 'Água Mineral', quantidade: 2, total: 7 }],
    subtotal: 7, desconto: 0, total: 7, forma: 'DINHEIRO', parcelas: 1, troco: 0,
    ...overrides,
  };
}

test('cupom identifica explicitamente como NÃO FISCAL', () => {
  const texto = renderCupom(cupom(), brl, ROTULO);
  assert.match(texto, /NEXUS OS/);
  assert.match(texto, /NÃO FISCAL/);
});

test('cupom com um produto mostra quantidade, valor e total', () => {
  const texto = renderCupom(cupom(), brl, ROTULO);
  assert.match(texto, /2x Água Mineral/);
  assert.match(texto, /R\$ 7,00/);
  assert.match(texto, /TOTAL: R\$ 7,00/);
});

test('cupom com vários produtos lista todos', () => {
  const texto = renderCupom(cupom({
    itens: [
      { nome: 'Água', quantidade: 1, total: 3.5 },
      { nome: 'Café', quantidade: 3, total: 21 },
      { nome: 'Bolo', quantidade: 1, total: 8 },
    ],
    subtotal: 32.5, total: 32.5,
  }), brl, ROTULO);
  assert.match(texto, /1x Água/);
  assert.match(texto, /3x Café/);
  assert.match(texto, /1x Bolo/);
});

test('cupom aplica desconto autorizado e mostra subtotal e total corretos', () => {
  const texto = renderCupom(cupom({ subtotal: 30, desconto: 2, total: 28 }), brl, ROTULO);
  assert.match(texto, /Subtotal: R\$ 30,00/);
  assert.match(texto, /Desconto: -R\$ 2,00/);
  assert.match(texto, /TOTAL: R\$ 28,00/);
});

test('cupom não mostra linha de desconto quando ele é zero', () => {
  const texto = renderCupom(cupom({ desconto: 0 }), brl, ROTULO);
  assert.doesNotMatch(texto, /Desconto:/);
});

test('cupom em dinheiro mostra o troco', () => {
  const texto = renderCupom(cupom({ total: 18, troco: 2, forma: 'DINHEIRO' }), brl, ROTULO);
  assert.match(texto, /Pagamento: Dinheiro/);
  assert.match(texto, /Troco: R\$ 2,00/);
});

test('cupom em cartão de crédito parcelado mostra valor de cada parcela', () => {
  const texto = renderCupom(cupom({ total: 90, forma: 'CARTAO_CREDITO', parcelas: 3 }), brl, ROTULO);
  assert.match(texto, /Pagamento: Cartão de Crédito 3x de R\$ 30,00/);
});

test('cupom preserva caracteres acentuados', () => {
  const texto = renderCupom(cupom({
    filialNome: 'Filial São João', operador: 'José Açaí',
    itens: [{ nome: 'Açaí 500ml c/ granola', quantidade: 1, total: 15.9 }],
    subtotal: 15.9, total: 15.9,
  }), brl, ROTULO);
  assert.match(texto, /São João/);
  assert.match(texto, /José Açaí/);
  assert.match(texto, /Açaí 500ml/);
});

test('cupom trunca nome de produto muito longo sem quebrar a linha', () => {
  const longo = 'Produto com nome extremamente longo que excede o limite';
  const texto = renderCupom(cupom({ itens: [{ nome: longo, quantidade: 1, total: 5 }], subtotal: 5, total: 5 }), brl, ROTULO);
  const linhaItem = texto.split('\n').find((l) => l.includes('Produto com nome'))!;
  assert.ok(linhaItem, 'linha do item deve existir');
  assert.ok(linhaItem.length <= 24 + 40, 'linha truncada permanece monoespaçada e contida');
  assert.ok(!linhaItem.includes(longo), 'nome longo foi truncado');
});

test('cupom suporta quantidade elevada de itens', () => {
  const muitos = Array.from({ length: 50 }, (_, k) => ({ nome: `Item ${k + 1}`, quantidade: k + 1, total: (k + 1) * 2 }));
  const texto = renderCupom(cupom({ itens: muitos, subtotal: 2550, total: 2550 }), brl, ROTULO);
  assert.match(texto, /1x Item 1/);
  assert.match(texto, /50x Item 50/);
});

test('cupom com forma desconhecida cai para o código cru, sem inventar rótulo', () => {
  const texto = renderCupom(cupom({ forma: 'TRANSFERENCIA' }), brl, ROTULO);
  assert.match(texto, /Pagamento: TRANSFERENCIA/);
});

test('reimpressão é idempotente: mesma entrada produz saída idêntica', () => {
  const c = cupom({ subtotal: 12, desconto: 1, total: 11, forma: 'PIX' });
  assert.equal(renderCupom(c, brl, ROTULO), renderCupom(c, brl, ROTULO));
});

test('cupomDaVenda recusa venda não FINALIZADA (nunca imprime pendente)', () => {
  assert.equal(cupomDaVenda({ id: 'v1', status: 'CANCELADA', subtotal: 10, desconto: 0, total: 10, formaPagamento: 'DINHEIRO', parcelas: 1, itens: [{ quantidade: 1, total: 10 }], createdAt: '2026-10-11T00:00:00Z' }, 'F', 'Op'), null);
  assert.equal(cupomDaVenda({ id: 'v2', status: 'ABERTA', subtotal: 10, desconto: 0, total: 10, formaPagamento: 'DINHEIRO', parcelas: 1, itens: [{ quantidade: 1, total: 10 }], createdAt: '2026-10-11T00:00:00Z' }, 'F', 'Op'), null);
});

test('cupomDaVenda recusa dados inválidos (data, valores, itens)', () => {
  const base = { id: 'v3', status: 'FINALIZADA', createdAt: '2026-10-11T00:00:00Z' };
  assert.equal(cupomDaVenda({ ...base, subtotal: -1, desconto: 0, total: 0, formaPagamento: 'DINHEIRO', parcelas: 1, itens: [{ quantidade: 1, total: 0 }] }, 'F', 'Op'), null);
  assert.equal(cupomDaVenda({ ...base, createdAt: 'nao-e-data', subtotal: 10, desconto: 0, total: 10, formaPagamento: 'DINHEIRO', parcelas: 1, itens: [{ quantidade: 1, total: 10 }] }, 'F', 'Op'), null);
  assert.equal(cupomDaVenda({ ...base, subtotal: 10, desconto: 0, total: 10, formaPagamento: '', parcelas: 1, itens: [{ quantidade: 1, total: 10 }] }, 'F', 'Op'), null);
  assert.equal(cupomDaVenda({ ...base, subtotal: 10, desconto: 0, total: 10, formaPagamento: 'DINHEIRO', parcelas: 1, itens: [] }, 'F', 'Op'), null);
});

test('cupomDaVenda deriva o cupom de uma venda persistida confirmada', () => {
  const c = cupomDaVenda({
    id: 'venda-1', status: 'FINALIZADA', createdAt: '2026-10-08T12:00:00.000Z',
    subtotal: '30.00', desconto: '2.00', total: '28.00', formaPagamento: 'DINHEIRO', parcelas: 1,
    itens: [{ produtoNome: 'Produto persistido', quantidade: 2, total: '28.00' }],
  }, 'Filial Centro', 'Maria Souza');
  assert.ok(c);
  assert.equal(c.total, 28);
  assert.equal(c.itens[0].nome, 'Produto persistido');
  // E renderiza sem erro, marcado como não fiscal.
  assert.match(renderCupom(c, brl, ROTULO), /NÃO FISCAL/);
});


/**
 * MÓDULO 08 — Testes das regras puras do carrinho (ETAPA 2 e ETAPA 8).
 *
 * A lógica do carrinho foi extraída de `page.tsx` para `lib/pdv/carrinho.ts`
 * (fonte única, sem duplicar aritmética). Estes testes cobrem, de forma
 * determinística e sem navegador:
 *   - adicionar produto / adicionar o mesmo de novo;
 *   - alterar quantidade (inclusive remover ao zerar) e limite de estoque;
 *   - remover produto e trabalhar com vários produtos;
 *   - atualização de subtotal/total e desconto geral válido/inválido;
 *   - produto indisponível (sem estoque) e dados inválidos.
 *
 * O backend continua sendo a autoridade; aqui validamos só a experiência do
 * operador (o que a tela calcula antes de finalizar).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adicionarProduto,
  alterarQuantidade,
  removerProduto,
  subtotalDoCarrinho,
  totalComDesconto,
  type ItemCarrinho,
  type ProdutoEntrada,
} from '../lib/pdv/carrinho';

const agua: ProdutoEntrada = { id: 'p-agua', nome: 'Água', precoVenda: 3.5, estoqueFilial: 5, imagem: null };
const cafe: ProdutoEntrada = { id: 'p-cafe', nome: 'Café', precoVenda: 7, estoqueFilial: 2, imagem: null };
const semEstoque: ProdutoEntrada = { id: 'p-x', nome: 'Sem estoque', precoVenda: 10, estoqueFilial: 0, imagem: null };

test('adicionar um produto cria a linha com quantidade 1', () => {
  const r = adicionarProduto([], agua);
  assert.equal(r.erro, null);
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].produtoId, 'p-agua');
  assert.equal(r.itens[0].quantidade, 1);
  assert.equal(r.itens[0].preco, 3.5);
});

test('adicionar o mesmo produto novamente incrementa a quantidade', () => {
  let estado = adicionarProduto([], agua);
  estado = adicionarProduto(estado.itens, agua);
  assert.equal(estado.itens.length, 1, 'não deve duplicar a linha');
  assert.equal(estado.itens[0].quantidade, 2);
});

test('adicionar respeita o estoque da filial e recusa acima do limite', () => {
  let estado = adicionarProduto([], cafe); // estoque 2
  estado = adicionarProduto(estado.itens, cafe);
  assert.equal(estado.itens[0].quantidade, 2);
  const estouro = adicionarProduto(estado.itens, cafe); // 3 > 2
  assert.equal(estouro.erro, 'Estoque insuficiente de Café: 2 unidades.');
  assert.equal(estouro.itens[0].quantidade, 2, 'estado permanece inalterado');
});

test('produto indisponível (sem estoque) é recusado com mensagem', () => {
  const r = adicionarProduto([], semEstoque);
  assert.equal(r.erro, 'Sem estoque de Sem estoque nesta filial.');
  assert.equal(r.itens.length, 0);
});

test('alterarQuantidade define o valor e remove o item ao zerar', () => {
  let estado = adicionarProduto([], agua);
  estado = adicionarProduto(estado.itens, agua); // qtd 2
  const paraTres = alterarQuantidade(estado.itens, 'p-agua', 3);
  assert.equal(paraTres.itens[0].quantidade, 3);
  const zero = alterarQuantidade(paraTres.itens, 'p-agua', 0);
  assert.equal(zero.itens.length, 0, 'quantidade <= 0 remove o item');
});

test('alterarQuantidade recusa valor acima do estoque e valor inválido', () => {
  const estado = adicionarProduto([], cafe); // estoque 2
  const acima = alterarQuantidade(estado.itens, 'p-cafe', 5);
  assert.equal(acima.erro, 'Estoque insuficiente de Café: 2 unidades.');
  assert.equal(acima.itens[0].quantidade, 1);
  const invalido = alterarQuantidade(estado.itens, 'p-cafe', Number.NaN);
  assert.match(invalido.erro ?? '', /inválida/);
});

test('remover um produto mantém os demais', () => {
  let estado = adicionarProduto([], agua);
  estado = adicionarProduto(estado.itens, cafe);
  assert.equal(estado.itens.length, 2);
  const restantes = removerProduto(estado.itens, 'p-agua');
  assert.deepEqual(restantes.map((i) => i.produtoId), ['p-cafe']);
});

test('subtotal soma preço*quantidade menos desconto do item, com vários produtos', () => {
  let estado = adicionarProduto([], agua); // 3.5 x1
  estado = adicionarProduto(estado.itens, agua); // 3.5 x2 = 7
  estado = adicionarProduto(estado.itens, cafe); // 7 x1 = 7
  // aplica um desconto de 0.5 no café
  estado.itens = estado.itens.map((i) => (i.produtoId === 'p-cafe' ? { ...i, desconto: 0.5 } : i));
  // 7 + (7 - 0.5) = 13.5
  assert.equal(subtotalDoCarrinho(estado.itens), 13.5);
});

test('totalComDesconto aplica desconto válido e marca inválido quando > subtotal', () => {
  const itens: ItemCarrinho[] = [
    { produtoId: 'p-agua', nome: 'Água', preco: 10, quantidade: 1, estoque: 5, desconto: 0 },
  ];
  const ok = totalComDesconto(itens, 3);
  assert.equal(ok.descontoInvalido, false);
  assert.equal(ok.descontoAplicado, 3);
  assert.equal(ok.total, 7);
  const excede = totalComDesconto(itens, 99);
  assert.equal(excede.descontoInvalido, true);
  // clamp: desconto nunca supera o subtotal
  assert.equal(excede.descontoAplicado, 10);
  assert.equal(excede.total, 0);
  const negativo = totalComDesconto(itens, -5);
  assert.equal(negativo.descontoInvalido, true);
  assert.equal(negativo.total, 10);
});

test('totalComDesconto trata valor não numérico como zero', () => {
  const itens: ItemCarrinho[] = [
    { produtoId: 'p-agua', nome: 'Água', preco: 4, quantidade: 2, estoque: 5, desconto: 0 },
  ];
  const r = totalComDesconto(itens, Number.NaN);
  assert.equal(r.descontoInvalido, false);
  assert.equal(r.total, 8);
});


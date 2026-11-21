// Composição do Kit: o custo exibido enquanto o usuário digita segue a mesma regra do servidor
// (quantidade × fator para a unidade base × custo da base), e linhas inválidas não somam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGO_TIPO_KIT, custoDaLinha, lerNumero } from '../lib/produto-ficha';

test('custo da linha: KG, G, L, ML e caixa com fator', () => {
  assert.equal(custoDaLinha(1, 1, 5), 5, '1 kg de açúcar a R$ 5/kg');
  assert.equal(custoDaLinha(2000, 0.001, 4), 8, '2000 g de farinha a R$ 4/kg');
  assert.equal(custoDaLinha(1000, 0.001, 5), 5, '1000 mL de leite a R$ 5/L');
  assert.equal(custoDaLinha(500, 0.001, 24), 12, '500 g de chocolate a R$ 24/kg');
  assert.equal(custoDaLinha(1, 12, 0.5), 6, '1 CX = 12 UN de ovos a R$ 0,50');
  const total = [custoDaLinha(1, 1, 5), custoDaLinha(2, 1, 4), custoDaLinha(1, 1, 5), custoDaLinha(500, 0.001, 24)].reduce<number>((s, c) => s + (c ?? 0), 0);
  assert.equal(total, 30, 'exemplo do pedido: R$ 30,00');
});

test('custo da linha: quantidade inválida ou custo oculto não calculam', () => {
  assert.equal(custoDaLinha(0, 1, 5), null);
  assert.equal(custoDaLinha(-1, 1, 5), null);
  assert.equal(custoDaLinha(null, 1, 5), null);
  assert.equal(custoDaLinha(1, 1, undefined), null, 'sem permissão de custo');
  assert.equal(custoDaLinha(lerNumero('0,5'), 1, 24), 12, 'vírgula decimal');
});

test('código do tipo que exibe a aba', () => {
  assert.equal(CODIGO_TIPO_KIT, 'KIT');
});

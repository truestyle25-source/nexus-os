// Compras: totais como o servidor calcula, etapas do processo e corpo da API (só o que mudou).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTotais, etapaAtual } from '../lib/compra-ficha';
import { formVazio, payloadCompra, problemas } from '../components/compra/formulario';

test('totais: itens − desconto + frete + outras', () => {
  const r = calcularTotais([{ quantidade: 100, valorUnit: 5.2, desconto: 0 }, { quantidade: 50, valorUnit: 4.5, desconto: 5 }], 10, 20, 5);
  assert.deepEqual(r, { produtos: 740, total: 755 });
});

test('etapas do processo pelo status', () => {
  assert.equal(etapaAtual('RASCUNHO'), 0);
  assert.equal(etapaAtual('APROVADA'), 2);
  assert.equal(etapaAtual('PARCIAL'), 4);
  assert.equal(etapaAtual('CONCLUIDA'), 6);
  assert.equal(etapaAtual('CANCELADA'), -1);
});

test('payload: cadastro manda itens; edição só o que mudou; valores travados após aprovação', () => {
  const f = { ...formVazio(), filialId: 'fil', fornecedorId: 'for', frete: '20,5', itens: [{ produtoId: 'p', codigo: null, nome: 'Farinha', quantidade: '100', unidade: 'kg', valorUnit: '5,20', desconto: '', observacao: '' }] };
  const novo = payloadCompra(null, f, true);
  assert.equal(novo.frete, 20.5);
  assert.deepEqual(novo.itens, [{ produtoId: 'p', quantidade: 100, valorUnit: 5.2, unidadeCompra: 'kg', desconto: 0, observacao: null }]);
  const editado = { ...f, observacoes: 'Urgente', frete: '30' };
  assert.deepEqual(payloadCompra(f, editado, true), { observacoes: 'Urgente', frete: 30 });
  assert.deepEqual(payloadCompra(f, editado, false), { observacoes: 'Urgente' }, 'aprovada: valor não vai');
});

test('validação mínima', () => {
  assert.deepEqual(problemas(formVazio()), ['filial', 'fornecedor', 'ao menos um produto']);
});

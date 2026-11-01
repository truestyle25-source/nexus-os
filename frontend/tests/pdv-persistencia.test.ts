import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, destruirBanco } from './helpers-idb';
import { sincronizarCatalogo, resolverBipagem, buscarPorNome } from '../lib/pdv/catalogo';
import { recuperarCarrinho, salvarCarrinho } from '../lib/pdv/cartSession';

const contexto = { empresaId: 'empresa-1', usuarioId: 'operador-1' };

function produto(filialId: string, estoqueFilial: number, atualizadoEm = 1000) {
  return {
    id: 'produto-compartilhado',
    empresaId: contexto.empresaId,
    filialId,
    nome: 'Produto de teste',
    sku: 'SKU-1',
    codigoBarras: '789000000001',
    precoVenda: 12.5,
    precoPromocional: null,
    promocaoInicio: null,
    promocaoFim: null,
    categoriaId: null,
    unidade: 'UN',
    imagem: null,
    ativo: true,
    estoqueFilial,
    atualizadoEm,
  };
}

test('Catálogo IndexedDB mantém o mesmo produto separado por filial e tenant', async () => {
  const banco = await novoBanco('catalogo-multifilial');
  try {
    await sincronizarCatalogo(contexto, 'filial-a', [produto('filial-a', 8)]);
    await sincronizarCatalogo(contexto, 'filial-b', [produto('filial-b', 2)]);

    const a = await resolverBipagem(contexto.empresaId, 'filial-a', '789000000001');
    const b = await resolverBipagem(contexto.empresaId, 'filial-b', '789000000001');
    assert.equal(a?.estoqueFilial, 8);
    assert.equal(b?.estoqueFilial, 2);
    assert.equal(await banco.catalogoProdutos.count(), 2);

    await sincronizarCatalogo({ empresaId: 'empresa-2', usuarioId: 'operador-2' }, 'filial-c', [
      { ...produto('filial-c', 99), empresaId: 'empresa-1' },
    ]);
    assert.equal(await banco.catalogoProdutos.count(), 2, 'registro de outra empresa deve ser rejeitado');
  } finally { await destruirBanco(banco); }
});

test('Catálogo aplica atualização incremental sem reverter preço mais novo', async () => {
  const banco = await novoBanco('catalogo-incremental');
  try {
    await sincronizarCatalogo(contexto, 'filial-a', [produto('filial-a', 4, 2000)]);
    await sincronizarCatalogo(contexto, 'filial-a', [{ ...produto('filial-a', 1, 1000), precoVenda: 1 }]);
    const resultado = await buscarPorNome(contexto.empresaId, 'filial-a', 'Produto');
    assert.equal(resultado[0]?.precoVenda, 12.5);
  } finally { await destruirBanco(banco); }
});

test('Carrinho local é recuperável somente no escopo empresa/operador correto', async () => {
  const banco = await novoBanco('cart-scope');
  try {
    await salvarCarrinho({
      ...contexto,
      filialId: 'filial-a',
      forma: 'DINHEIRO',
      descontoGeral: 0,
      valorRecebido: '20',
      itens: [{ produtoId: 'produto-1', nome: 'Produto', preco: 10, quantidade: 1, desconto: 0 }],
    });
    const recuperado = await recuperarCarrinho(contexto);
    assert.equal(recuperado?.itens[0].produtoId, 'produto-1');
    assert.equal(await recuperarCarrinho({ empresaId: 'empresa-1', usuarioId: 'operador-2' }), null);
    assert.equal(banco.tables.some((tabela) => tabela.name === 'clientes'), false, 'cache local não deve guardar clientes/PII');
  } finally { await destruirBanco(banco); }
});

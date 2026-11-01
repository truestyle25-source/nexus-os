import assert from 'node:assert/strict';
import { test } from 'node:test';
import { novoBanco, destruirBanco } from './helpers-idb';
import {
  limparDadosLocaisSeguro,
  enfileirar,
  marcar,
  listarPendentes,
  contarPorStatus,
  salvarCarrinho,
  recuperarCarrinho,
  sincronizarCatalogo,
  listarCatalogoLocal,
} from '../lib/pdv';
import { db } from '../lib/pdv/db';
import type { ContextoLocal } from '../lib/pdv/tipos';

const contexto: ContextoLocal = {
  empresaId: 'emp-teste',
  usuarioId: 'op-teste',
};
const filialId = 'fil-teste';

test('limparDadosLocaisSeguro: remove cache e confirmadas, preserva pendentes', async () => {
  const banco = await novoBanco('logout-limpeza');
  try {
    // Cache de catálogo (API real: sincronizarCatalogo com escopo empresa/filial).
    await sincronizarCatalogo(contexto, filialId, [{
      id: 'p1',
      empresaId: contexto.empresaId,
      filialId,
      nome: 'Produto 1',
      sku: '001',
      codigoBarras: null,
      precoVenda: 10,
      precoPromocional: null,
      promocaoInicio: null,
      promocaoFim: null,
      categoriaId: null,
      unidade: 'UN',
      imagem: null,
      ativo: true,
      estoqueFilial: 5,
    }]);

    // Working state: carrinho atual (API real: SalvarCarrinhoInput).
    await salvarCarrinho({
      ...contexto,
      filialId,
      clienteId: null,
      forma: 'DINHEIRO',
      descontoGeral: 0,
      valorRecebido: null,
      parcelas: 1,
      itens: [],
    });

    // Operação já confirmada no PostgreSQL -> pode ser removida no logout.
    const confirmada = await enfileirar({ ...contexto, tipo: 'VENDA', payload: { total: 10 }, idempotencyKey: 'key-confirmada' });
    await marcar(confirmada.id, 'CONFIRMADO');

    // Operação PENDENTE e operação em ERRO -> DEVEM sobreviver ao logout.
    await enfileirar({ ...contexto, tipo: 'VENDA', payload: { total: 20 }, idempotencyKey: 'key-pendente-1' });
    const comErro = await enfileirar({ ...contexto, tipo: 'VENDA', payload: { total: 30 }, idempotencyKey: 'key-com-erro-2' });
    await marcar(comErro.id, 'ERRO');

    await limparDadosLocaisSeguro();

    // Catálogo (cache regenerável) removido.
    assert.equal((await listarCatalogoLocal(contexto, filialId)).length, 0, 'catálogo deve ser limpo no logout');

    // Carrinho (working state regenerável) removido.
    assert.equal(await recuperarCarrinho(contexto), null, 'carrinho deve ser limpo no logout');

    // Fila: PENDENTE + ERRO preservadas; CONFIRMADO removido.
    const pendentes = await listarPendentes(contexto);
    assert.equal(pendentes.length, 2, 'pendente e erro devem sobreviver ao logout');
    assert.deepEqual(
      pendentes.map((op) => op.idempotencyKey).sort(),
      ['key-com-erro-2', 'key-pendente-1'],
      'as MESMAS idempotency keys devem sobreviver para reconciliação pós-login',
    );
    const contagem = await contarPorStatus(contexto);
    assert.equal(contagem.CONFIRMADO, 0, 'confirmadas locais devem ser removidas no logout');
    assert.equal(await db().operacoes.count(), 2, 'só as 2 não-confirmadas permanecem');
  } finally {
    await destruirBanco(banco);
  }
});

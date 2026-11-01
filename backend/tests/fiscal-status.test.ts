import assert from 'node:assert/strict';
import test from 'node:test';
import { avaliarStatusFiscal } from '../src/modules/fiscal/fiscal.status.js';

test('status fiscal informa adaptador ausente e nunca habilita emissão', () => {
  const status = avaliarStatusFiscal(
    { cnpj: null, inscricaoEstadual: null, cep: null, endereco: null, cidade: null, estado: null },
    [],
  );

  assert.equal(status.integracaoConfigurada, false);
  assert.equal(status.emissaoHabilitada, false);
  assert.equal(status.provedor, null);
  assert.equal(status.motivoBloqueio, 'ADAPTADOR_FISCAL_NAO_IMPLEMENTADO');
  assert.deepEqual(status.cadastro.empresa.camposCadastraisAusentes, [
    'CNPJ', 'inscrição estadual', 'CEP', 'endereço', 'cidade', 'UF',
  ]);
});

test('diagnóstico reconhece dados existentes e lista pendências por filial', () => {
  const status = avaliarStatusFiscal(
    { cnpj: '123', inscricaoEstadual: 'ISENTO', cep: '01000-000', endereco: 'Rua A', cidade: 'São Paulo', estado: 'SP' },
    [{ id: 'filial-1', nome: 'Loja Centro', cnpj: null, cidade: 'São Paulo', estado: 'SP' }],
  );

  assert.deepEqual(status.cadastro.empresa.camposCadastraisAusentes, []);
  assert.deepEqual(status.cadastro.filiais[0], {
    id: 'filial-1', nome: 'Loja Centro', camposCadastraisAusentes: ['CNPJ'],
  });
  assert.equal(status.emissaoHabilitada, false);
});

// Ficha do fornecedor: validação de CNPJ/CPF e máscaras (mesma regra do servidor), obrigatórios
// e corpo da API enviando só o que mudou (dados bancários nunca vão sem permissão).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjValido, cpfValido, mascararCep, mascararDocumento } from '../lib/fornecedor-ficha';
import { contatoPrincipalAlterado, faltando, formVazio, payloadFicha } from '../components/fornecedor/formulario';

test('CNPJ e CPF: dígitos verificadores e sequências repetidas', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('11.111.111/1111-11'), false);
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
});

test('máscaras de documento e CEP', () => {
  assert.equal(mascararDocumento('11222333000181', 'JURIDICA'), '11.222.333/0001-81');
  assert.equal(mascararDocumento('52998224725', 'FISICA'), '529.982.247-25');
  assert.equal(mascararDocumento('112223330001819999', 'JURIDICA'), '11.222.333/0001-81', 'corta excesso');
  assert.equal(mascararCep('01310100'), '01310-100');
});

test('obrigatórios mínimos e aba de cada um', () => {
  const f = formVazio();
  const lista = faltando(f, false).map((x) => `${x.campo}@${x.aba}`);
  assert.deepEqual(lista, ['CNPJ@cabecalho', 'Razão social@cabecalho', 'CEP@endereco', 'Cidade@endereco', 'UF@endereco', 'Contato@dados']);
  Object.assign(f, { documento: '11.222.333/0001-81', nome: 'Alfa', cep: '01310-100', cidade: 'São Paulo', uf: 'SP' });
  assert.deepEqual(faltando(f, true), []);
});

test('corpo da API: cadastro envia o preenchido; edição envia só o que mudou', () => {
  const novo = { ...formVazio(), documento: '11.222.333/0001-81', nome: 'Alfa', cep: '01310-100', cidade: 'São Paulo', uf: 'sp', limiteCredito: '1.500,50', prazoEntregaDias: '5', cpNome: 'Mariana' };
  const corpo = payloadFicha(null, novo, true);
  assert.equal(corpo.documento, '11222333000181');
  assert.equal(corpo.cep, '01310100');
  assert.equal(corpo.uf, 'SP');
  assert.equal(corpo.limiteCredito, 1500.5);
  assert.equal(corpo.prazoEntregaDias, 5);
  assert.equal('banco' in corpo, false, 'campo vazio não vai no cadastro');
  assert.equal(contatoPrincipalAlterado(null, novo)?.nome, 'Mariana');

  const editado = { ...novo, nomeFantasia: 'Alfa Ltda', banco: 'Banco X' };
  assert.deepEqual(payloadFicha(novo, editado, true), { nomeFantasia: 'Alfa Ltda', banco: 'Banco X' });
  assert.deepEqual(payloadFicha(novo, editado, false), { nomeFantasia: 'Alfa Ltda' }, 'sem permissão, banco não vai');
  assert.equal(contatoPrincipalAlterado(novo, editado), null, 'contato sem mudança');
});

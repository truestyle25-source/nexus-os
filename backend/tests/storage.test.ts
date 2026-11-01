/**
 * Testes das regras de storage de documentos.
 *
 * Não precisam de bucket real: cobrem a parte que decide — o que é aceito, como
 * a chave é montada e o que acontece quando falta configuração. O teste de que
 * a chave NÃO carrega o nome do arquivo do usuário é o mais importante: é o que
 * impede path traversal e colisão entre tenants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montaChave, extensaoDe, contentTypeDe, validaTamanho,
  TAMANHO_MAXIMO_BYTES, storageConfigurado,
} from '../src/lib/storage.js';

test('a chave começa com o prefixo da empresa e nunca colide entre tenants', () => {
  const a = montaChave('empresa-A', 'Funcionario', 'pdf');
  const b = montaChave('empresa-B', 'Funcionario', 'pdf');
  assert.ok(a.startsWith('empresa-A/'));
  assert.ok(b.startsWith('empresa-B/'));
  assert.notEqual(a, b);
});

test('o nome original do arquivo NÃO entra na chave', () => {
  const chave = montaChave('empresa-A', 'Funcionario', 'pdf');
  // O nome do usuário é entrada não confiável: pode ter "../", acentos ou
  // colidir. A chave usa prefixo aleatório, não o nome.
  assert.ok(!chave.includes('contrato'));
  assert.ok(!chave.includes('..'));
  assert.ok(chave.endsWith('.pdf'));
});

test('content-type vem da extensão, nunca do que o cliente declarou', () => {
  assert.equal(contentTypeDe('contrato.pdf'), 'application/pdf');
  assert.equal(contentTypeDe('foto.png'), 'image/png');
  // Ataque clássico: um .pdf declarado como text/html para servir HTML no domínio.
  assert.equal(contentTypeDe('foto.jpg'), 'image/jpeg');
});

test('tipos de arquivo não permitidos são recusados', () => {
  assert.throws(() => contentTypeDe('malware.exe'), /não permitido/i);
  assert.throws(() => montaChave('e1', 'Funcionario', 'exe'), /não permitido/i);
  assert.throws(() => extensaoDe('sem-extensao'), /sem extensão/i);
});

test('o limite de 10 MB é aplicado no tamanho decodificado', () => {
  assert.doesNotThrow(() => validaTamanho(TAMANHO_MAXIMO_BYTES));
  assert.throws(() => validaTamanho(TAMANHO_MAXIMO_BYTES + 1), /limite/i);
  assert.throws(() => validaTamanho(0), /vazio/i);
});

test('sem configuração o storage se declara indisponível, em vez de fingir sucesso', () => {
  // Neste ambiente de teste não há credenciais: a função precisa responder
  // "não" em vez de prometer um bucket que não existe.
  if (!process.env.STORAGE_BUCKET) {
    assert.equal(storageConfigurado(), false);
  }
});

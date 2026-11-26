import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podeAcessar } from '../lib/acessoMenu';

const operador = ['dashboard:visualizar', 'pdv:visualizar', 'pdv:criar', 'clientes:visualizar', 'produtos:visualizar', 'estoque:visualizar', 'ia:visualizar'];

test('menu: operador não vê RH, Radar, Financeiro, DRE nem Usuários', () => {
  for (const rota of ['/rh', '/radar-organizacional', '/financeiro', '/fluxo', '/dre', '/usuarios', '/compras', '/plataforma']) {
    assert.equal(podeAcessar(rota, operador), false, rota);
  }
  for (const rota of ['/', '/pdv', '/clientes', '/produtos/123', '/configuracoes']) {
    assert.equal(podeAcessar(rota, operador), true, rota);
  }
});

test('menu: Financeiro / RH vê RH e Radar', () => {
  const fin = ['rh:visualizar', 'financeiro:visualizar', 'ponto:visualizar'];
  assert.equal(podeAcessar('/rh', fin), true);
  assert.equal(podeAcessar('/radar-organizacional', fin), true);
  assert.equal(podeAcessar('/pdv', fin), false);
});

test('menu: enquanto carrega (null) mostra tudo — o servidor continua barrando', () => {
  assert.equal(podeAcessar('/rh', null), true);
});

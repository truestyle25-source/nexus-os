/**
 * NEXUS CLUB (Fase 4) — regras do lado da tela e separação das sessões.
 * As mesmas regras são conferidas de novo no servidor; aqui garantimos que a tela avisa
 * antes e que a sessão do cliente nunca usa a chave nem o cookie do painel da empresa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as club from '../lib/club/api';

class ArmazenamentoFalso {
  dados = new Map<string, string>();
  getItem(k: string) { return this.dados.has(k) ? this.dados.get(k)! : null; }
  setItem(k: string, v: string) { this.dados.set(k, String(v)); }
  removeItem(k: string) { this.dados.delete(k); }
}
const ls = new ArmazenamentoFalso();
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = ls;
let cookie = '';
(globalThis as any).document = { get cookie() { return cookie; }, set cookie(v: string) { cookie = v; } };


test('CPF: dígitos verificadores e máscara', () => {
  assert.equal(club.cpfValido('529.982.247-25'), true);
  assert.equal(club.cpfValido('52998224725'), true);
  assert.equal(club.cpfValido('529.982.247-24'), false);
  assert.equal(club.cpfValido('111.111.111-11'), false);
  assert.equal(club.cpfValido('123'), false);
  assert.equal(club.mascaraCpf('52998224725'), '529.982.247-25');
  assert.equal(club.mascaraCpf('5299'), '529.9');
  assert.equal(club.mascaraCpf('529982247259999'), '529.982.247-25', 'corta no 11º dígito');
});

test('senha: mesma regra do servidor (8 a 72, letras e números)', () => {
  assert.match(club.problemaSenha('Ab1') ?? '', /8 caracteres/);
  assert.match(club.problemaSenha('abcdefgh') ?? '', /letras e números/);
  assert.match(club.problemaSenha('12345678') ?? '', /letras e números/);
  assert.match(club.problemaSenha(`a1${'x'.repeat(71)}`) ?? '', /72/);
  assert.equal(club.problemaSenha('SenhaForte123'), null);
});

test('sessão do cliente separada da sessão da empresa', () => {
  ls.setItem('nexus_token', 'cracha-da-empresa');
  club.salvarSessaoClube('cracha-do-cliente', { id: 'c1', nome: 'Maria', email: 'm@x.com' });
  assert.equal(club.tokenClube(), 'cracha-do-cliente');
  assert.equal(ls.getItem('nexus_token'), 'cracha-da-empresa', 'não toca no crachá da empresa');
  assert.equal(cookie, '', 'não cria o cookie nexus_auth do painel');
  assert.equal(club.contaClube()?.nome, 'Maria');
  club.limparSessaoClube();
  assert.equal(club.tokenClube(), null);
  assert.equal(ls.getItem('nexus_token'), 'cracha-da-empresa', 'sair do clube não desloga o painel');
});

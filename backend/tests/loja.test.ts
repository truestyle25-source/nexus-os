/**
 * Testa a Loja de Recompensas (Ciclo 4).
 *
 * O foco é a CONTA DE SALDO. Um resgate que debita pontos errado não erra por
 * alguns reais: faz a empresa prometer uma recompensa que o saldo não cobre, e
 * a confiança no placar inteiro. Por isso os casos aqui são sobre anulação,
 * cancelamento e ordem de contagem — não sobre a aritmética trivial.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saldoDePontos, avaliarElegibilidade, podeTransicionar, estoqueVisivel,
  apareceNaVitrine, CONSOME_PONTOS,
  CATEGORIAS_RECOMPENSA, ROTULO_CATEGORIA, ROTULO_STATUS, STATUS_RESGATE,
} from '../src/modules/rh/loja.ts';

// ===========================================================================
//  Saldo
// ===========================================================================

test('saldo: soma os registros ATIVOS', () => {
  assert.equal(saldoDePontos([{ pontos: 500, status: 'ATIVO' }, { pontos: 700, status: 'ATIVO' }], []), 1200);
});

test('saldo: registro ANULADO deixa de contar', () => {
  // Anular é o gestor corrigindo um lançamento errado. Se o anulado contasse,
  // o saldo ficaria maior do que a empresa realmente concessionou.
  assert.equal(saldoDePontos([{ pontos: 500, status: 'ATIVO' }, { pontos: 900, status: 'ANULADO' }], []), 500);
});

test('saldo: resgate SOLICITADO NAO consome pontos (so reserva estoque)', () => {
  // Este é o ponto do fluxo em duas pessoas: pedir não debita, aprovar debita.
  const registros = [{ pontos: 1200, status: 'ATIVO' }];
  assert.equal(saldoDePontos(registros, [{ pontosUtilizados: 500, status: 'SOLICITADO' }]), 1200, 'ainda nao consumiu');
  assert.equal(saldoDePontos(registros, [{ pontosUtilizados: 500, status: 'APROVADO' }]), 700, 'aprovado consumiu');
});

test('saldo: REJEITADO e CANCELADO devolvem os pontos', () => {
  const registros = [{ pontos: 1200, status: 'ATIVO' }];
  assert.equal(saldoDePontos(registros, [{ pontosUtilizados: 500, status: 'REJEITADO' }]), 1200);
  assert.equal(saldoDePontos(registros, [{ pontosUtilizados: 500, status: 'CANCELADO' }]), 1200);
});

test('saldo: ENTREGUE continua consumindo', () => {
  assert.equal(saldoDePontos([{ pontos: 1200, status: 'ATIVO' }], [{ pontosUtilizados: 500, status: 'ENTREGUE' }]), 700);
});

test('saldo: NUNCA fica negativo', () => {
  // Se alguém anular os pontos DEPOIS do resgate, a conta poderia virar
  // negativa. A tela mostrando "-300" seria mentira: significaria que a pessoa
  // deve pontos.
  assert.equal(saldoDePontos([{ pontos: 200, status: 'ATIVO' }], [{ pontosUtilizados: 500, status: 'APROVADO' }]), 0);
});

test('saldo: sem registro nenhum devolve 0, nao null', () => {
  assert.equal(saldoDePontos([], []), 0);
});

test('saldo: conjunto grande bate com a soma direta', () => {
  const registros = Array.from({ length: 50 }, (_, i) => ({
    pontos: i % 7 === 0 ? 0 : 20, status: i % 11 === 0 ? 'ANULADO' : 'ATIVO',
  }));
  const esperado = registros.filter((r) => r.status === 'ATIVO').reduce((a, r) => a + r.pontos, 0);
  assert.equal(saldoDePontos(registros, []), esperado);
});

test('CONSOME_PONTOS: so APROVADO e ENTREGUE debitam', () => {
  assert.equal(CONSOME_PONTOS.has('APROVADO'), true);
  assert.equal(CONSOME_PONTOS.has('ENTREGUE'), true);
  for (const s of ['SOLICITADO', 'REJEITADO', 'CANCELADO']) {
    assert.equal(CONSOME_PONTOS.has(s), false, `${s} nao deve consumir pontos`);
  }
});

// ===========================================================================
//  Elegibilidade
// ===========================================================================

test('elegibilidade: com saldo, estoque e ativa, pode resgatar', () => {
  const r = avaliarElegibilidade({ ativo: true, quantidadeDisponivel: 3, custoPontos: 500, saldo: 1200 });
  assert.equal(r.pode, true);
  assert.equal(r.motivo, null);
});

test('elegibilidade: o motivo vem na ordem que o gestor precisa ouvir', () => {
  // Recompensa inativa + estoque 0 + saldo 0: a mensagem tem que ser sobre a
  // recompensa, nao "pontos insuficientes" — senao o gestor procura no lugar errado.
  const r = avaliarElegibilidade({ ativo: false, quantidadeDisponivel: 0, custoPontos: 500, saldo: 0 });
  assert.equal(r.motivo, 'RECOMPENSA_INATIVA');
  const e = avaliarElegibilidade({ ativo: true, quantidadeDisponivel: 0, custoPontos: 500, saldo: 0 });
  assert.equal(e.motivo, 'SEM_ESTOQUE');
  const p = avaliarElegibilidade({ ativo: true, quantidadeDisponivel: 5, custoPontos: 500, saldo: 100 });
  assert.equal(p.motivo, 'PONTOS_INSUFICIENTES');
  assert.match(p.mensagem ?? '', /100/);
  assert.match(p.mensagem ?? '', /500/);
});

test('elegibilidade: um resgate em andamento barra o segundo', () => {
  const r = avaliarElegibilidade({
    ativo: true, quantidadeDisponivel: 5, custoPontos: 500, saldo: 5000, jaResgatouAtivo: true,
  });
  assert.equal(r.pode, false);
  assert.equal(r.motivo, 'JA_RESGATOU');
});

test('elegibilidade: saldo exatamente igual ao custo pode resgatar', () => {
  // ">= custo" e nao "> custo": com 500 pontos, um item de 500 e possivel.
  const r = avaliarElegibilidade({ ativo: true, quantidadeDisponivel: 1, custoPontos: 500, saldo: 500 });
  assert.equal(r.pode, true);
});

// ===========================================================================
//  Transições de status
// ===========================================================================

test('transições: o caminho feliz e solicitado → aprovado → entregue', () => {
  assert.equal(podeTransicionar('SOLICITADO', 'APROVADO'), true);
  assert.equal(podeTransicionar('APROVADO', 'ENTREGUE'), true);
});

test('transições: nao se entrega o que ninguem aprovou', () => {
  assert.equal(podeTransicionar('SOLICITADO', 'ENTREGUE'), false);
});

test('transições: estados finais nao voltam', () => {
  for (const final of ['ENTREGUE', 'REJEITADO', 'CANCELADO'] as const) {
    for (const destino of STATUS_RESGATE) {
      if (destino === final) continue;
      assert.equal(podeTransicionar(final, destino), false, `${final} nao volta para ${destino}`);
    }
  }
});

test('transições: um resgate nao e aprovado duas vezes', () => {
  assert.equal(podeTransicionar('APROVADO', 'APROVADO'), false);
});

// ===========================================================================
//  Vitrine
// ===========================================================================

test('vitrine: inativa ou esgotada some da vitrine', () => {
  assert.equal(apareceNaVitrine(true, 3), true);
  assert.equal(apareceNaVitrine(false, 3), false, 'inativa some mesmo com estoque');
  assert.equal(apareceNaVitrine(true, 0), false, 'esgotada some');
  assert.equal(apareceNaVitrine(true, -2), false, 'estoque negativo nao vira vitrine');
});

test('estoque: nunca aparece negativo na tela', () => {
  assert.equal(estoqueVisivel(-5), 0);
  assert.equal(estoqueVisivel(0), 0);
  assert.equal(estoqueVisivel(7), 7);
});

test('catálogos: todo status e categoria tem rotulo legivel', () => {
  for (const s of STATUS_RESGATE) assert.ok(ROTULO_STATUS[s], `falta rotulo de ${s}`);
  for (const c of CATEGORIAS_RECOMPENSA) {
    assert.ok(ROTULO_CATEGORIA[c], `falta rotulo de ${c}`);
    assert.notEqual(ROTULO_CATEGORIA[c], c, 'rotulo nao pode ser o proprio codigo');
  }
});

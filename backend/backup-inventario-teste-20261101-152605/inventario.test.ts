import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aceitaContagem, podeMudarStatus, classificarDivergencia,
  resumirSessao, validarContagem, validarAbertura,
} from '../src/modules/rh/inventario.js';

/**
 * Ciclo 6 — Sessão de Inventário.
 *
 * O teste que mais importa aqui é `resumirSessao: NULL não é zero`. Uma folha de
 * papel mostra espaço em branco e "0" quase do mesmo jeito, e confundir os dois
 * faz o gestor acreditar que contou um item que nunca contou.
 */

// ═══ STATUS ═════════════════════════════════════════════════════════════
test('so uma sessao ABERTA aceita contagem', () => {
  assert.equal(aceitaContagem('ABERTA'), true);
  assert.equal(aceitaContagem('CONCLUIDA'), false);
  assert.equal(aceitaContagem('CANCELADA'), false);
});

test('sessao concluida ou cancelada nao volta a abrir', () => {
  assert.deepEqual(podeMudarStatus('ABERTA', 'CONCLUIDA'), true);
  assert.deepEqual(podeMudarStatus('ABERTA', 'CANCELADA'), true);
  // Reabrir mudaria o historico depois que alguem ja usou os numeros.
  assert.equal(podeMudarStatus('CONCLUIDA', 'ABERTA'), false);
  assert.equal(podeMudarStatus('CANCELADA', 'ABERTA'), false);
  assert.equal(podeMudarStatus('CONCLUIDA', 'CANCELADA'), false);
});

test('status desconhecido nao transiciona', () => {
  assert.equal(podeMudarStatus('INVENTADO', 'CONCLUIDA'), false);
});

// ═══ DIVERGÊNCIA ════════════════════════════════════════════════════════
test('divergencia: igual bateu, acima sobrou, abaixo faltou', () => {
  assert.equal(classificarDivergencia(10, 10), 'BATEU');
  assert.equal(classificarDivergencia(10, 12), 'SOBROU');
  assert.equal(classificarDivergencia(10, 8), 'FALTOU');
});

test('divergencia: nao contado nao e divergencia', () => {
  // O ponto do ciclo: um item em branco é "ainda nao contei", e nao "contei
  // zero". Devolver null mantem os dois separados ate o fim.
  assert.equal(classificarDivergencia(10, null), null);
  assert.equal(classificarDivergencia(0, null), null);
});

test('divergencia: contar zero quando o sistema tem 10 e FALTOU', () => {
  assert.equal(classificarDivergencia(10, 0), 'FALTOU');
});

// ═══ RESUMO ══════════════════════════════════════════════════════════════
test('resumo: conta total, contados, pendentes e os tres desfechos', () => {
  const r = resumirSessao([
    { quantidadeSistema: 10, quantidadeContada: 10 }, // BATEU
    { quantidadeSistema: 5, quantidadeContada: 8 },  // SOBROU
    { quantidadeSistema: 4, quantidadeContada: 2 },  // FALTOU
    { quantidadeSistema: 7, quantidadeContada: null }, // pendente
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.contados, 3);
  assert.equal(r.pendentes, 1);
  assert.equal(r.bateram, 1);
  assert.equal(r.sobraram, 1);
  assert.equal(r.faltaram, 1);
});

test('resumo: folha com pendencia nao fecha', () => {
  const r = resumirSessao([
    { quantidadeSistema: 10, quantidadeContada: 10 },
    { quantidadeSistema: 5, quantidadeContada: null },
  ]);
  assert.equal(r.fechavel, false);
});

test('resumo: folha completa fecha', () => {
  const r = resumirSessao([
    { quantidadeSistema: 10, quantidadeContada: 12 },
    { quantidadeSistema: 5, quantidadeContada: 5 },
  ]);
  assert.equal(r.fechavel, true);
});

test('resumo: folha vazia nao fecha', () => {
  // Marcar como CONCLUIDA uma folha sem itens criaria um registro de
  // inventario que nao existe.
  assert.equal(resumirSessao([]).fechavel, false);
  assert.equal(resumirSessao([]).pendentes, 0);
});

// ═══ VALIDAÇÃO DA CONTAGEM ═══════════════════════════════════════════════
test('validarContagem: vazio significa "ainda nao contei"', () => {
  assert.deepEqual(validarContagem(''), { valor: null });
  assert.deepEqual(validarContagem(null), { valor: null });
  assert.deepEqual(validarContagem(undefined), { valor: null });
});

test('validarContagem: zero e um zero legitimo', () => {
  // Difere de null: aqui a pessoa contou e nao havia nada.
  assert.deepEqual(validarContagem(0), { valor: 0 });
  assert.deepEqual(validarContagem('0'), { valor: 0 });
});

test('validarContagem: negativo e recusado', () => {
  // "-3 caixas" passaria batido no papel de contagem.
  const r = validarContagem(-3);
  assert.ok('erro' in r);
});

test('validarContagem: fracionario e recusado', () => {
  const r = validarContagem(2.5);
  assert.ok('erro' in r);
});

test('validarContagem: texto nao numerico e recusado', () => {
  const r = validarContagem('dez');
  assert.ok('erro' in r);
});

test('validarContagem: inteiro valido passa', () => {
  assert.deepEqual(validarContagem(42), { valor: 42 });
  assert.deepEqual(validarContagem('42'), { valor: 42 });
});

// ═══ ABERTURA ════════════════════════════════════════════════════════════
test('abertura: nome e filial sao obrigatorios', () => {
  const r = validarAbertura({ nome: 'a', filialId: '', itensNaFilial: 10, sessoesAbertasNaFilial: 0 });
  assert.equal(r.length, 2);
});

test('abertura: filial sem estoque nao abre folha', () => {
  const r = validarAbertura({ nome: 'Inventario', filialId: 'f1', itensNaFilial: 0, sessoesAbertasNaFilial: 0 });
  assert.equal(r.length, 1);
  assert.match(r[0], /nenhum item/i);
});

test('abertura: uma sessao aberta por filial, e para retomar a existente', () => {
  // Duas folhas abertas na mesma filial seriam duas medicoes incompativeis do
  // mesmo deposito — e o estoque congelado ficaria congelado duas vezes.
  const r = validarAbertura({ nome: 'Inventario', filialId: 'f1', itensNaFilial: 10, sessoesAbertasNaFilial: 1 });
  assert.equal(r.length, 1);
  assert.match(r[0], /retome/i);
});

test('abertura: sessao fechada nao bloqueia a proxima', () => {
  const r = validarAbertura({ nome: 'Inventario', filialId: 'f1', itensNaFilial: 10, sessoesAbertasNaFilial: 0 });
  assert.deepEqual(r, []);
});

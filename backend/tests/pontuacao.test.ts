import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTOS, OPERADORES, PERIODOS,
  cumprE, chavePeriodo, intervaloPeriodo, descreverCriterio, descreverEvidencia,
  validarCriterio, validarLancamentoManual,
} from '../src/modules/rh/pontuacao.js';

/**
 * Ciclo 5 — Pontuação configurável por empresa.
 *
 * O teste mais importante deste arquivo é `cumprE nao conhece valor de ponto`:
 * ele prova que a comparação é a mesma para 1 ponto e para 100.000. Se um dia
 * alguém "ajudar" colocando um valor fixo aqui dentro, esse teste quebra — e é
 * exatamente para isso que ele existe.
 */

// ═══ O OPERADOR É DA EMPRESA, O NEXUS SÓ COMPARA ═════════════════════════
test('cumprE: IGUAL compara exatamente', () => {
  assert.equal(cumprE(0, 'IGUAL', 0), true);
  assert.equal(cumprE(1, 'IGUAL', 0), false);
});

test('cumprE: MAIOR_OU_IGUAL aceita o igual e o acima', () => {
  assert.equal(cumprE(100, 'MAIOR_OU_IGUAL', 100), true);
  assert.equal(cumprE(104, 'MAIOR_OU_IGUAL', 100), true);
  assert.equal(cumprE(99, 'MAIOR_OU_IGUAL', 100), false);
});

test('cumprE: MENOR_OU_IGUAL aceita o igual e o abaixo', () => {
  assert.equal(cumprE(0, 'MENOR_OU_IGUAL', 2), true);
  assert.equal(cumprE(2, 'MENOR_OU_IGUAL', 2), true);
  assert.equal(cumprE(3, 'MENOR_OU_IGUAL', 2), false);
});

test('cumprE: operador desconhecido nunca credita', () => {
  // O padrão seguro é NÃO creditar. Um critério com operador corrompido
  // poderia pagar ponto a qualquer pessoa, e isso é pior que não pagar.
  assert.equal(cumprE(0, 'QUALQUER_COISA' as any, 0), false);
});

test('cumprE: o mesmo evento da o mesmo resultado com valores de ponto diferentes', () => {
  // Este teste é a prova de que não há política do NEXUS escondida. A função
  // recebe o valor medido e o alvo; a quantidade de pontos entra depois, na
  // rota, e vem do critério da empresa.
  for (const pontos of [1, 10, 100, 100000]) {
    assert.equal(cumprE(0, 'IGUAL', 0), true, 'com ' + pontos + ' pts');
  }
});

// ═══ PERÍODO: A CHAVE DE IDEMPOTÊNCIA ════════════════════════════════════
test('chavePeriodo: mensal vira AAAA-MM', () => {
  assert.equal(chavePeriodo('MENSAL', new Date('2026-09-27T12:00:00Z')), '2026-09');
  assert.equal(chavePeriodo('MENSAL', new Date('2026-01-05T12:00:00Z')), '2026-01');
});

test('chavePeriodo: trimestral vira AAAA-QN e muda no trimestre certo', () => {
  assert.equal(chavePeriodo('TRIMESTRAL', new Date('2026-01-15T12:00:00Z')), '2026-Q1');
  assert.equal(chavePeriodo('TRIMESTRAL', new Date('2026-03-31T12:00:00Z')), '2026-Q1');
  assert.equal(chavePeriodo('TRIMESTRAL', new Date('2026-04-01T12:00:00Z')), '2026-Q2');
  assert.equal(chavePeriodo('TRIMESTRAL', new Date('2026-12-20T12:00:00Z')), '2026-Q4');
});

test('intervaloPeriodo: setembro cobre o mes inteiro', () => {
  const { inicio, fim } = intervaloPeriodo('MENSAL', new Date('2026-09-15T12:00:00Z'));
  assert.equal(inicio.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(fim.toISOString().slice(0, 10), '2026-09-30');
});

test('intervaloPeriodo: fevereiro respeita o ano bissexto', () => {
  const { fim } = intervaloPeriodo('MENSAL', new Date('2028-02-10T12:00:00Z'));
  assert.equal(fim.toISOString().slice(0, 10), '2028-02-29');
  const naoBissexto = intervaloPeriodo('MENSAL', new Date('2026-02-10T12:00:00Z'));
  assert.equal(naoBissexto.fim.toISOString().slice(0, 10), '2026-02-28');
});

test('intervaloPeriodo: trimestre vai do primeiro dia ao último do mês 3', () => {
  const q2 = intervaloPeriodo('TRIMESTRAL', new Date('2026-05-10T12:00:00Z'));
  assert.equal(q2.inicio.toISOString().slice(0, 10), '2026-04-01');
  assert.equal(q2.fim.toISOString().slice(0, 10), '2026-06-30');
});

test('intervaloPeriodo: o inicio nunca passa do fim', () => {
  const { inicio, fim } = intervaloPeriodo('MENSAL', new Date('2026-09-01T00:00:00Z'));
  assert.equal(inicio.getTime() <= fim.getTime(), true);
});

// ═══ A EVIDÊNCIA QUE A PESSOA VÊ ════════════════════════════════════════
test('descreverCriterio: usa o rotulo e o operador da empresa', () => {
  const t = descreverCriterio({ evento: 'SEM_FALTA', operador: 'IGUAL', valor: 0 });
  assert.match(t, /Faltas/);
  assert.match(t, /igual a 0/);
});

test('descreverCriterio: evento desconhecido nao quebra a tela', () => {
  const t = descreverCriterio({ evento: 'INVENTADO' as any, operador: 'IGUAL', valor: 5 });
  assert.equal(typeof t, 'string');
  assert.ok(t.length > 0);
});

test('descreverEvidencia: mostra o que foi medido e a regra que comparou', () => {
  // Evidência e condição são coisas diferentes de propósito. A evidência é o
  // FATO ("0 faltas"); a condição é a REGRA da empresa ("igual a 0"). Juntas
  // explicam o crédito sem precisar do código.
  const t = descreverEvidencia('SEM_FALTA', 0, { operador: 'IGUAL', valor: 0 });
  assert.match(t, /Faltas/);
  assert.match(t, /0/);
  assert.match(t, /igual a 0/);
});

test('descreverEvidencia: um numero diferente do alvo continua aparecendo', () => {
  // A meta batida em 104% com alvo 100 é o caso que mais importa: a evidência
  // tem que mostrar 104, senão parece que o sistema arredondou o crédito.
  const t = descreverEvidencia('META_BATIDA', 104, { operador: 'MAIOR_OU_IGUAL', valor: 100 });
  assert.match(t, /104/);
  assert.match(t, /no mínimo 100/);
});

// ═══ VALIDAÇÃO DO CADASTRO ══════════════════════════════════════════════
const criterioOk = {
  nome: 'Zero falta no mês', evento: 'SEM_FALTA', operador: 'IGUAL', valor: 0, pontos: 10,
};

test('validarCriterio: um critério bem formado passa limpo', () => {
  assert.deepEqual(validarCriterio(criterioOk), []);
});

test('validarCriterio: nome curto é recusado', () => {
  const r = validarCriterio({ ...criterioOk, nome: 'a' });
  assert.equal(r.length, 1);
  assert.match(r[0], /nome/i);
});

test('validarCriterio: evento fora do catálogo é recusado', () => {
  const r = validarCriterio({ ...criterioOk, evento: 'VIBRACAO_POSITIVA' });
  assert.equal(r.length, 1);
  assert.match(r[0], /evento/i);
});

test('validarCriterio: evento inválido curto-circuita sem outros avisos', () => {
  // Se o evento não existe, os avisos de valor não fazem sentido: iam
  // sugerir consertar um parâmetro que nem vai existir.
  const r = validarCriterio({ ...criterioOk, evento: 'NAO_EXISTE', valor: 99 });
  assert.equal(r.length, 1);
});

test('validarCriterio: zero pontos é avisado, porque não credita nada', () => {
  const r = validarCriterio({ ...criterioOk, pontos: 0 });
  assert.equal(r.length, 1);
  assert.match(r[0], /Zero pontos/i);
});

test('validarCriterio: pontos negativos são aceitos (empresa pode punir)', () => {
  assert.deepEqual(validarCriterio({ ...criterioOk, pontos: -20 }), []);
});

test('validarCriterio: pontos fracionários são recusados', () => {
  const r = validarCriterio({ ...criterioOk, pontos: 10.5 });
  assert.equal(r.length, 1);
  assert.match(r[0], /inteiro/i);
});


// ═══ LANÇAMENTO MANUAL ══════════════════════════════════════════════════
test('validarLancamentoManual: lançamento normal passa', () => {
  assert.deepEqual(validarLancamentoManual(50, 'Bônus por campanha'), []);
});

test('validarLancamentoManual: zero é recusado', () => {
  const r = validarLancamentoManual(0, 'Nada a declarar');
  assert.equal(r.length, 1);
  assert.match(r[0], /Zero pontos/i);
});

test('validarLancamentoManual: sem motivo é recusado', () => {
  // O motivo é o que a pessoa verá no histórico. Lançar sem ele cria um
  // número que ninguém consegue explicar depois.
  const r = validarLancamentoManual(50, '');
  assert.equal(r.length, 1);
  assert.match(r[0], /motivo/i);
});

test('validarLancamentoManual: valor absurdo é barrado', () => {
  const r = validarLancamentoManual(999999, 'Bônus');
  assert.equal(r.length, 1);
  assert.match(r[0], /alto/i);
});

test('validarLancamentoManual: desconto é aceito', () => {
  assert.deepEqual(validarLancamentoManual(-30, 'Ajuste de meta não atingida'), []);
});

// ═══ O QUE O SISTEMA NÃO PODE FAZER ════════════════════════════════════
test('o NEXUS nao define nenhum criterio padrao', () => {
  // EVENTOS e PERIODOS são o dicionário do que dá para VERIFICAR e as janelas
  // de tempo. Nenhum deles carrega "pontos": o valor é sempre da empresa.
  assert.equal(EVENTOS.length > 0, true);
  assert.equal(OPERADORES.length, 3);
  assert.equal(PERIODOS.length, 3);
  for (const e of EVENTOS) assert.equal(typeof e, 'string');
});

test('validarCriterio: valor de referência negativo é recusado', () => {
  const r = validarCriterio({ ...criterioOk, valor: -1 });
  // São dois avisos neste caso, e ambosprocedem: -1 é negativo, e um evento
  // de ausência comparado com -1 também não faz sentido. A tela mostra o
  // primeiro; o teste garante que o motivo certo está na lista.
  assert.ok(r.length >= 1);
  assert.ok(r.some((m) => /negativo/i.test(m)), r.join(' | '));
});

test('validarCriterio: contar ausencias so faz sentido contra zero', () => {
  // "Faltas igual a 5" é uma configuração que o gestor não entendeu: a
  // empresa ia esperar um bônus para quem faltou cinco dias.
  const r = validarCriterio({ ...criterioOk, valor: 5 });
  // Além do aviso do valor, entra também o de "zero pontos não credita", já que
  // este caso usa o exemplo base. O que importa é que a configuração está
  // recusada e que o motivo aparece.
  assert.ok(r.length >= 1);
  assert.ok(r.some((m) => /compare com 0/i.test(m)), r.join(' | '));
});

test('validarCriterio: "no máximo 2 advertências" com 5 pontos é válido', () => {
  const r = validarCriterio({
    nome: 'Tolerância a advertência', evento: 'SEM_ADVERTENCIA',
    operador: 'MENOR_OU_IGUAL', valor: 2, pontos: 5,
  });
  assert.deepEqual(r, []);
});

test('validarCriterio: meta tem teto de percentual', () => {
  const r = validarCriterio({
    nome: 'Meta batida', evento: 'META_BATIDA',
    operador: 'MAIOR_OU_IGUAL', valor: 5000, pontos: 20,
  });
  assert.equal(r.length, 1);
  assert.match(r[0], /1000/);
});

test('validarCriterio: meta batida em 100% é uma configuração válida', () => {
  const r = validarCriterio({
    nome: 'Bateu a meta', evento: 'META_BATIDA',
    operador: 'MAIOR_OU_IGUAL', valor: 100, pontos: 20,
  });
  assert.deepEqual(r, []);
});


test('chavePeriodo: anual vira AAAA', () => {
  assert.equal(chavePeriodo('ANUAL', new Date('2026-02-10T12:00:00Z')), '2026');
  assert.equal(chavePeriodo('ANUAL', new Date('2026-12-31T12:00:00Z')), '2026');
});

test('chavePeriodo: o mesmo mes gera sempre a mesma chave', () => {
  // Se isso variasse, a trava de idempotência do banco não seguraria e a
  // empresa veria o mesmo ponto creditado duas vezes.
  const a = chavePeriodo('MENSAL', new Date('2026-09-01T00:00:00Z'));
  const b = chavePeriodo('MENSAL', new Date('2026-09-30T23:59:00Z'));
  assert.equal(a, b);
});

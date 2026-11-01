/**
 * Testa o cálculo do DISC.
 *
 * O foco NÃO é "o resultado parece razoável" — é que o número seja DETERMINÍSTICO
 * e que a soma seja sempre 100. Um percentual de perfil comportamental que não
 * fecha é pior que não existir, porque o gestor confia no número.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDisc,
  QUESTIONARIO_DISC,
  TOTAL_PERGUNTAS_DISC,
  FATORES_DISC,
  definirVigenciasDisc,
  type FatorDisc,
} from '../src/modules/radar/radar.disc.ts';

/** Monta respostas escolhendo a alternativa pelo FATOR desejado. */
function responder(comPorFator: FatorDisc[]): Array<{ perguntaId: string; alternativaId: string }> {
  return QUESTIONARIO_DISC.map((p, i) => {
    const alvo = comPorFator[i % comPorFator.length];
    return { perguntaId: p.id, alternativaId: p.alternativas.find((a) => a.fator === alvo)!.id };
  });
}

test('questionário: 12 perguntas, 4 alternativas, um fator por alternativa', () => {
  assert.equal(TOTAL_PERGUNTAS_DISC, 12);
  for (const p of QUESTIONARIO_DISC) {
    assert.equal(p.alternativas.length, 4, `${p.id} deve ter 4 alternativas`);
    const fatores = p.alternativas.map((a) => a.fator).sort();
    assert.deepEqual(fatores, ['C', 'D', 'I', 'S'], `${p.id} deve cobrir os 4 fatores uma vez`);
  }
});

test('soma sempre 100 com respostas completas', () => {
  for (const padrao of [['D'], ['I'], ['S'], ['C'], ['D', 'I'], ['S', 'C'], ['D', 'S'], ['I', 'C']]) {
    const r = calcularDisc(responder(padrao as FatorDisc[]));
    const soma = r.D + r.I + r.S + r.C;
    assert.equal(soma, 100, `padrão ${padrao} somou ${soma}`);
    assert.equal(r.answered, 12);
  }
});

test('quem responde D em tudo obtém 100% D', () => {
  const r = calcularDisc(responder(['D']));
  assert.equal(r.D, 100);
  assert.equal(r.I, 0);
  assert.equal(r.S, 0);
  assert.equal(r.C, 0);
  assert.equal(r.predominante, 'D');
});

test('distribuição 5D/4I/2S/1C produz os percentuais esperados', () => {
  // 12 perguntas: D nas 5 primeiras, I nas 4 seguintes, S nas 2 últimas
  // (índice 10) e C na 11ª.
  const respostas = QUESTIONARIO_DISC.map((p, i) => {
    const fator = i < 5 ? 'D' : i < 9 ? 'I' : i < 11 ? 'S' : 'C';
    return { perguntaId: p.id, alternativaId: p.alternativas.find((a) => a.fator === fator)!.id };
  });
  const r = calcularDisc(respostas);
  assert.equal(r.D, 42);   // 5/12 = 41.67 -> 42
  assert.equal(r.I, 33);   // 4/12 = 33.33 -> 33
  assert.equal(r.S, 17);   // 2/12 = 16.67 -> 17
  assert.equal(r.C, 8);    // 1/12 =  8.33 ->  8
  assert.equal(r.D + r.I + r.S + r.C, 100);
  assert.equal(r.predominante, 'D');
});

test('empate desempata na ordem clássica D > I > S > C', () => {
  // 3 respostas de cada fator: 12 perguntas, D=3 I=3 S=3 C=3, tudo 25%.
  const r = calcularDisc(responder(['D', 'I', 'S', 'C']));
  assert.equal(r.D, 25);
  assert.equal(r.I, 25);
  assert.equal(r.S, 25);
  assert.equal(r.C, 25);
  assert.equal(r.predominante, 'D', 'empate_total deve resolver para D');
});

test('respostas repetidas da mesma pergunta contam uma vez', () => {
  const r = calcularDisc([
    { perguntaId: 'q1', alternativaId: 'a' },
    { perguntaId: 'q1', alternativaId: 'a' },
    { perguntaId: 'q1', alternativaId: 'a' },
  ]);
  assert.equal(r.answered, 1, 'a mesma pergunta não pode contar três vezes');
  assert.equal(r.D, 100);
  assert.equal(r.D + r.I + r.S + r.C, 100);
});

test('pergunta inexistente ou alternativa inválida é ignorada', () => {
  const r = calcularDisc([
    { perguntaId: 'q1', alternativaId: 'a' },
    { perguntaId: 'inexistente', alternativaId: 'a' },
    { perguntaId: 'q2', alternativaId: 'z' },
  ]);
  assert.equal(r.answered, 1);
  assert.equal(r.D, 100);
});

test('nenhuma resposta não quebra e devolve soma 100', () => {
  const r = calcularDisc([]);
  assert.equal(r.answered, 0);
  assert.equal(r.D + r.I + r.S + r.C, 0);
  assert.equal(r.total, 12);
});

test('percentual nunca sai negativo nem acima de 100', () => {
  // Todas as distribuições possíveis de 12 pontos entre 4 fatores.
  function* combs(rest: number, acc: number[]): Generator<number[]> {
    if (acc.length === 4) { if (rest === 0) yield acc; return; }
    for (let i = 0; i <= rest; i++) yield* combs(rest - i, [...acc, i]);
  }
  let conferidas = 0;
  for (const combo of combs(12, [])) {
    const r = calcularDisc(responder(combo.map((n, f) => FATORES_DISC[f % 4])));
    for (const f of FATORES_DISC) {
      assert.ok(r[f] >= 0 && r[f] <= 100, `${f} = ${r[f]} fora de 0..100 (combo ${combo})`);
    }
    assert.equal(r.D + r.I + r.S + r.C, 100, `combo ${combo} nao somou 100`);
    conferidas++;
  }
  assert.ok(conferidas > 100, 'a varredura deve cobrir muitas distribuicoes');
});

// ===========================================================================
//  VIGÊNCIA
// ===========================================================================
// A regra que decide qual avaliação o Radar mostra. É o ponto onde um bug
// entrega o perfil ERRADO na tela sem nenhum erro visível: nada quebra, o número
// só sai trocado. Por isso os cenários abaixo são os que já quebraram.

/** Avaliação fictícia; só id, datas e ordem de gravação importam aqui. */
function aval(id: string, data: string, criadaEm: number) {
  return {
    id,
    dataAvaliacao: new Date(`${data}T12:00:00`),
    createdAt: new Date(2026, 8, 27, 10, criadaEm),
  };
}

test('vigência: a primeira avaliação é a vigente', () => {
  const { vigenteId, desligarIds } = definirVigenciasDisc([aval('a1', '2026-09-28', 0)]);
  assert.equal(vigenteId, 'a1');
  assert.deepEqual(desligarIds, []);
});

test('vigência: lista vazia não elege ninguém (primeira gravação do func.)', () => {
  // A versão anterior desestruturava `const [{ id }] = []` e estouravava TypeError
  // aqui — a primeira avaliação de qualquer funcionário respondia HTTP 500.
  const { vigenteId, desligarIds } = definirVigenciasDisc([]);
  assert.equal(vigenteId, null);
  assert.deepEqual(desligarIds, []);
});

test('vigência: avaliação nova, mais recente, assume', () => {
  const r = definirVigenciasDisc([aval('antiga', '2026-09-10', 0), aval('nova', '2026-09-28', 5)]);
  assert.equal(r.vigenteId, 'nova');
  assert.deepEqual(r.desligarIds, ['antiga']);
});

test('vigência: avaliação RETROATIVA NÃO rouba a vigência', () => {
  // O caso que motivou a regra: o RH lança a de 10/09 depois da de 28/09.
  // "Última gravada" faria o Radar voltar a mostrar o perfil antigo.
  const r = definirVigenciasDisc([aval('recente', '2026-09-28', 0), aval('retroativa', '2026-09-10', 5)]);
  assert.equal(r.vigenteId, 'recente', 'a retroativa foi gravada por último, mas é a mais antiga');
  assert.deepEqual(r.desligarIds, ['retroativa']);
});

test('vigência: sempre sobra EXATAMENTE uma vigente, nunca duas nem zero', () => {
  // Ordens de gravação propositalmente embaralhadas, incluindo empates de data.
  const cenarios = [
    [aval('a', '2026-09-28', 0), aval('b', '2026-09-10', 1), aval('c', '2026-09-20', 2)],
    [aval('c', '2026-09-20', 2), aval('a', '2026-09-28', 0), aval('b', '2026-09-10', 1)],
    [aval('x', '2026-09-28', 0), aval('y', '2026-09-28', 1)],
    [aval('y', '2026-09-28', 1), aval('x', '2026-09-28', 0)],
    [aval('so', '2026-01-01', 0)],
  ];
  for (const lista of cenarios) {
    const { vigenteId, desligarIds } = definirVigenciasDisc(lista);
    assert.ok(vigenteId, 'sempre deve haver uma vigente');
    assert.equal(
      desligarIds.filter((id) => id === vigenteId).length,
      0,
      'a vigente não pode aparecer na lista de desligadas',
    );
    assert.equal(
      desligarIds.length + 1,
      lista.length,
      `todas as ${lista.length} avaliações devem ser classificadas (1 vigente + N desligadas)`,
    );
  }
});

test('vigência: empate de data desempata pela gravação mais recente, de forma estável', () => {
  const x = aval('x', '2026-09-28', 0);
  const y = aval('y', '2026-09-28', 1);
  // Mesma data, y gravada depois: y vence nas duas ordens de entrada.
  assert.equal(definirVigenciasDisc([x, y]).vigenteId, 'y');
  assert.equal(definirVigenciasDisc([y, x]).vigenteId, 'y');
  // E repetir a chamada não muda nada — precisa ser idempotente.
  assert.equal(definirVigenciasDisc([x, y, x]).vigenteId, 'y');
});

test('vigência: a data manda sobre a ordem de gravação', () => {
  const antigaMasGravadaDepois = aval('antiga', '2026-01-05', 99);
  const recenteMasGravadaAntes = aval('recente', '2026-09-28', 1);
  assert.equal(
    definirVigenciasDisc([antigaMasGravadaDepois, recenteMasGravadaAntes]).vigenteId,
    'recente',
  );
});

test('vigência: não muta a lista recebida', () => {
  // A rota passa direto o resultado do Prisma; ordenar o array no lugar
  // rearranjaria a ordem que o resto do handler espera.
  const lista = [aval('a', '2026-09-10', 0), aval('b', '2026-09-28', 1)];
  const copia = [...lista];
  definirVigenciasDisc(lista);
  assert.deepEqual(lista, copia);
});

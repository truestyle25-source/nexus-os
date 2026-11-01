/**
 * Testa Treinamentos (Ciclo 2).
 *
 * O foco não é "a IA sugere coisas boas" — é que o sistema NÃO aceite número
 * que não existe nos dados, e que a duração nunca seja inventada pelo cliente.
 * Uma duração gravada que não bate com o horário do convite é exatamente o
 * tipo de incoerência que ninguém nota até o convite impresso chegar errado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularDuracaoMinutos, minutosDeHHMM, validarSugestaoTreinamento,
  conferirNumerosCitados, montarContextoIA, resumoPresenca, ehTreinamentoAtivo,
  sugerirTreinamento,
  CATEGORIAS, FORMATOS, COMPETENCIAS_TREINAMENTO, ROTULO_CATEGORIA, ROTULO_FORMATO,
  DURACAO_MIN_MIN, DURACAO_MAX_MIN,
  type ContextoCapacitacao,
} from '../src/modules/rh/treinamentos.ts';

const CTX: ContextoCapacitacao = {
  periodo: '2026-09',
  departamentos: [
    {
      nome: 'Vendas', pessoas: 12, minutosAtraso: 340, minutosHoraExtra: 900,
      faltas: 4, advertencias: 1, comAvaliacaoDisc: 8,
      comPlanoDesenvolvimento: 2, treinamentosRealizados: 1,
    },
  ],
  totais: { pessoas: 12, minutosAtraso: 340, minutosHoraExtra: 900, faltas: 4, advertencias: 1, treinamentosRealizados: 1 },
  opcoes: { categoria: CATEGORIAS, competencia: COMPETENCIAS_TREINAMENTO, formato: FORMATOS },
};

// ===========================================================================
//  Duração
// ===========================================================================

test('duração: é deduzida das horas, nunca do cliente', () => {
  assert.equal(calcularDuracaoMinutos('09:00', '11:00'), 120);
  assert.equal(calcularDuracaoMinutos('13:30', '17:45'), 255);
  assert.equal(calcularDuracaoMinutos('00:00', '23:59'), 1439);
});

test('duração: horário invertido ou atravessando a meia-noite devolve null', () => {
  assert.equal(calcularDuracaoMinutos('11:00', '09:00'), null, 'fim antes do inicio');
  assert.equal(calcularDuracaoMinutos('09:00', '09:00'), null, 'duracao zero');
  // Ambíguo: 2h ou 26h? A resposta honesta é recusar, não chutar.
  assert.equal(calcularDuracaoMinutos('23:00', '01:00'), null, 'atravessa a meia-noite');
});

test('duração: horário malformado devolve null em vez de NaN', () => {
  for (const h of ['9:00', '09:00:00', '24:00', '09:60', '', 'abc', '09-00']) {
    assert.equal(minutosDeHHMM(h), null, `"${h}" não é HH:MM válido`);
  }
});

// ===========================================================================
//  Anti-hallucination: o número citado precisa existir no contexto
// ===========================================================================

test('IA: justificativa que só cita números do contexto é aceita', () => {
  const contexto = montarContextoIA(CTX);
  const r = validarSugestaoTreinamento({
    tema: 'Organização de rotinas',
    objetivo: 'Reduzir retrabalho no fechamento',
    categoria: 'ORGANIZACAO', competencia: 'ORGANIZACAO', formato: 'PRESENCIAL',
    publicoRecomendado: 'Equipe de Vendas',
    prioridade: 'ALTA', duracaoMinutosSugerida: 120,
    justificativa: 'Vendas acumula 340 minutos de atraso no periodo.',
  }, contexto);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sugestao.justificativa, 'Vendas acumula 340 minutos de atraso no periodo.');
  assert.deepEqual(r.numerosNaoVerificados, []);
});

test('IA: justificativa que inventa um número é DESCARTADA inteira', () => {
  const contexto = montarContextoIA(CTX);
  const r = validarSugestaoTreinamento({
    tema: 'Comunicação', objetivo: 'Melhorar escuta', categoria: 'COMUNICACAO',
    competencia: 'COMUNICACAO', formato: 'PRESENCIAL', publicoRecomendado: 'Todos',
    prioridade: 'MEDIA', duracaoMinutosSugerida: 60,
    justificativa: 'A equipe perde 87 horas por semana e 45 pessoas faltam.',
  }, contexto);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // O texto que dependia da evidência falsa não sobrevive.
  assert.equal(r.sugestao.justificativa, '');
  assert.ok(r.numerosNaoVerificados.length > 0);
  assert.ok(r.descartes.some((d) => d.includes('Justificativa descartada')));
});

test('conferirNumerosCitados: tolera separador de milhar, barra número inexistente', () => {
  const contexto = { pessoas: 1200, minutosAtraso: 340 };
  assert.deepEqual(conferirNumerosCitados('A equipe soma 1200 e 1.200 de atrasos', contexto), []);
  assert.deepEqual(conferirNumerosCitados('Existem 9999 atrasos', contexto), ['9999']);
});

// ===========================================================================
//  Validação da saída da IA
// ===========================================================================

test('IA: tema vazio = "dados insuficientes", nunca uma pauta fictícia', () => {
  const r = validarSugestaoTreinamento({
    tema: '', objetivo: 'qualquer coisa',
    perguntasAcompanhamento: ['Preciso de mais histórico.'],
  }, montarContextoIA(CTX));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.dadosInsuficientes, true);
    assert.match(r.motivo, /Dados insuficientes/);
  }
});

test('IA: valores fora do catálogo são descartados com motivo', () => {
  const r = validarSugestaoTreinamento({
    tema: 'Tema válido', objetivo: 'Objetivo válido',
    categoria: 'INVENTADA', competencia: 'INVENTADA', formato: 'TELEPATIA',
    prioridade: 'URGENTISSIMA', publicoRecomendado: 'x', duracaoMinutosSugerida: 10,
    justificativa: '',
  }, montarContextoIA(CTX));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Cai no fallback declarado, nunca no valor inventado.
  assert.equal(r.sugestao.categoria, 'OUTRO');
  assert.equal(r.sugestao.competencia, 'OUTRO');
  assert.equal(r.sugestao.formato, 'PRESENCIAL');
  assert.equal(r.sugestao.prioridade, 'MEDIA');
  assert.equal(r.sugestao.duracaoMinutosSugerida, null);
  assert.ok(r.descartes.length >= 4);
});

test('IA: tema sem objetivo é recusado', () => {
  const r = validarSugestaoTreinamento({ tema: 'Tema', objetivo: '' }, montarContextoIA(CTX));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.dadosInsuficientes, false);
});

test('IA: resposta estruturalmente inválida não lança exceção', () => {
  for (const entrada of [null, undefined, 'texto', 42, [], {}]) {
    const r = validarSugestaoTreinamento(entrada, montarContextoIA(CTX));
    assert.equal(r.ok, false, `${JSON.stringify(entrada)} deveria falhar com ok:false`);
  }
});

// ===========================================================================
//  Segurança: a IA não recebe identificador de ninguém
// ===========================================================================

test('contexto da IA NÃO carrega nome, cargo, CPF nem id de funcionário', () => {
  const serializado = JSON.stringify(montarContextoIA(CTX)).toLowerCase();
  for (const proibido of ['cpf', 'email', 'telefone', 'salario', 'senha', 'token', 'chave', 'funcionarioid']) {
    assert.equal(serializado.includes(proibido), false, `contexto não pode conter "${proibido}"`);
  }
  assert.deepEqual(Object.keys(montarContextoIA(CTX)).sort(), [
    'limites', 'opcoes', 'periodo', 'porDepartamento', 'totaisDaEmpresa',
  ]);
});

// ===========================================================================
//  Presença
// ===========================================================================

test('presença: "não registrado" é separado de "ausente"', () => {
  // Três confirmados, ninguém registrou presença. Não são 3 ausentes: são 3
  // pessoas cujo comparecimento ninguém anotou.
  const r = resumoPresenca([
    { status: 'CONFIRMADO' }, { status: 'CONFIRMADO' }, { status: 'CONFIRMADO' },
  ]);
  assert.deepEqual(r, { total: 3, presentes: 0, ausentes: 0, naoRegistrado: 3, percentual: null });
});

test('presença: percentual é sobre os DECIDIDOS, não sobre a lista toda', () => {
  const r = resumoPresenca([
    { status: 'PRESENTE' }, { status: 'PRESENTE' },
    { status: 'AUSENTE' },
    { status: 'CONFIRMADO' },
  ]);
  assert.equal(r.presentes, 2);
  assert.equal(r.ausentes, 1);
  assert.equal(r.naoRegistrado, 1);
  // 2 de 3 decididos = 67%. Contar os 4 daria 50% e pareceria que a metade
  // faltou, quando na verdade ninguém registrou a quarta.
  assert.equal(r.percentual, 67);
});

test('presença: lista vazia devolve null, não 0%', () => {
  assert.deepEqual(resumoPresenca([]), {
    total: 0, presentes: 0, ausentes: 0, naoRegistrado: 0, percentual: null,
  });
});

test('status: cancelado sai do acompanhamento, mas não do histórico', () => {
  assert.equal(ehTreinamentoAtivo('PLANEJADO'), true);
  assert.equal(ehTreinamentoAtivo('AGENDADO'), true);
  assert.equal(ehTreinamentoAtivo('CONCLUIDO'), true);
  assert.equal(ehTreinamentoAtivo('CANCELADO'), false);
});

test('catálogos: todo enum tem rótulo legível', () => {
  for (const c of CATEGORIAS) {
    assert.ok(ROTULO_CATEGORIA[c], `falta rótulo para ${c}`);
    assert.notEqual(ROTULO_CATEGORIA[c], c);
  }
  for (const f of FORMATOS) {
    assert.ok(ROTULO_FORMATO[f], `falta rótulo para ${f}`);
  }
});

test('limites de duração: a faixa sugerida à IA é a mesma validada na criação', () => {
  assert.equal(DURACAO_MIN_MIN, 30);
  assert.equal(DURACAO_MAX_MIN, 480);
  assert.equal(calcularDuracaoMinutos('09:00', '09:20')! < DURACAO_MIN_MIN, true);
  assert.equal(calcularDuracaoMinutos('00:00', '23:59')! > DURACAO_MAX_MIN, true);
});

// ===========================================================================
//  Fallback sem chave
// ===========================================================================

test('sem GEMINI_API_KEY, sugerirTreinamento falha de forma explícita', async () => {
  const chave = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await sugerirTreinamento(CTX);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.motivo, /GEMINI_API_KEY/);
      assert.equal(r.dadosInsuficientes, false);
    }
  } finally {
    if (chave) process.env.GEMINI_API_KEY = chave;
  }
});

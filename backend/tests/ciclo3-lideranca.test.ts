/**
 * Testa o Ciclo 3: Liderança Empática e Gestão de Tempo.
 *
 * O foco são as duas travas que protegem a pessoa: a IA não pode citar número
 * que não existe nos dados, e não pode produzir texto que soe a diagnóstico.
 * A segunda é a mais importante do ciclo — é a diferença entre "18h extras no
 * departamento" (dado) e "João não sabe se organizar" (julgamento).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cargoIndicaLideranca, verificarLinguagem, minutosDeHHMM, minutosPrevistosPorDia,
  intervaloIrregular, resumoLideranca, acompanhamentoVencido,
  validarSugestaoLideranca, montarContextoLideranca, sugerirLideranca,
  conferirNumerosCitados, TIPOS_FEEDBACK,
  type ContextoLideranca,
} from '../src/modules/rh/lideranca.ts';

const CTX: ContextoLideranca = {
  periodo: '2026-09',
  totais: { liderancas: 3, feedbacks: 5, acompanhamentosPendentes: 2, planosAtivos: 4, treinamentosConcluidos: 1 },
  departamentos: [
    { nome: 'Vendas', liderancas: 2, pessoas: 10, feedbacks: 2, acompanhamentosPendentes: 1, horasExtrasMin: 1080, atrasosDias: 3 },
  ],
  opcoes: { tipoFeedback: TIPOS_FEEDBACK },
};

// ===========================================================================
//  Liderança vem do CARGO
// ===========================================================================

test('cargo: termos de liderança são reconhecidos, ignorando acento e caixa', () => {
  for (const c of ['Líder', 'LIDER', 'líder', 'Coordenador', 'COORDENADOR', 'Gerente de Loja', 'Supervisor', '  Head  ']) {
    assert.equal(cargoIndicaLideranca(c), true, `"${c}" deveria indicar liderança`);
  }
});

test('cargo: cargo comum NÃO vira líder', () => {
  for (const c of ['Vendedor', 'Analista', 'Técnico de Som', 'Auxiliar', 'Operador', null, undefined, '', '   ']) {
    assert.equal(cargoIndicaLideranca(c), false, `"${c}" não deveria indicar liderança`);
  }
});

test('cargo: casa palavra inteira, não substring', () => {
  assert.equal(cargoIndicaLideranca('Candidato a promoção'), false);
  assert.equal(cargoIndicaLideranca('Liderança'), true);
});

// ===========================================================================
//  A trava de linguagem — a mais importante do ciclo
// ===========================================================================

test('linguagem: diagnóstico e veredito são REJEITADOS', () => {
  const proibidos = [
    'O funcionário está emocionalmente instável',
    'Ela tem ansiedade e precisa de ajuda',
    'Mostra sinais de burnout no time',
    'Esse colaborador não serve para liderança',
    'É incapaz de liderar a equipe',
    'Recomendo a demissão do colaborador',
    'Tem problema de gestão de tempo',
    'Não consegue lidar com pressão',
  ];
  for (const t of proibidos) {
    assert.equal(verificarLinguagem(t).ok, false, `"${t}" deveria ser rejeitado`);
  }
});

test('linguagem: sugestão e dado são ACEITOS', () => {
  const permitidos = [
    'Considere um feedback individual com o time de Vendas',
    'Vale avaliar uma conversa sobre organização da jornada',
    'O departamento acumula 1080 minutos de hora extra no período',
    'Há 2 acompanhamentos pendentes que já passaram da data',
    'Oportunidade de desenvolvimento: treinar organização',
    'Próximo passo: realizar feedback e registrar acordos',
  ];
  for (const t of permitidos) {
    assert.equal(verificarLinguagem(t).ok, true, `"${t}" deveria ser aceito`);
  }
});

test('linguagem: o filtro ignora acento', () => {
  assert.equal(verificarLinguagem('está emocionalmente instável').ok, false);
  assert.equal(verificarLinguagem('está emocionalmente inativel').ok, true);
});

test('linguagem: verifica TODOS os textos, não só o primeiro', () => {
  // A justificativa é onde o julgamento costuma se esconder.
  const r = verificarLinguagem('Considere um feedback', 'o colaborador tem depressão');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.termos.length > 0);
});

// ===========================================================================
//  Anti-hallucination de número
// ===========================================================================

test('IA: justificativa só com números do contexto é aceita', () => {
  const ctx = montarContextoLideranca(CTX);
  const r = validarSugestaoLideranca({
    sugestao: 'Considere um feedback com o time de Vendas',
    publico: 'Vendas',
    prioridade: 'ALTA',
    justificativa: 'Vendas acumula 1080 minutos de hora extra no período.',
  }, ctx);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sugestao.justificativa, 'Vendas acumula 1080 minutos de hora extra no período.');
  assert.deepEqual(r.numerosNaoVerificados, []);
});

test('IA: justificativa com número inventado é DESCARTADA', () => {
  const ctx = montarContextoLideranca(CTX);
  const r = validarSugestaoLideranca({
    sugestao: 'Considere um feedback', publico: 'Vendas', prioridade: 'MEDIA',
    justificativa: 'Foram 47 feedbacks e 92 atrasos no mês.',
  }, ctx);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sugestao.justificativa, '');
  assert.ok(r.numerosNaoVerificados.length > 0);
});

test('IA: sugestão que soa a veredito é rejeitada INTEIRA, não corrigida', () => {
  const ctx = montarContextoLideranca(CTX);
  const r = validarSugestaoLideranca({
    sugestao: 'A liderança de Vendas não tem perfil de liderança',
    publico: 'Vendas', prioridade: 'BAIXA', justificativa: '1080 minutos de hora extra.',
  }, ctx);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.dadosInsuficientes, false, 'não é falta de dado, é linguagem');
});

test('IA: texto vazio = dados insuficientes, nunca sugestão genérica', () => {
  const r = validarSugestaoLideranca({ sugestao: '', prioridade: 'ALTA' }, montarContextoLideranca(CTX));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.dadosInsuficientes, true);
    assert.match(r.motivo, /Dados insuficientes/);
  }
});

test('IA: prioridade fora do catálogo cai no fallback declarado', () => {
  const r = validarSugestaoLideranca({
    sugestao: 'Considere um feedback', publico: 'Vendas',
    prioridade: 'URGENTISSIMA', justificativa: '',
  }, montarContextoLideranca(CTX));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sugestao.prioridade, 'MEDIA');
    assert.ok(r.descartes.some((d) => d.includes('Prioridade')));
  }
});

test('IA: contexto NÃO leva nome, cargo, CPF nem id de funcionário', () => {
  const serializado = JSON.stringify(montarContextoLideranca(CTX)).toLowerCase();
  for (const proibido of ['cpf', 'email', 'telefone', 'salario', 'senha', 'token', 'chave', 'funcionarioid']) {
    assert.equal(serializado.includes(proibido), false, `contexto não pode conter "${proibido}"`);
  }
});

test('IA: resposta estruturalmente inválida não lança exceção', () => {
  for (const e of [null, undefined, 'texto', 42, [], {}]) {
    assert.equal(validarSugestaoLideranca(e, montarContextoLideranca(CTX)).ok, false);
  }
});

test('IA: sem GEMINI_API_KEY, falha de forma explícita', async () => {
  const chave = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await sugerirLideranca(CTX);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /GEMINI_API_KEY/);
  } finally {
    if (chave) process.env.GEMINI_API_KEY = chave;
  }
});

// ===========================================================================
//  Gestão de Tempo — jornada prevista x realizada
// ===========================================================================

test('jornada: prevista sai dos horarios, descontando o intervalo', () => {
  // 08:00-17:00 sao 9h de faixa; descontando 1h de almoco, sao 8h trabalhadas.
  assert.equal(minutosPrevistosPorDia('08:00', '17:00'), 480, '9h de faixa - 1h de almoco = 8h');
  // 10h de faixa descontando 1h: 9h. Sem o desconto, viraria 600 min e a
  // jornada prevista de quem sai 18:00 ficaria MAIOR que a de quem sai 17:00
  // com o mesmo almoço.
  assert.equal(minutosPrevistosPorDia('08:00', '18:00'), 540, '10h de faixa - 1h de almoco = 9h');
  // Faixa curta NAO desconta: meia jornada nao tem almoco registrado.
  assert.equal(minutosPrevistosPorDia('09:00', '12:00'), 180, '3h sem desconto');
});

test('jornada: sem horario previsto, NAO estima', () => {
  // Assumir 8h seria inventar jornada para quem nao tem.
  assert.equal(minutosPrevistosPorDia(null, '17:00'), null);
  assert.equal(minutosPrevistosPorDia('08:00', null), null);
  assert.equal(minutosPrevistosPorDia('17:00', '08:00'), null, 'saida antes da entrada');
  assert.equal(minutosPrevistosPorDia('9:00', '17:00'), null, 'formato errado');
});

test('minutosDeHHMM: formato invalido devolve null, nunca NaN', () => {
  for (const h of ['9:00', '24:00', '09:60', '', 'abc', '09-00']) {
    assert.equal(minutosDeHHMM(h), null, `"${h}" nao e HH:MM valido`);
  }
  assert.equal(minutosDeHHMM('00:00'), 0);
  assert.equal(minutosDeHHMM('23:59'), 1439);
});

test('intervalo: irregular so quando EXISTE batida e ela foge do padrao', () => {
  assert.equal(intervaloIrregular(720, 780), false, '12:00-13:00 e exatamente o padrao');
  // 12:02-13:00 sao 58min: 2min de diferenca, absorvido pela tolerancia.
  assert.equal(intervaloIrregular(722, 780), false, '2min de diferenca, dentro da tolerancia');
  // 11:40-13:00 sao 80min: 20min de diferenca, ACIMA da tolerancia de 10min.
  assert.equal(intervaloIrregular(700, 780), true, '20min de diferenca, fora da tolerancia');
  assert.equal(intervaloIrregular(600, 780), true, '3h de intervalo foge muito do padrao');
  assert.equal(intervaloIrregular(800, 700), true, 'retorno antes da saida');
  // Sem batida, nao e irregular: e dado AUSENTE, e a tela diz que falta dado.
  assert.equal(intervaloIrregular(null, 780), false);
  assert.equal(intervaloIrregular(720, null), false);
});

// ===========================================================================
//  Indicadores
// ===========================================================================

test('indicadores: sem lider identificado, cobertura e null e nao 0%', () => {
  // 0% diria "ninguem recebeu feedback"; o certo e "ninguem e lider".
  const r = resumoLideranca({
    liderancas: 0, feedbacks: 0, acompanhamentosPendentes: 0, proximosVencidos: 0,
    planosAtivos: 0, treinamentosConcluidos: 0, liderancasComFeedback: 0,
  });
  assert.equal(r.coberturaFeedback, null);
});

test('indicadores: cobertura e sobre os lideres, nao sobre todos', () => {
  const r = resumoLideranca({
    liderancas: 4, feedbacks: 10, acompanhamentosPendentes: 2, proximosVencidos: 1,
    planosAtivos: 3, treinamentosConcluidos: 5, liderancasComFeedback: 3,
  });
  // 3 de 4. Dividir pelos 10 feedbacks daria 30% e mediria a equipe inteira.
  assert.equal(r.coberturaFeedback, 75);
});

test('acompanhamento: vencido e quando a data passou e segue pendente', () => {
  const hoje = new Date(Date.UTC(2026, 8, 28, 12));
  assert.equal(acompanhamentoVencido(new Date(Date.UTC(2026, 8, 20, 12)), hoje), true, 'ontem');
  assert.equal(acompanhamentoVencido(new Date(Date.UTC(2026, 8, 28, 12)), hoje), false, 'hoje');
  assert.equal(acompanhamentoVencido(new Date(Date.UTC(2026, 9, 5, 12)), hoje), false, 'futuro');
  assert.equal(acompanhamentoVencido(null, hoje), false, 'sem data nao vence');
});

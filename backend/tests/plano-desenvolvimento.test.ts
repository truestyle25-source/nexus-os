/**
 * Testa o Plano de Desenvolvimento DISC (Ciclo 1).
 *
 * O foco NÃO é "a IA sugere coisas boas" — é que o sistema NÃO aceite uma
 * sugestão fora do catálogo, e que um plano nunca nasça com trabalho marcado
 * como feito. Um perfil comportamental gravado errado é pior do que um plano
 * inexistente: o gestor confia no registro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarSugestaoIA,
  extrairJson,
  normalizarAcoes,
  progresso,
  ehPlanoAtivo,
  montarContextoIA,
  sugerirPlano,
  ROTULO_ACAO,
  PRAZO_MIN_DIAS,
  PRAZO_MAX_DIAS,
  OBJETIVOS,
  COMPETENCIAS,
  TIPOS_ACAO,
  type ContextoAvaliacao,
} from '../src/modules/rh/plano-desenvolvimento.ts';

const CTX: ContextoAvaliacao = {
  avaliacaoId: 'av-1',
  funcionarioId: 'f-1',
  nome: 'Pessoa Teste',
  departamento: 'Vendas',
  cargo: 'Analista',
  perfil: 'D',
  scores: { D: 42, I: 33, S: 17, C: 8 },
  dataAvaliacao: '2026-09-28',
  observacoes: null,
  acoesSugeridas: [],
};

// ===========================================================================
//  Validação da saída da IA
// ===========================================================================

test('IA: sugestão dentro do catálogo é aceita', () => {
  const r = validarSugestaoIA({
    objetivo: 'COMUNICACAO',
    competencias: [{ nome: 'LIDERANCA', justificativa: 'porque sim' }],
    acoes: [{ tipo: 'TREINAMENTO', descricao: 'Curso de comunicação' }],
    perguntasAcompanhamento: ['Como foi a conversa?'],
    prazoSugeridoDias: 90,
    pontosAtencao: [],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sugestao.objetivo, 'COMUNICACAO');
  assert.equal(r.sugestao.acoes.length, 1);
  assert.equal(r.sugestao.prazoSugeridoDias, 90);
});

test('IA: objetivo fora do catálogo é DESCARTADO, não aceito como texto livre', () => {
  const r = validarSugestaoIA({ objetivo: 'AUMENTAR_VENDAS', acoes: [{ tipo: 'TREINAMENTO', descricao: 'x' }] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sugestao.objetivo, 'OUTRO');
  assert.equal(r.descartes.length, 1);
  assert.match(r.descartes[0], /não existe no catálogo/);
});

test('IA: percentuais e diagnóstico inventados são ignorados', () => {
  // A IA pode devolver qualquer coisa; o validador só reconhece o catálogo,
  // e o tipo devolvido não TEM campo para percentual nem para diagnóstico.
  const r = validarSugestaoIA({
    objetivo: 'LIDERANCA',
    percentuais: { D: 99, I: 0, S: 0, C: 1 },
    diagnostico: 'Burnout severo',
    acoes: [{ tipo: 'MENTORIA', descricao: 'Mentoria' }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.sugestao).sort(), [
    'acoes', 'competencias', 'objetivo', 'perguntasAcompanhamento', 'pontosAtencao', 'prazoSugeridoDias',
  ]);
});

test('IA: prazo fora da faixa plausível é descartado', () => {
  const base = { objetivo: 'LIDERANCA', acoes: [{ tipo: 'FEEDBACK', descricao: 'Feedback' }] };
  for (const dias of [1, 7, 0, 1000, -90]) {
    const r = validarSugestaoIA({ ...base, prazoSugeridoDias: dias });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.sugestao.prazoSugeridoDias, null, `prazo ${dias} deveria ser descartado`);
      assert.equal(r.descartes.some((d) => d.includes('fora da faixa')), true);
    }
  }
});

test('IA: prazo nas bordas da faixa é aceito', () => {
  const base = { objetivo: 'LIDERANCA', acoes: [{ tipo: 'FEEDBACK', descricao: 'Feedback' }] };
  for (const dias of [PRAZO_MIN_DIAS, PRAZO_MAX_DIAS]) {
    const r = validarSugestaoIA({ ...base, prazoSugeridoDias: dias });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.sugestao.prazoSugeridoDias, dias);
  }
});

test('IA: prazo não numérico é descartado sem quebrar', () => {
  const r = validarSugestaoIA({
    objetivo: 'LIDERANCA',
    prazoSugeridoDias: 'uns três meses',
    acoes: [{ tipo: 'FEEDBACK', descricao: 'Feedback' }],
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sugestao.prazoSugeridoDias, null);
});

test('IA: quando nada sobra aproveitável, responde ok:false em vez de devolver lixo', () => {
  const r = validarSugestaoIA({
    objetivo: 'QUALQUER_COISA',
    competencias: [{ nome: 'INVENTADA' }],
    acoes: [{ tipo: 'INVENTADO', descricao: 'x' }],
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.motivo, /fora do catálogo/);
});

test('IA: respostas estruturalmente inválidas não lançam exceção', () => {
  for (const entrada of [null, undefined, 'texto', 42, [], {}]) {
    const r = validarSugestaoIA(entrada);
    assert.equal(r.ok, false, `entrada ${JSON.stringify(entrada)} deveria falhar com ok:false`);
  }
});

test('IA: extrai JSON de resposta com cerca de código e prefixo', () => {
  const bruto = 'Claro!\n```json\n{"objetivo":"LIDERANCA","acoes":[]}\n```\nEspero ter ajudado.';
  assert.deepEqual(extrairJson(bruto), { objetivo: 'LIDERANCA', acoes: [] });
  assert.equal(extrairJson('nenhum json aqui'), null);
  assert.equal(extrairJson(''), null);
});

test('IA: contexto enviado NÃO carrega dado sensível', () => {
  const serializado = JSON.stringify(montarContextoIA(CTX)).toLowerCase();
  for (const proibido of ['cpf', 'salario', 'senha', 'email', 'telefone', 'token', 'chave']) {
    assert.equal(serializado.includes(proibido), false, `contexto não pode conter "${proibido}"`);
  }
});

test('IA: contexto leva só o que o gestor precisa ver', () => {
  const ctx = montarContextoIA(CTX);
  assert.deepEqual(Object.keys(ctx).sort(), [
    'acoesJaSugeridasPeloRadar', 'avaliacaoDisc', 'funcionario', 'opcoes',
  ]);
  // Os percentuais vão como LEITURA, dentro de avaliacaoDisc.
  assert.deepEqual(ctx.avaliacaoDisc.percentuais, { D: 42, I: 33, S: 17, C: 8 });
});

// ===========================================================================
//  Ações: nada nasce concluído
// ===========================================================================

test('ações: NENHUMA nasce concluída sem marcação explícita', () => {
  // Este é o bug do PlanoModal: `useState<number[]>([0, 1])` gravava as duas
  // primeiras como feitas antes de o gestor decidir qualquer coisa.
  const r = normalizarAcoes([
    { tipo: 'TREINAMENTO', descricao: 'Curso' },
    { tipo: 'MENTORIA', descricao: 'Mentoria' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.every((a) => a.concluida === false), true, 'nenhuma ação pode nascer concluída');
});

test('ações: só fica concluída quando o gestor mandou true', () => {
  const r = normalizarAcoes([
    { tipo: 'TREINAMENTO', descricao: 'Curso', concluida: true },
    { tipo: 'MENTORIA', descricao: 'Mentoria', concluida: false },
    { tipo: 'FEEDBACK', descricao: 'Feedback' },
  ]);
  assert.deepEqual(r.map((a) => a.concluida), [true, false, false]);
});

test('ações: valores estranhos em `concluida` viram pendente, não verdadeiro', () => {
  for (const valor of ['sim', 1, 'true', {}, [], null]) {
    const r = normalizarAcoes([{ tipo: 'FEEDBACK', descricao: 'x', concluida: valor as any }]);
    assert.equal(r[0].concluida, false, `valor ${JSON.stringify(valor)} não pode virar concluída`);
  }
});

test('ações: tipo e descrição inválidos são descartados', () => {
  const r = normalizarAcoes([
    { tipo: 'NAO_EXISTE', descricao: 'x' },
    { tipo: 'FEEDBACK', descricao: '' },
    { tipo: 'FEEDBACK' },
    { tipo: 'TREINAMENTO', descricao: 'válida' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].descricao, 'válida');
});

// ===========================================================================
//  Progresso e status
// ===========================================================================

test('progresso: é sempre derivado das ações gravadas', () => {
  assert.deepEqual(progresso([{ concluida: true }, { concluida: false }]), { total: 2, concluidas: 1, percentual: 50 });
  assert.deepEqual(progresso([{ concluida: true }, { concluida: true }]), { total: 2, concluidas: 2, percentual: 100 });
  assert.deepEqual(progresso([{ concluida: false }]), { total: 1, concluidas: 0, percentual: 0 });
  // Vazio não vira 0% (que pareceria "não começou"); vira null (desconhecido).
  assert.deepEqual(progresso([]), { total: 0, concluidas: 0, percentual: null });
  assert.deepEqual(progresso(null), { total: 0, concluidas: 0, percentual: null });
});

test('status: cancelado sai do painel de acompanhamento, mas não do histórico', () => {
  assert.equal(ehPlanoAtivo('PLANEJADO'), true);
  assert.equal(ehPlanoAtivo('EM_ANDAMENTO'), true);
  assert.equal(ehPlanoAtivo('CONCLUIDO'), true);
  assert.equal(ehPlanoAtivo('CANCELADO'), false);
});

// ===========================================================================
//  Catálogos
// ===========================================================================

test('catálogos: todo item do enum tem rótulo legível na tela', () => {
  // Sem rótulo, o `select` do formulário mostraria "COMUNICACAO" cru.
  for (const t of TIPOS_ACAO) {
    assert.ok(ROTULO_ACAO[t], `falta rótulo para ação ${t}`);
    assert.notEqual(ROTULO_ACAO[t], t, `rótulo de ${t} não pode ser o próprio código`);
  }
});

test('catálogos: objetivo e competência são coerentes entre si', () => {
  // Se um saísse de um catálogo e não do outro, a IA poderia sugerir algo que
  // o formulário não aceita — a sugestão sumiria ao salvar.
  assert.equal(OBJETIVOS.length, 7);
  assert.equal(COMPETENCIAS.length, 9);
  for (const o of OBJETIVOS) {
    assert.ok(COMPETENCIAS.includes(o as any), `${o} deve existir também em competências`);
  }
});

// ===========================================================================
//  Fallback sem chave (obrigatório)
// ===========================================================================

test('sem GEMINI_API_KEY, sugerirPlão falha de forma explícita e não chama a IA', async () => {
  const chave = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await sugerirPlano(CTX);
    assert.equal(r.ok, false);
    if (!r.ok) {
      // O gestor precisa saber QUE FALTOU A CHAVE, e não receber uma sugestão
      // genérica que pareça uma análise.
      assert.match(r.motivo, /GEMINI_API_KEY/);
    }
  } finally {
    if (chave) process.env.GEMINI_API_KEY = chave;
  }
});

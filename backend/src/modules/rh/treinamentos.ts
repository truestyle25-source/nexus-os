import { consultarIA, extrairJsonTexto } from '../ia/ia.service.js';
import { chaveDiaSql } from '../radar/radar.regras.js';

// ===========================================================================
//  TREINAMENTOS — Ciclo 2
//  Regra de negócio pura, sem banco e sem servidor, para poder ser testada
//  isolada. O padrão é o de `plano-desenvolvimento.ts` (Ciclo 1).
// ===========================================================================
//
//  LIMITE ENTRE IA E GESTOR
//  -----------------------
//  Mesma fronteira do Ciclo 1, com um acréscimo específico deste módulo:
//
//  A IA sugere um TEMA de treinamento a partir de dados agregados da empresa
//  (quantas pessoas têm atraso, quantas horas extras, quantas advertências).
//  Ela NUNCA sugere sobre uma pessoa. Recebe números por departamento e
//  retorna uma pauta de capacitação — não um veredito sobre alguém. Se a
//  pergunta recebida for sobre comportamento individual, o papel abaixo proíbe
//  responder.
//
//  Ela nunca devolve:
//  - nome de funcionário, cargo ou CPF (não recebe);
//  - percentual ou indicador que não esteja no contexto enviado;
//  - treinamento que "já aconteceu" (ela não tem acesso a histórico registrado;
//    quando recebe o histórico, ele vem como contexto de comparação);
//  - diagnóstico, avaliação de aptidão ou recomendação de desligamento.

export const STATUS_TREINAMENTO = [
  'PLANEJADO', 'AGENDADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO',
] as const;
export type StatusTreinamento = (typeof STATUS_TREINAMENTO)[number];

export const STATUS_PARTICIPANTE = [
  'CONVIDADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE', 'CANCELADO',
] as const;
export type StatusParticipante = (typeof STATUS_PARTICIPANTE)[number];

/** Formatos sugeridos pela IA. Catálogo fechado: texto livre viraria invenção. */
export const FORMATOS = ['PRESENCIAL', 'REMOTO', 'HIBRIDO'] as const;
export type Formato = (typeof FORMATOS)[number];

/**
 * Competências que a IA pode citar. Reaproveita o catálogo do Ciclo 1 em vez
 * de criar um paralelo: se um training cita "LIDERANCA" e o plano de
 * desenvolvimento também, os dois talking about the same thing.
 */
export const COMPETENCIAS_TREINAMENTO = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'TRABALHO_EM_EQUIPE',
  'GESTAO_DE_CONFLITOS', 'ATENDIMENTO', 'PROATIVIDADE', 'ADAPTABILIDADE', 'OUTRO',
] as const;
export type CompetenciaTreinamento = (typeof COMPETENCIAS_TREINAMENTO)[number];

/** Categorias sugeridas. Espelham `CompetenciaDesenvolvimento` (Ciclo 1). */
export const CATEGORIAS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'SEGURANCA', 'TECNICO',
  'ATENDIMENTO', 'GESTAO', 'OUTRO',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const ROTULO_STATUS: Record<StatusTreinamento, string> = {
  PLANEJADO: 'Planejado', AGENDADO: 'Agendado', EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado',
};
export const ROTULO_STATUS_PARTICIPANTE: Record<StatusParticipante, string> = {
  CONVIDADO: 'Convidado', CONFIRMADO: 'Confirmado', PRESENTE: 'Presente',
  AUSENTE: 'Ausente', CANCELADO: 'Cancelado (não participou)',
};
export const ROTULO_FORMATO: Record<Formato, string> = {
  PRESENCIAL: 'Presencial', REMOTO: 'Remoto', HIBRIDO: 'Híbrido',
};
export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  COMUNICACAO: 'Comunicação', LIDERANCA: 'Liderança', ORGANIZACAO: 'Organização',
  SEGURANCA: 'Segurança', TECNICO: 'Técnico', ATENDIMENTO: 'Atendimento',
  GESTAO: 'Gestão', OUTRO: 'Outro',
};

/**
 * INSTRUÇÃO DE SISTEMA DA IA — FRONTEIRA ENTRE SUGESTÃO E DIAGNÓSTICO.
 *
 * Versionada aqui, e não na chamada, para que a lista do que a IA não pode
 * fazer seja um pedaço de código revisável.
 */
export const PAPEL_ASSISTENTE_TREINAMENTOS = [
  'Você é o assistente de capacitação do NEXUS OS, em português do Brasil.',
  'Você SUGERE uma pauta de treinamento; o gestor decide o que fazer.',
  'Você nunca agenda, nunca convida e nunca registra presença.',
  '',
  'VOCÊ TRABALHA COM DADOS AGREGADOS POR DEPARTAMENTO E POR EQUIPE.',
  'Nenhuma análise sua é sobre uma pessoa. Não receba nem produza avaliação individual.',
  '',
  'PROIBIDO (sem exceção):',
  '- diagnosticar saúde mental, burnout, ansiedade ou qualquer transtorno;',
  '- afirmar que alguém é incapaz, incompetente ou não apto para um cargo;',
  '- recomendar contratação, promoção, demissão, punição ou despejo;',
  '- nomear funcionário, cargo ou CPF;',
  '- inventar número, percentual, média ou indicador que não esteja nos dados enviados;',
  '- afirmar que um treinamento foi ou não realizado — você não registra o passado,',
  '  apenas sugere pauta a partir do que foi enviado;',
  '- descrever hipótese como se fosse fato medido.',
  '',
  'LINGUAGEM OBRIGATÓRIA: sugestão, possibilidade, ponto de atenção, oportunidade de',
  'desenvolvimento. Nunca "problema da pessoa", "não serve", "precisa sair".',
  '',
  'Formato: responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON:',
  '{"tema":"nome do training","objetivo":"o que ele deve entregar",',
  '"categoria":"OPCAO","competencia":"OPCAO","formato":"OPCAO",',
  '"publicoRecomendado":"descrição do público, em 1 frase",',
  '"prioridade":"BAIXA|MEDIA|ALTA","duracaoMinutosSugerida":120,',
  '"justificativa":"1-2 frases citando os dados enviados",',
  '"perguntasAcompanhamento":["pergunta"]}',
  '',
  'Regras de conteúdo:',
  '- "categoria", "competencia" e "formato" devem ser EXATAMENTE uma das opções da lista enviada.',
  '- "prioridade" deve ser BAIXA, MEDIA ou ALTA.',
  '- "duracaoMinutosSugerida" é um inteiro entre 30 e 480.',
  '- "justificativa" só pode citar números que estejam no contexto recebido.',
  '- Se os dados não sustentarem uma sugestão, responda com "tema" vazio e explique em',
  '  "perguntasAcompanhamento" o que falta.',
].join('\n');

// ===========================================================================
//  Datas e duração
// ===========================================================================

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutos desde a meia-noite. `null` se o horário não for `HH:MM` válido. */
export function minutosDeHHMM(hora: string): number | null {
  const m = HHMM_RE.exec(hora ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Duração em minutos, DEDUZIDA das horas.
 *
 * A rota NUNCA aceita duração do cliente: ela calcula daqui. Um payload com
 * `duracaoMinutos: 480` e `horaInicio: '09:00'`, `horaFim: '10:00'` é
 * contraditório, e é a coluna do banco que ficaria discordando do horário
 * impresso no convite.
 *
 * Retorna `null` quando dá para atravessar a meia-noite (23:00 → 01:00): é
 * ambíguo se o treinamento dura 2h ou 26h, e a resposta honesta é pedir
 * confirmação, não chutar.
 */
export function calcularDuracaoMinutos(horaInicio: string, horaFim: string): number | null {
  const ini = minutosDeHHMM(horaInicio);
  const fim = minutosDeHHMM(horaFim);
  if (ini === null || fim === null) return null;
  const d = fim - ini;
  if (d <= 0) return null; // inclui travessia de meia-noite
  return d;
}

/** Faixa plausível de duração. Fora dela a sugestão da IA é descartada. */
export const DURACAO_MIN_MIN = 30;
export const DURACAO_MAX_MIN = 480;

// ===========================================================================
//  Entrada: os dados REAIS que a IA pode ver
// ===========================================================================

export type ContextoCapacitacao = {
  /** Período analisado, em `AAAA-MM`. */
  periodo: string;
  /** Um item por departamento. NUNCA por pessoa. */
  departamentos: Array<{
    nome: string;
    /** Efetivo ATIVO no período. */
    pessoas: number;
    /** Soma de minutos de atraso no período. */
    minutosAtraso: number;
    /** Soma de minutos de hora extra no período. */
    minutosHoraExtra: number;
    /** Dias de falta registrados. */
    faltas: number;
    /** Registros disciplinares no período. */
    advertencias: number;
    /** Quantas pessoas têm avaliação DISC vigente. */
    comAvaliacaoDisc: number;
    /** Quantas pessoas têm plano de desenvolvimento ativo. */
    comPlanoDesenvolvimento: number;
    /** Treinamentos já realizados para este departamento. */
    treinamentosRealizados: number;
  }>;
  /** Totais da empresa, para a IA não somar de novo e errar. */
  totais: {
    pessoas: number;
    minutosAtraso: number;
    minutosHoraExtra: number;
    faltas: number;
    advertencias: number;
    treinamentosRealizados: number;
  };
  opcoes: { categoria: readonly string[]; competencia: readonly string[]; formato: readonly string[] };
};

/**
 * Monta o contexto que vai para a IA.
 *
 * REGRA DE MENOS DADOS: entram CONTAGENS AGREGADAS, nunca identificadores.
 * Não há nome, cargo, CPF, e-mail ou id de funcionário em lugar nenhum — o que
 * a IA vê é "Vendas: 12 pessoas, 340 min de atraso, 2 faltas", e não "João,
 * vendedor, atrasou 3 vezes". Isso é o que torna impossível a IA produzir um
 * julgamento individual, e não apenas improvável.
 */
export function montarContextoIA(ctx: ContextoCapacitacao) {
  return {
    periodo: ctx.periodo,
    // TUDO o que a IA pode usar está listado aqui. Se um número não estiver
    // neste objeto, a IA não o recebeu — e portanto não pode citá-lo.
    totaisDaEmpresa: ctx.totais,
    porDepartamento: ctx.departamentos,
    limites: { duracaoMinutos: [DURACAO_MIN_MIN, DURACAO_MAX_MIN] },
    opcoes: ctx.opcoes,
  };
}

// ===========================================================================
//  Saída: validação da IA
// ===========================================================================

export type SugestaoTreinamento = {
  ok: true;
  sugestao: {
    tema: string;
    objetivo: string;
    categoria: Categoria;
    competencia: CompetenciaTreinamento;
    formato: Formato;
    publicoRecomendado: string;
    prioridade: 'BAIXA' | 'MEDIA' | 'ALTA';
    duracaoMinutosSugerida: number | null;
    justificativa: string;
    perguntasAcompanhamento: string[];
  };
  /** Números que a IA citou e que NÃO existem no contexto enviado. */
  numerosNaoVerificados: string[];
  descartes: string[];
};
export type ResultadoSugestao =
  | SugestaoTreinamento
  | { ok: false; motivo: string; dadosInsuficientes: boolean };

function texto(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length === 0 ? null : t.slice(0, max);
}

/** Números que aparecem em um texto. Usado para conferir a justificativa. */
function numerosNoTexto(t: string): string[] {
  return t.match(/\d[\d.,]*/g) ?? [];
}

/**
 * Verifica se a IA só citou números que existem no contexto.
 *
 * É a checagem anti-hallucination mais direta possível: os números que a IA
 * viu estão todos no contexto; se a justificativa citar um número que não está
 * lá, esse número foi inventado — e o texto é REJEITADO, não corrigido.
 *
 * Comparamos por valor, tolerando `1.200`, `1200` e `1200,5`, porque a IA
 * formata número do jeito dela. O que não toleramos é o número não existir.
 */
export function conferirNumerosCitados(justificativa: string, contexto: unknown): string[] {
  const permitidos = new Set(
    numerosNoTexto(JSON.stringify(contexto))
      .map((n) => n.replace(/[.,]/g, ''))
      .filter(Boolean),
  );
  return numerosNoTexto(justificativa)
    .filter((n) => !permitidos.has(n.replace(/[.,]/g, '')));
}

/**
 * Valida e FILTRA a saída da IA.
 *
 * Mesmo princípio do Ciclo 1: o que não bate com o catálogo é DESCARTADO e
 * registrado, nunca repassado ao gestor. E há uma checagem a mais aqui — a
 * justificativa não pode citar número que não esteja no contexto.
 */
export function validarSugestaoTreinamento(
  bruto: unknown,
  contexto: unknown,
): ResultadoSugestao {
  const descartes: string[] = [];
  if (!bruto || typeof bruto !== 'object') {
    return { ok: false, motivo: 'A IA não devolveu uma estrutura reconhecível.', dadosInsuficientes: false };
  }
  const o = bruto as Record<string, unknown>;

  const tema = texto(o.tema, 160);
  const objetivo = texto(o.objetivo, 300);

  // `tema` vazio é a forma acordada de a IA dizer "não tenho base suficiente".
  if (!tema) {
    const perguntas = (Array.isArray(o.perguntasAcompanhamento) ? o.perguntasAcompanhamento : [])
      .map((p) => texto(p, 200)).filter((p): p is string => p !== null).slice(0, 5);
    return {
      ok: false,
      motivo: 'Dados insuficientes para gerar uma recomendação.',
      dadosInsuficientes: true,
    };
  }
  if (!objetivo) {
    return { ok: false, motivo: 'A IA devolveu um tema sem objetivo.', dadosInsuficientes: false };
  }

  const categoria = CATEGORIAS.find((v) => v === o.categoria) ?? null;
  if (o.categoria != null && !categoria) {
    descartes.push(`Categoria "${String(o.categoria).slice(0, 40)}" fora do catálogo.`);
  }
  const competencia = COMPETENCIAS_TREINAMENTO.find((v) => v === o.competencia) ?? null;
  if (o.competencia != null && !competencia) {
    descartes.push(`Competência "${String(o.competencia).slice(0, 40)}" fora do catálogo.`);
  }
  const formato = FORMATOS.find((v) => v === o.formato) ?? null;
  if (o.formato != null && !formato) {
    descartes.push(`Formato "${String(o.formato).slice(0, 40)}" fora do catálogo.`);
  }

  const prioridade = ['BAIXA', 'MEDIA', 'ALTA'].find((v) => v === o.prioridade) ?? null;
  if (o.prioridade != null && !prioridade) {
    descartes.push(`Prioridade "${String(o.prioridade).slice(0, 20)}" fora do catálogo.`);
  }

  let duracao: number | null = null;
  const brutoDuracao = o.duracaoMinutosSugerida;
  if (typeof brutoDuracao === 'number' && Number.isFinite(brutoDuracao)) {
    const arredondada = Math.round(brutoDuracao);
    if (arredondada >= DURACAO_MIN_MIN && arredondada <= DURACAO_MAX_MIN) {
      duracao = arredondada;
    } else {
      descartes.push(`Duração (${arredondada} min) fora da faixa ${DURACAO_MIN_MIN}-${DURACAO_MAX_MIN}.`);
    }
  }

  const publico = texto(o.publicoRecomendado, 240) ?? '';
  let justificativa = texto(o.justificativa, 600) ?? '';
  // Números que a IA possa ter requerido: entram na checagem.
  const numerosNaoVerificados = conferirNumerosCitados(justificativa, contexto);
  if (numerosNaoVerificados.length > 0) {
    // A justificativa inteira é descartada. Poderia ser "corrigida" removendo os
    // números, mas o resto do texto ficaria sem a evidência que o sustentava.
    descartes.push(
      `Justificativa descartada: citou ${numerosNaoVerificados.join(', ')}, que não existe nos dados enviados.`,
    );
    justificativa = '';
  }

  const perguntas = (Array.isArray(o.perguntasAcompanhamento) ? o.perguntasAcompanhamento : [])
    .map((p) => texto(p, 200)).filter((p): p is string => p !== null).slice(0, 5);

  return {
    ok: true,
    sugestao: {
      tema,
      objetivo,
      categoria: categoria ?? 'OUTRO',
      competencia: competencia ?? 'OUTRO',
      formato: formato ?? 'PRESENCIAL',
      publicoRecomendado: publico,
      prioridade: (prioridade ?? 'MEDIA') as 'BAIXA' | 'MEDIA' | 'ALTA',
      duracaoMinutosSugerida: duracao,
      justificativa,
      perguntasAcompanhamento: perguntas,
    },
    numerosNaoVerificados,
    descartes,
  };
}

/**
 * Chama a IA para sugerir uma pauta de treinamento.
 *
 * Devolve `ok: false` em TODO caminho de falha — sem chave, timeout, erro da
 * API, JSON inválido, conteúdo fora do catálogo, ou base de dados insuficiente.
 * A rota responde 200 com `sugestao: null` e o motivo; nunca 500, porque "a IA
 * não respondeu" não é falha do sistema.
 */
export async function sugerirTreinamento(ctx: ContextoCapacitacao): Promise<
  | { ok: true; analise: Record<string, unknown>; numerosNaoVerificados: string[]; descartes: string[] }
  | { ok: false; motivo: string; dadosInsuficientes: boolean }
> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, motivo: 'GEMINI_API_KEY não configurada no ambiente.', dadosInsuficientes: false };
  }
  const contexto = montarContextoIA(ctx);
  const r = await consultarComTentativas(
    `Analise os indicadores abaixo e sugira UM tema de treinamento para a empresa.\n\nDADOS:\n${JSON.stringify(contexto)}`,
    { papel: PAPEL_ASSISTENTE_TREINAMENTOS, temperatura: 0.4, maxTokens: 4000 },
    3,
  );
  if (!r.ok) return { ok: false, motivo: r.motivo, dadosInsuficientes: false };

  const json = extrairJsonTexto(r.texto);
  if (json === null) return { ok: false, motivo: 'A IA não devolveu JSON válido.', dadosInsuficientes: false };

  const validado = validarSugestaoTreinamento(json, contexto);
  if (!validado.ok) {
    return { ok: false, motivo: validado.motivo, dadosInsuficientes: validado.dadosInsuficientes };
  }

  return {
    ok: true,
    analise: {
      ...validado.sugestao,
      descartes: validado.descartes,
      numerosNaoVerificados: validado.numerosNaoVerificados,
      // Rastreabilidade: os dados que a IA viu quando produziu a sugestão.
      dadosConsiderados: { periodo: ctx.periodo, totaisDaEmpresa: ctx.totais },
    },
    numerosNaoVerificados: validado.numerosNaoVerificados,
    descartes: validado.descartes,
  };
}

/**
 * Retry só para falha TRANSITÓRIA de infraestrutura (429/5xx/timeout/alta
 * demanda). Cota e falha de conteúdo não são transitórias: a API responde
 * "retry in 39s", e esperar isso dentro de uma requisição HTTP travaria a tela
 * do gestor por mais tempo do que a espera por ela.
 *
 * Mora aqui, e não em `consultarIA`, porque os outros chamadores do serviço não
 * pediram para mudar de comportamento.
 */
async function consultarComTentativas(
  pergunta: string,
  opcoes: { papel: string; temperatura: number; maxTokens: number },
  tentativas: number,
): Promise<Awaited<ReturnType<typeof consultarIA>>> {
  const TRANSIENTE = /high demand|overloaded|429|500|502|503|504|unavailable|timed out|esgotado|Fetch failed|ECONNRESET|ENOTFOUND/i;
  // `json: true`: sem isso o modelo devolve o raciocínio em prosa e o
  // `maxTokens` corta a resposta no meio — e uma pauta truncada não é uma pauta.
  const config = { ...opcoes, json: true };
  let ultimo = 'Falha desconhecida na IA.';
  for (let i = 1; i <= tentativas; i++) {
    const r = await consultarIA(pergunta, config);
    if (r.ok) return r;
    ultimo = r.motivo;
    if (!TRANSIENTE.test(r.motivo)) return { ok: false, motivo: r.motivo };
    if (i < tentativas) await new Promise((r) => setTimeout(r, 1000 * i));
  }
  return { ok: false, motivo: ultimo };
}

// ===========================================================================
//  Progresso de um treinamento
// ===========================================================================

/**
 * Resumo de presença.
 *
 * `naoRegistrado` é o número de gente que estava na lista mas cujo presença
 * ninguém anotou. É o campo que impede a tela de dizer "100% presentes" por
 * omissão: um treinamento encerrado com 10 confirmados e 0 registros não teve
 * 10 presenças, e a diferença precisa ficar visível.
 */
export function resumoPresenca(
  participantes: Array<{ status: string }>,
): { total: number; presentes: number; ausentes: number; naoRegistrado: number; percentual: number | null } {
  const lista = participantes ?? [];
  const total = lista.length;
  const presentes = lista.filter((p) => p.status === 'PRESENTE').length;
  const ausentes = lista.filter((p) => p.status === 'AUSENTE').length;
  const naoRegistrado = lista.filter(
    (p) => p.status === 'CONVIDADO' || p.status === 'CONFIRMADO',
  ).length;
  const decididos = presentes + ausentes;
  return {
    total,
    presentes,
    ausentes,
    naoRegistrado,
    percentual: decididos === 0 ? null : Math.round((presentes / decididos) * 100),
  };
}

/** Um treinamento cancelado ou não iniciado não entra em painel de acompanhamento. */
export function ehTreinamentoAtivo(status: string): boolean {
  return status !== 'CANCELADO';
}

export { chaveDiaSql };

import { consultarIA, extrairJsonTexto } from '../ia/ia.service.js';

/**
 * PLANO DE DESENVOLVIMENTO DISC — Ciclo 1
 * =======================================
 * Transforma uma avaliação DISC REAL em um plano de desenvolvimento.
 *
 * O QUE ESTE ARQUIVO É
 * -------------------
 * A regra de negócio, separada das rotas para poder ser testada sem banco e
 * sem subir servidor — o mesmo padrão de `radar.disc.ts`. As rotas ficam em
 * `plano-desenvolvimento.routes.ts`.
 *
 * LIMITE ENTRE IA E GESTOR
 * -----------------------
 * A IA sugere; o gestor decide. Concretamente:
 *
 *  * a IA NUNCA escreve em `perfil` ou `scores`. Esses dois campos são
 *    reidratados do banco a partir de `avaliacaoId`, e a validação de criação
 *    RECUSA qualquer payload que tente trazê-los;
 *  * a IA devolve apenas enums fechados, textos e um prazo em dias;
 *  * a saída passa por `validarSugestaoIA`, que descarta qualquer valor fora
 *    do catálogo — o mesmo espelho de `normalizarKpi` dos relatórios, onde o
 *    número que a IA "redige" diferente do real é jogado fora;
 *  * se a IA falhar, devolver lixo ou não houver chave, `analiseIA` fica
 *    `null` e o plano é montado à mão. Nenhuma sugestão é inventada.
 *
 * A instrução de sistema abaixo é a fronteira entre "assistente" e
 * "diagnóstico". Ela é versionada aqui, e não na chamada, para que a lista do
 * que a IA não pode fazer seja auditável em um lugar só.
 */

export const OBJETIVOS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'TRABALHO_EM_EQUIPE',
  'GESTAO_DE_CONFLITOS', 'ATENDIMENTO', 'OUTRO',
] as const;
export type Objetivo = (typeof OBJETIVOS)[number];

export const COMPETENCIAS = [
  'COMUNICACAO', 'LIDERANCA', 'ORGANIZACAO', 'TRABALHO_EM_EQUIPE',
  'GESTAO_DE_CONFLITOS', 'ATENDIMENTO', 'PROATIVIDADE', 'ADAPTABILIDADE', 'OUTRO',
] as const;
export type Competencia = (typeof COMPETENCIAS)[number];

export const TIPOS_ACAO = [
  'TREINAMENTO', 'ACOMPANHAMENTO', 'FEEDBACK', 'EXERCICIO_PRATICO', 'MENTORIA', 'OUTRO',
] as const;
export type TipoAcao = (typeof TIPOS_ACAO)[number];

export const STATUS_PLANO = ['PLANEJADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'] as const;
export type StatusPlano = (typeof STATUS_PLANO)[number];

export type AcaoPlano = { tipo: TipoAcao; descricao: string; concluida: boolean };

/** Catálogo legível, enviado ao gestor e mostrado na tela. */
export const ROTULO_OBJETIVO: Record<Objetivo, string> = {
  COMUNICACAO: 'Comunicação',
  LIDERANCA: 'Liderança',
  ORGANIZACAO: 'Organização',
  TRABALHO_EM_EQUIPE: 'Trabalho em equipe',
  GESTAO_DE_CONFLITOS: 'Gestão de conflitos',
  ATENDIMENTO: 'Atendimento',
  OUTRO: 'Outro',
};
export const ROTULO_COMPETENCIA: Record<Competencia, string> = {
  ...ROTULO_OBJETIVO,
  PROATIVIDADE: 'Proatividade',
  ADAPTABILIDADE: 'Adaptabilidade',
};
export const ROTULO_ACAO: Record<TipoAcao, string> = {
  TREINAMENTO: 'Treinamento',
  ACOMPANHAMENTO: 'Acompanhamento',
  FEEDBACK: 'Feedback',
  EXERCICIO_PRATICO: 'Exercício prático',
  MENTORIA: 'Mentoria',
  OUTRO: 'Outra',
};
export const ROTULO_STATUS: Record<StatusPlano, string> = {
  PLANEJADO: 'Planejado',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

/**
 * Janelas plausíveis de acompanhamento. Fora da faixa, a sugestão da IA é
 * descartada: um prazo de 3 dias ou de 5 anos não é um plano de
 * desenvolvimento, e aceitá-lo seria confiar num número sem critério.
 */
export const PRAZO_MIN_DIAS = 30;
export const PRAZO_MAX_DIAS = 365;

export const PAPEL_ASSISTENTE_DESENVOLVIMENTO = [
  'Você é o assistente de desenvolvimento do NEXUS OS, em português do Brasil.',
  'Você SUGERE; o gestor decide. Você nunca registra, aprova ou executa nada.',
  '',
  'O que é o DISC: um questionário de estilo de comportamento observado nas respostas.',
  'O que o DISC NÃO é: não mede capacidade, não mede desempenho, não mede inteligência,',
  'não é diagnóstico psicológico e não diz se alguém serve para um cargo.',
  'Trate o perfil como um ponto de partida para conversar, nunca como veredito.',
  '',
  'PROIBIDO (sem exceção):',
  '- diagnosticar saúde mental, burnout, ansiedade ou qualquer transtorno;',
  '- afirmar que alguém é incapaz, incompetente ou não serve para determinada função;',
  '- recomendar ou justificar contratação, promoção, demissão, punição ou despejo;',
  '- inventar, estimar, recalcular ou alterar os percentuais D, I, S e C;',
  '- inventar números, metas ou resultados que não estejam nos dados enviados;',
  '- descrever uma hipótese como se fosse um fato medido.',
  '',
  'Formato: responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON:',
  '{"objetivo":"OPCAO","competencias":[{"nome":"OPCAO","justificativa":"1 frase"}],',
  '"acoes":[{"tipo":"OPCAO","descricao":"o que fazer, 1 frase"}],',
  '"perguntasAcompanhamento":["pergunta"],"prazoSugeridoDias":90,"pontosAtencao":["ponto"]}',
  '',
  'Regras de conteúdo:',
  '- "objetivo" e cada "competencias[].nome" e "acoes[].tipo" devem ser EXATAMENTE uma das opções da lista enviada.',
  '- "prazoSugeridoDias" é um número inteiro entre 30 e 365.',
  '- "acoes" entre 1 e 6 itens, "competencias" entre 1 e 3 itens.',
  '- Se os dados forem insuficientes para uma sugestão, responda com listas vazias e explique em "pontosAtencao".',
].join('\n');

// ===========================================================================
//  Entrada: a avaliação DISC real
// ===========================================================================

export type ContextoAvaliacao = {
  avaliacaoId: string;
  funcionarioId: string;
  nome: string;
  departamento: string | null;
  cargo: string | null;
  perfil: string | null;
  scores: { D?: number; I?: number; S?: number; C?: number } | null;
  dataAvaliacao: string;
  observacoes: string | null;
  /** Ações que o Radar já derivou desta avaliação, se houver. */
  acoesSugeridas: string[];
};

/**
 * Monta o contexto que vai para a IA.
 *
 * REGRA DE MENOS DADOS (especificação §7): a IA recebe o estritamente
 * necessário. NÃO entra CPF, salário, e-mail, telefone, ponto, folha, nem
 * qualquer registro de outro funcionário ou de outra empresa.
 */
export function montarContextoIA(ctx: ContextoAvaliacao) {
  return {
    funcionario: { nome: ctx.nome, departamento: ctx.departamento, cargo: ctx.cargo },
    // Somente leitura. A IA não pode reescrever estes números.
    avaliacaoDisc: {
      perfil: ctx.perfil,
      percentuais: ctx.scores ?? null,
      data: ctx.dataAvaliacao,
      observacoesDoRh: ctx.observacoes,
    },
    acoesJaSugeridasPeloRadar: ctx.acoesSugeridas,
    opcoes: { objetivo: OBJETIVOS, competencia: COMPETENCIAS, tipoAcao: TIPOS_ACAO },
  };
}

// ===========================================================================
//  Saída: validação da IA
// ===========================================================================

export type SugestaoIA = {
  ok: true;
  sugestao: {
    objetivo: Objetivo;
    competencias: Array<{ nome: Competencia; justificativa: string }>;
    acoes: Array<{ tipo: TipoAcao; descricao: string }>;
    perguntasAcompanhamento: string[];
    prazoSugeridoDias: number | null;
    pontosAtencao: string[];
  };
  /** Por que parte da saída da IA foi descartada. */
  descartes: string[];
};
export type SugestaoIAResultado = SugestaoIA | { ok: false; motivo: string };

function texto(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length === 0 ? null : t.slice(0, max);
}

/**
 * Valida e FILTRA a saída da IA.
 *
 * É aqui que a separação entre "a IA respondeu" e "a IA respondeu algo válido"
 * acontece. Tudo que não bate com o catálogo é DESCARTADO (com o motivo
 * registrado em `descartes`), nunca repassado ao gestor — o mesmo princípio de
 * `normalizarKpi`: um valor inventado não pode chegar à tela parecendo dado.
 *
 * Devolve `ok: false` só quando não sobrou NADA utilizável; nesse caso a tela
 * diz que não houve sugestão e o plano é montado à mão.
 */
export function validarSugestaoIA(bruto: unknown): SugestaoIAResultado {
  const descartes: string[] = [];
  if (!bruto || typeof bruto !== 'object') {
    return { ok: false, motivo: 'A IA não devolveu uma estrutura reconhecível.' };
  }
  const o = bruto as Record<string, unknown>;

  const objetivo = OBJETIVOS.find((v) => v === o.objetivo) ?? null;
  if (o.objetivo != null && !objetivo) {
    descartes.push(`Objetivo "${String(o.objetivo).slice(0, 40)}" não existe no catálogo.`);
  }

  const competencias = (Array.isArray(o.competencias) ? o.competencias : [])
    .map((c) => {
      const item = (c ?? {}) as Record<string, unknown>;
      const nome = COMPETENCIAS.find((v) => v === item.nome) ?? null;
      if (!nome) {
        if (item.nome != null) descartes.push(`Competência "${String(item.nome).slice(0, 40)}" fora do catálogo.`);
        return null;
      }
      return { nome, justificativa: texto(item.justificativa, 240) ?? '' };
    })
    .filter((c): c is { nome: Competencia; justificativa: string } => c !== null)
    .slice(0, 3);

  const acoes = (Array.isArray(o.acoes) ? o.acoes : [])
    .map((a) => {
      const item = (a ?? {}) as Record<string, unknown>;
      const tipo = TIPOS_ACAO.find((v) => v === item.tipo) ?? null;
      const descricao = texto(item.descricao, 240);
      if (!tipo) {
        if (item.tipo != null) descartes.push(`Tipo de ação "${String(item.tipo).slice(0, 40)}" fora do catálogo.`);
        return null;
      }
      if (!descricao) {
        descartes.push(`Ação do tipo ${tipo} sem descrição.`);
        return null;
      }
      return { tipo, descricao };
    })
    .filter((a): a is { tipo: TipoAcao; descricao: string } => a !== null)
    .slice(0, 6);

  const perguntas = (Array.isArray(o.perguntasAcompanhamento) ? o.perguntasAcompanhamento : [])
    .map((p) => texto(p, 200)).filter((p): p is string => p !== null).slice(0, 5);
  const atencao = (Array.isArray(o.pontosAtencao) ? o.pontosAtencao : [])
    .map((p) => texto(p, 200)).filter((p): p is string => p !== null).slice(0, 5);

  let prazo: number | null = null;
  const brutoPrazo = o.prazoSugeridoDias;
  if (typeof brutoPrazo === 'number' && Number.isFinite(brutoPrazo)) {
    const arredondado = Math.round(brutoPrazo);
    if (arredondado >= PRAZO_MIN_DIAS && arredondado <= PRAZO_MAX_DIAS) {
      prazo = arredondado;
    } else {
      descartes.push(`Prazo sugerido (${arredondado} dias) fora da faixa ${PRAZO_MIN_DIAS}-${PRAZO_MAX_DIAS}.`);
    }
  } else if (brutoPrazo != null) {
    descartes.push('Prazo sugerido não era numérico.');
  }

  if (!objetivo && competencias.length === 0 && acoes.length === 0) {
    return {
      ok: false,
      motivo: descartes.length > 0
        ? `A IA só sugeriu valores fora do catálogo (${descartes.length} descarte(s)).`
        : 'A IA não produziu sugestão utilizável para estes dados.',
    };
  }

  return {
    ok: true,
    sugestao: {
      objetivo: objetivo ?? 'OUTRO',
      competencias,
      acoes,
      perguntasAcompanhamento: perguntas,
      prazoSugeridoDias: prazo,
      pontosAtencao: atencao,
    },
    descartes,
  };
}

/**
 * Extrai o JSON da resposta do modelo.
 *
 * Delegado para `extrairJsonTexto` em `ia.service.ts`, que é onde esse
 * utilitário mora desde o Ciclo 2 — duplicar a função por módulo seria
 * exatamente o tipo de estrutura repetida que o projeto evita.
 */
export const extrairJson = extrairJsonTexto;

/**
 * Uma "alta demanda" do modelo é transitória, e sem nova tentativa o gestor
 * recebe "sem sugestão" por um motivo que não tem a ver com a avaliação dele.
 *
 * O retry mora AQUI, e não em `consultarIA`, por duas razões: os outros
 * chamadores do serviço não pediu para mudar de comportamento, e só este
 * caminho tem um contrato explícito de "falhou, mas a tela continua
 * funcionando sem IA".
 *
 * Só repetimos falha de infraestrutura (429/5xx/timeout). Falha de conteúdo
 * — chave ausente, JSON inválido, catálogo furado — não é transitória e não
 * ganha nova tentativa.
 */
async function consultarComTentativas(
  pergunta: string,
  opcoes: { papel: string; temperatura: number; maxTokens: number },
  tentativas = 3,
): Promise<Awaited<ReturnType<typeof consultarIA>>> {
  const TRANSIENTE = /high demand|overloaded|429|500|502|503|504|unavailable|timed out|esgotado|Fetch failed|ECONNRESET|ENOTFOUND/i;
  // Cota NÃO entra na lista. A API responde "Please retry in 39s" — esperar
  // 39s dentro de uma requisição HTTP trava a tela do gestor por mais tempo do
  // que a espera por ela. Devolvemos a mensagem, que já diz quando repetir.
  // `rate limit` ficou de fora de propósito, pela mesma razão.
  // `json: true`: sem isso o modelo devolve o raciocínio em prosa e o
  // `maxTokens` corta a resposta no meio — e um plano truncado não é um plano.
  const config = { ...opcoes, json: true };
  let ultimo: string = 'Falha desconhecida na IA.';
  for (let i = 1; i <= tentativas; i++) {
    const r = await consultarIA(pergunta, config);
    if (r.ok) return r;
    ultimo = r.motivo;
    if (!TRANSIENTE.test(r.motivo)) return { ok: false, motivo: r.motivo };
    if (i < tentativas) {
      // Espera curta e crescente: 1s, 2s. Suficiente para a demanda cair sem
      // prender a requisição do gestor por muito tempo.
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  return { ok: false, motivo: ultimo };
}

/**
 * Pede a sugestão à IA NEXUS.
 *
 * Devolve `ok: false` em TODO caminho de falha — sem chave, timeout, erro da
 * API, resposta vazia, JSON inválido, conteúdo fora do catálogo. A rota trata
 * isso gravando `analiseIA: null`; a tela informa que a sugestão não veio.
 */
export async function sugerirPlano(
  ctx: ContextoAvaliacao,
): Promise<{ ok: true; analise: Record<string, unknown>; descartes: string[] } | { ok: false; motivo: string }> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, motivo: 'GEMINI_API_KEY não configurada no ambiente.' };
  }
  const contexto = montarContextoIA(ctx);
  // maxTokens generoso (o modelo gasta parte do orçamento raciocinando antes de
  // responder) e mais attempts, porque cada tentativa é cara e vale insistir
  // antes de devolver "sem sugestão" ao gestor.
  const r = await consultarComTentativas(
    `Analise a avaliação DISC abaixo e sugira UM plano de desenvolvimento.\n\nDADOS:\n${JSON.stringify(contexto)}`,
    { papel: PAPEL_ASSISTENTE_DESENVOLVIMENTO, temperatura: 0.4, maxTokens: 4000 },
    4,
  );
  if (!r.ok) return { ok: false, motivo: r.motivo };

  const json = extrairJson(r.texto);
  if (json === null) return { ok: false, motivo: 'A IA não devolveu JSON válido.' };

  const validado = validarSugestaoIA(json);
  if (!validado.ok) return { ok: false, motivo: validado.motivo };

  return {
    ok: true,
    analise: {
      ...validado.sugestao,
      descartes: validado.descartes,
      // `dadosConsiderados` fica gravado junto para dar rastreabilidade: o que
      // a IA viu quando produziu a sugestão.
      dadosConsiderados: {
        perfil: ctx.perfil,
        percentuais: ctx.scores ?? null,
        dataAvaliacao: ctx.dataAvaliacao,
      },
    },
    descartes: validado.descartes,
  };
}

// ===========================================================================
//  Montagem do plano
// ===========================================================================

/** Progresso das ações — é o que o Radar mostra como evolução. */
export function progresso(acoes: unknown): {
  total: number; concluidas: number; percentual: number | null;
} {
  const lista = Array.isArray(acoes) ? acoes : [];
  const total = lista.length;
  const concluidas = lista.filter((a) => (a as { concluida?: unknown })?.concluida === true).length;
  return { total, concluidas, percentual: total === 0 ? null : Math.round((concluidas / total) * 100) };
}

/** Um plano CANCELADO sai da visão "o que está em andamento", mas fica no histórico. */
export function ehPlanoAtivo(status: string): boolean {
  return status !== 'CANCELADO';
}

/**
 * Valida e normaliza as ações antes de gravar.
 *
 * `concluida` só é `true` quando o gestor marcou explicitamente. Um payload
 * sem o campo — ou com valor inesperado — nasce como PENDENTE. Foi exatamente
 * esse o bug do `PlanoModal`, que usava `useState<number[]>([0, 1])` e
 * gravava as duas primeiras ações como concluídas sem ninguém ter clicado.
 */
export function normalizarAcoes(entrada: unknown): AcaoPlano[] {
  if (!Array.isArray(entrada)) return [];
  return entrada
    .map((a) => {
      const item = (a ?? {}) as Record<string, unknown>;
      const tipo = TIPOS_ACAO.find((v) => v === item.tipo) ?? null;
      const descricao = texto(item.descricao, 240);
      if (!tipo || !descricao) return null;
      return { tipo, descricao, concluida: item.concluida === true };
    })
    .filter((a): a is AcaoPlano => a !== null)
    .slice(0, 12);
}

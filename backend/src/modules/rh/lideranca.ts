import { consultarIA, extrairJsonTexto } from '../ia/ia.service.js';

/**
 * LIDERANÇA EMPÁTICA — Ciclo 3
 * =============================
 * Regra pura, sem banco e sem servidor, para poder ser testada isolada — o
 * mesmo padrão de `plano-desenvolvimento.ts` e `treinamentos.ts`.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 * --------------------------
 * Não diagnostica comportamento. Não classifica ninguém como "bom líder" ou
 * "problema de liderança". Não lê saúde mental. Não decide demissão, promoção
 * ou punição.
 *
 * O que ele faz é dar ao gestor três coisas:
 *  1. o que foi conversado (registro real, digitado por quem conversou);
 *  2. a fila de conversas que estão marcadas para voltar;
 *  3. uma SUGESTÃO de aonde olhar, sempre citando os indicadores que a
 *     originaram.
 *
 * LIDERANÇA VEM DO CARGO — DECIDIDO COM VOCÊ
 * -------------------------------------------
 * Não há campo `lideranca` no `Funcionario`. Um termo do cargo indica liderança
 * é uma CONVENÇÃO, não um fato, e por isso ela é declarada aqui, versionada e
 * mostrada na tela — e não escondida dentro de uma comparação de string.
 *
 * Se o gestor cadastrar o cargo como "Técnico de Som", ninguém vira líder por
 * acaso. Se cadastrar "Coordenador", toda pessoa com esse cargo entra. A
 * regra é visível e ajustável; o efeito é previsível.
 */

export const TERMOS_LIDERANCA = [
  'LIDER', 'LÍDER', 'LIDERANCA', 'LIDERANÇA', 'GESTOR', 'GESTORA',
  'GERENTE', 'SUPERVISOR', 'SUPERVISORA', 'COORDENADOR', 'COORDENADORA',
  'DIRETOR', 'DIRETORA', 'DIRET', 'CHEFE', 'ENCARREGADO', 'ENCARREGADA',
  'PREZIDENTE', 'HEAD',
] as const;

export const TIPOS_FEEDBACK = ['POSITIVO', 'DESENVOLVIMENTO', 'ACORDO'] as const;
export type TipoFeedback = (typeof TIPOS_FEEDBACK)[number];

export const STATUS_ACOMPANHAMENTO = ['PENDENTE', 'REALIZADO', 'CANCELADO'] as const;
export type StatusAcompanhamento = (typeof STATUS_ACOMPANHAMENTO)[number];

export const ROTULO_TIPO: Record<TipoFeedback, string> = {
  POSITIVO: 'Positivo',
  DESENVOLVIMENTO: 'Desenvolvimento',
  ACORDO: 'Acordo',
};
export const ROTULO_STATUS_ACOMP: Record<StatusAcompanhamento, string> = {
  PENDENTE: 'Pendente', REALIZADO: 'Realizado', CANCELADO: 'Cancelado',
};

/**
 * Diz se um cargo indica liderança.
 *
 * A comparação ignora acento, caixa e espaços extras: o gestor digita
 * "Coordenador", "coordenador " ou "COORDENADOR" e o sistema trata igual.
 * Sem `normalize`, um acento esquecido tiraria a pessoa da lista de líderes
 * sem que ninguém percebesse — e a indicação de leadership sumiria em silêncio.
 */
export function cargoIndicaLideranca(cargo: string | null | undefined): boolean {
  if (!cargo) return false;
  const limpo = cargo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  if (!limpo) return false;
  return TERMOS_LIDERANCA.some((termo) => {
    const t = termo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    // Palavra inteira, não substring: "AJUDANTE" não vira líder por conter
    // parte de um termo, e "LIDERANÇA" cobre o cargo inteiro.
    return new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`).test(limpo);
  });
}

/**
 * Palavras que a IA NÃO pode usar.
 *
 * Não é filtro cosmético: é a fronteira entre "dado" e "julgamento". Um
 * relatório de liderança que escreve "emocionalmente instável" ou "não tem
 * perfil de liderança" está afirmando saúde mental e aptidão — e nenhuma das
 * duas coisas é dado que o NEXUS tenha. A sugestão que usar um desses termos
 * é DESCARTADA, não corrigida: um texto que precisa ser aparado para não
 * julgar não é um texto seguro.
 */
export const TERMOS_PROIBIDOS = [
  'emocionalmente instavel', 'emocionalmente instável', 'instabilidade emocional',
  'instavel emocionalmente', 'instável emocionalmente',
  'depressao', 'depressão', 'ansiedade', 'burnout', 'transtorno',
  'psicologico', 'psicológico', 'psiquiatr', 'diagnostico', 'diagnóstico',
  'nao apto', 'não apto', 'nao serve', 'não serve', 'nao tem perfil',
  'não tem perfil', 'incapaz', 'incompetente', 'deve ser demitid', 'demissao', 'demissão',
  'demitir', 'demotivar',
] as const;

/** Termos que caracterizam linguagem de sugestão, não de veredito. */
export const TERMOS_SUGESTAO = [
  'sugere', 'sugestao', 'sugestão', 'considerar', 'considere', 'pode', 'poderia',
  'oportunidade', 'ponto de atencao', 'ponto de atenção', 'vale avaliar', 'recomenda-se',
  'recomendacao', 'recomendação', 'proximo passo', 'próximo passo', 'acompanhar',
] as const;

/** Frases que são PIORES que um diagnóstico, porque parecem dado medido. */
export const FRASES_JULGAMENTO = [
  'tem problema de', 'problema de gestao de tempo', 'nao consegue lidar',
  'não consegue lidar', 'e um problema', 'é um problema', 'so tem problema',
] as const;

export type ResultadoLinguagem =
  | { ok: true }
  | { ok: false; motivo: string; termos: string[] };

/**
 * Verifica se um texto da IA ficou dentro da linguagem permitida.
 *
 * Roda sobre a sugestão INTEIRA antes de ela chegar ao gestor, e vale tanto
 * para o título da ação quanto para a justificativa.
 */
export function verificarLinguagem(...textos: Array<string | null | undefined>): ResultadoLinguagem {
  for (const bruto of textos) {
    if (!bruto) continue;
    const norm = bruto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const proibido of TERMOS_PROIBIDOS) {
      const p = proibido.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (norm.includes(p)) {
        return { ok: false, motivo: `A sugestão usou "${bruto.slice(0, 80)}", que afirma algo que o NEXUS não mede.`, termos: [proibido] };
      }
    }
    for (const julgamento of FRASES_JULGAMENTO) {
      const j = julgamento.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (norm.includes(j)) {
        return { ok: false, motivo: `A sugestão usou "${bruto.slice(0, 80)}", que soa como julgamento sobre a pessoa.`, termos: [julgamento] };
      }
    }
  }
  return { ok: true };
}

// ===========================================================================
//  GESTÃO DE TEMPO — jornada prevista x realizada
// ===========================================================================
//  Isto NÃO é um cronômetro. É a comparação entre o que o PONTO registra e o
//  que a jornada PREVISTA define — e a conta é feita sobre o mesmo
//  `minutosTrabalhados` que a folha usa, de propósito: jornada apurada na
//  folha e jornada mostrada aqui têm de ser o mesmo número, senão o gestor vê
//  o holerito discordar da tela.

/** Minutos de um `HH:MM`. `null` se o horário não existir. */
export function minutosDeHHMM(hora: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Minutos de jornada previstos por dia, a partir dos horários previstos.
 *
 * Desconta o intervalo se o horário de saída for maior que 6h de diferença
 * entre entrada — sem isso, uma jornada 08:00-18:00 (10h) seria contada como
 * 600 min quando a jornada de verdade é 8h + 1h de almoço.
 *
 * O intervalo é HIPÓTESE declarada, não medição: ninguém bateu o almoço. O
 * mesmo `60` que `minutosTrabalhados` usa quando não há batida de intervalo.
 */
export const INTERVALO_PADRAO_MIN = 60;

export function minutosPrevistosPorDia(
  entradaPrevista: string | null | undefined,
  saidaPrevista: string | null | undefined,
): number | null {
  const ent = minutosDeHHMM(entradaPrevista);
  const sai = minutosDeHHMM(saidaPrevista);
  if (ent === null || sai === null || sai <= ent) return null;
  const bruto = sai - ent;
  return bruto > 6 * 60 ? bruto - INTERVALO_PADRAO_MIN : bruto;
}

export type ResumoJornadaPessoa = {
  funcionarioId: string;
  nome: string;
  departamento: string | null;
  cargo: string | null;
  /** `false` quando não há horário previsto cadastrado — a jornada prevista
   *  não é estimada, e a comparação simplesmente não é feita. */
  temJornadaPrevista: boolean;
  diasTrabalhados: number;
  minutosPrevistos: number | null;
  minutosTrabalhados: number;
  minutosExtras: number;
  minutosAtraso: number;
  diasAtraso: number;
  faltas: number;
  /** Intervalos FORA do padrão: existe batida, mas não segue a referência. */
  intervalosIrregulares: number;
  diasSemBatida: number;
};

export function resumoJornada(
  p: Omit<ResumoJornadaPessoa, 'temJornadaPrevista'>,
  minutosPrevistosDia: number | null,
): ResumoJornadaPessoa {
  return {
    ...p,
    temJornadaPrevista: minutosPrevistosDia !== null,
    minutosPrevistos: minutosPrevistosDia === null ? null : minutosPrevistosDia * p.diasTrabalhados,
  };
}

/**
 * Classifica um intervalo registrado.
 *
 * "Irregular" significa: a pessoa bateu intervalo, e ele não segue a
 * referência. NÃO é erro nem falta de disciplina — ponto importado de
 * equipamento legado costuma vir assim, e a tela diz o que é, sem converter
 * dado em julgamento.
 */
export function intervaloIrregular(
  saidaIntervaloMin: number | null,
  retornoIntervaloMin: number | null,
  referenciaMin: number = INTERVALO_PADRAO_MIN,
): boolean {
  if (saidaIntervaloMin === null || retornoIntervaloMin === null) return false;
  const real = retornoIntervaloMin - saidaIntervaloMin;
  if (real <= 0) return true;
  // Tolerância de 10 min: quem sai 12:02 e volta 13:00 não fez intervalo irregular.
  return Math.abs(real - referenciaMin) > 10;
}

// ===========================================================================
//  IA — sugestão de onde olhar
// ===========================================================================
//  REGRA CENTRAL: a IA recebe CONTAGENS AGREGADAS e devolve SUGESTÕES. Nunca
//  recebe a lista de quem está em dúvida e nunca devolve veredito sobre uma
//  pessoa. Ela sugere uma AÇÃO ("considere um feedback com o time de Vendas"),
//  e a justificativa só sobrevive se citar número que existe no contexto — a
//  mesma trava anti-hallucination do Ciclo 2, reaproveitada.

export const PAPEL_ASSISTENTE_LIDERANCA = [
  'Você é o assistente de liderança do NEXUS OS, em português do Brasil.',
  'Você SUGERE onde o gestor pode olhar. Você nunca registra, nunca agenda e nunca decide.',
  '',
  'VOCÊ TRABALHA COM INDICADORES AGREGADOS. Nenhuma análise sua é sobre uma pessoa.',
  'Você não recebe nome, cargo, CPF nem id de funcionário — e não deve pedi-los.',
  '',
  'PROIBIDO (sem exceção):',
  '- diagnosticar saúde mental, ansiedade, depressão, burnout ou qualquer transtorno;',
  '- afirmar que alguém é emocionalmente instável, incapaz ou não tem perfil de liderança;',
  '- recomendar contratação, promoção, demissão, punição ou despejo;',
  '- inventar número, percentual ou indicador que não esteja nos dados enviados;',
  '- afirmar que um feedback, treinamento ou plano "foi realizado" — você não registra o passado;',
  '- usar "não consegue lidar", "tem problema de" ou similar: soam como julgamento sobre',
  '  a pessoa, e o NEXUS só mostra dado.',
  '',
  'LINGUAGEM OBRIGATÓRIA: sugestão, possibilidade, ponto de atenção, oportunidade de',
  'desenvolvimento, "considere", "vale avaliar", "próximo passo".',
  '',
  'Formato: responda SOMENTE com JSON válido, sem markdown, sem texto fora do JSON:',
  '{"sugestao":"ação a considerar, 1 frase","publico":"departamento OU equipe, em 1 frase",',
  '"prioridade":"BAIXA|MEDIA|ALTA","justificativa":"1-2 frases citando os dados recebidos",',
  '"perguntasAcompanhamento":["pergunta"]}',
  '',
  'Regras de conteúdo:',
  '- "prioridade" deve ser BAIXA, MEDIA ou ALTA.',
  '- "justificativa" só pode citar números que estejam no contexto recebido.',
  '- Se os dados não sustentarem nada, responda com "sugestao" vazia e explique em',
  '  "perguntasAcompanhamento" o que falta.',
].join('\n');

export type ContextoLideranca = {
  periodo: string;
  totais: {
    /** Pessoas com cargo que indica liderança. */
    liderancas: number;
    /** Feedbacks registrados no período. */
    feedbacks: number;
    /** Feedbacks com acompanhamento marcado e ainda não realizado. */
    acompanhamentosPendentes: number;
    /** Planos de desenvolvimento ativos. */
    planosAtivos: number;
    /** Treinamentos concluídos com presença. */
    treinamentosConcluidos: number;
  };
  /** Um item por departamento. NUNCA por pessoa. */
  departamentos: Array<{
    nome: string;
    liderancas: number;
    pessoas: number;
    feedbacks: number;
    acompanhamentosPendentes: number;
    horasExtrasMin: number;
    atrasosDias: number;
  }>;
  opcoes: { tipoFeedback: readonly string[] };
};

export function montarContextoLideranca(ctx: ContextoLideranca) {
  return {
    periodo: ctx.periodo,
    totaisDaEmpresa: ctx.totais,
    porDepartamento: ctx.departamentos,
    opcoes: ctx.opcoes,
  };
}

function texto(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length === 0 ? null : t.slice(0, max);
}

function numerosNoTexto(t: string): string[] {
  return t.match(/\d[\d.,]*/g) ?? [];
}

/** Mesma trava do Ciclo 2: a justificativa só cita número que foi enviado. */
export function conferirNumerosCitados(justificativa: string, contexto: unknown): string[] {
  const permitidos = new Set(
    numerosNoTexto(JSON.stringify(contexto)).map((n) => n.replace(/[.,]/g, '')).filter(Boolean),
  );
  return numerosNoTexto(justificativa).filter((n) => !permitidos.has(n.replace(/[.,]/g, '')));
}

export type SugestaoLideranca = {
  ok: true;
  sugestao: {
    sugestao: string;
    publico: string;
    prioridade: 'BAIXA' | 'MEDIA' | 'ALTA';
    justificativa: string;
    perguntasAcompanhamento: string[];
  };
  numerosNaoVerificados: string[];
  descartes: string[];
};
export type ResultadoSugestaoLideranca =
  | SugestaoLideranca
  | { ok: false; motivo: string; dadosInsuficientes: boolean };

/**
 * Valida a sugestão de liderança em DUAS camadas.
 *
 * 1. FORMATO — valores fora do catálogo são descartados.
 * 2. LINGUAGEM — `verificarLinguagem` barra qualquer coisa que soe a
 *    diagnóstico ou veredito. Um texto que precisasse ser aparado para não
 *    julgar não chega ao gestor.
 */
export function validarSugestaoLideranca(bruto: unknown, contexto: unknown): ResultadoSugestaoLideranca {
  const descartes: string[] = [];
  if (!bruto || typeof bruto !== 'object') {
    return { ok: false, motivo: 'A IA não devolveu uma estrutura reconhecível.', dadosInsuficientes: false };
  }
  const o = bruto as Record<string, unknown>;

  const sugestao = texto(o.sugestao, 240);
  if (!sugestao) {
    return { ok: false, motivo: 'Dados insuficientes para gerar uma recomendação.', dadosInsuficientes: true };
  }
  const publico = texto(o.publico, 160) ?? '';
  const prioridade = ['BAIXA', 'MEDIA', 'ALTA'].find((v) => v === o.prioridade) ?? null;
  if (o.prioridade != null && !prioridade) {
    descartes.push(`Prioridade "${String(o.prioridade).slice(0, 20)}" fora do catálogo.`);
  }

  let justificativa = texto(o.justificativa, 600) ?? '';
  const numerosNaoVerificados = conferirNumerosCitados(justificativa, contexto);
  if (numerosNaoVerificados.length > 0) {
    descartes.push(
      `Justificativa descartada: citou ${numerosNaoVerificados.join(', ')}, que não existe nos dados enviados.`,
    );
    justificativa = '';
  }

  // A trava de linguagem, sobre a sugestão E sobre a justificativa.
  const linguagem = verificarLinguagem(sugestao, justificativa, publico);
  if (!linguagem.ok) {
    return { ok: false, motivo: linguagem.motivo, dadosInsuficientes: false };
  }

  const perguntas = (Array.isArray(o.perguntasAcompanhamento) ? o.perguntasAcompanhamento : [])
    .map((p) => texto(p, 200)).filter((p): p is string => p !== null).slice(0, 5);

  return {
    ok: true,
    sugestao: {
      sugestao,
      publico,
      prioridade: (prioridade ?? 'MEDIA') as 'BAIXA' | 'MEDIA' | 'ALTA',
      justificativa,
      perguntasAcompanhamento: perguntas,
    },
    numerosNaoVerificados,
    descartes,
  };
}

/**
 * Chama a IA para sugerir onde o gestor pode olhar.
 *
 * Devolve `ok: false` em TODO caminho de falha. A rota responde 200 com
 * `sugestao: null` e o motivo; nunca 500.
 */
export async function sugerirLideranca(ctx: ContextoLideranca): Promise<
  | { ok: true; analise: Record<string, unknown>; numerosNaoVerificados: string[]; descartes: string[] }
  | { ok: false; motivo: string; dadosInsuficientes: boolean }
> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, motivo: 'GEMINI_API_KEY não configurada no ambiente.', dadosInsuficientes: false };
  }
  const contexto = montarContextoLideranca(ctx);
  const r = await consultarComTentativas(
    `Analise os indicadores abaixo e sugira ONDE o gestor pode olhar na liderança.\n\nDADOS:\n${JSON.stringify(contexto)}`,
    { papel: PAPEL_ASSISTENTE_LIDERANCA, temperatura: 0.4, maxTokens: 4000 },
    3,
  );
  if (!r.ok) return { ok: false, motivo: r.motivo, dadosInsuficientes: false };

  const json = extrairJsonTexto(r.texto);
  if (json === null) return { ok: false, motivo: 'A IA não devolveu JSON válido.', dadosInsuficientes: false };

  const validado = validarSugestaoLideranca(json, contexto);
  if (!validado.ok) {
    return { ok: false, motivo: validado.motivo, dadosInsuficientes: validado.dadosInsuficientes };
  }
  return {
    ok: true,
    analise: {
      ...validado.sugestao,
      descartes: validado.descartes,
      numerosNaoVerificados: validado.numerosNaoVerificados,
      dadosConsiderados: { periodo: ctx.periodo, totaisDaEmpresa: ctx.totais },
    },
    numerosNaoVerificados: validado.numerosNaoVerificados,
    descartes: validado.descartes,
  };
}

/**
 * Retry só para falha TRANSITÓRIA (429/5xx/timeout/alta demanda). Cota e falha
 * de conteúdo não são transitórias: a API responde "retry in 39s", e esperar
 * isso dentro de uma requisição travaria a tela do gestor por mais tempo do
 * que a espera por ela.
 */
async function consultarComTentativas(
  pergunta: string,
  opcoes: { papel: string; temperatura: number; maxTokens: number },
  tentativas: number,
): Promise<Awaited<ReturnType<typeof consultarIA>>> {
  const TRANSIENTE = /high demand|overloaded|429|500|502|503|504|unavailable|timed out|esgotado|Fetch failed|ECONNRESET|ENOTFOUND/i;
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
//  Acompanhamento
// ===========================================================================

/**
 * Resumo dos indicadores de liderança.
 *
 * `liderancas` vem do CARGO (decisão sua), não de um campo novo. Quando
 * `liderancas` é 0, a tela escreve que nenhum cargo indica liderança — e não
 * trata as três primeiras pessoas como líderes por perto.
 */
export function resumoLideranca(input: {
  liderancas: number;
  feedbacks: number;
  acompanhamentosPendentes: number;
  proximosVencidos: number;
  planosAtivos: number;
  treinamentosConcluidos: number;
  liderancasComFeedback: number;
}): {
  liderancas: number;
  feedbacks: number;
  acompanhamentosPendentes: number;
  proximosVencidos: number;
  planosAtivos: number;
  treinamentosConcluidos: number;
  liderancasComFeedback: number;
  /** `null` quando não há líder identificado — não 0%, que pareceria "ninguém tem feedback". */
  coberturaFeedback: number | null;
} {
  return {
    ...input,
    coberturaFeedback: input.liderancas === 0 ? null : Math.round((input.liderancasComFeedback / input.liderancas) * 100),
  };
}

/** Acompanhamento atrasado é o que o gestor precisa ver primeiro. */
export function acompanhamentoVencido(
  proximoAcompanhamento: Date | string | null,
  hoje: Date,
): boolean {
  if (!proximoAcompanhamento) return false;
  const d = proximoAcompanhamento instanceof Date
    ? proximoAcompanhamento
    : new Date(`${String(proximoAcompanhamento).slice(0, 10)}T12:00:00`);
  const hj = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 12));
  return d < hj;
}

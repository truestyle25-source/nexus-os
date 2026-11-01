/**
 * QUESTIONÁRIO DISC — a fonte da verdade do cálculo.
 *
 * Por que mora no BACKEND e não no navegador:
 *
 *  - é a FONTE DA VERDADE do cálculo. Se o front calculasse os percentuais, ele
 *    poderia divergir do que o Radar mostra, e ninguém teria como conferir;
 *  - o texto das perguntas é conteúdo do produto versionado. Mudar a metodologia
 *    invalida a comparação entre avaliações, então precisa de histórico, não de
 *    um deploy de front;
 *  - o cálculo precisa ser auditável: a partir das alternativas marcadas o
 *    servidor deriva D/I/S/C, e o número gravado é sempre esse.
 *
 * METODOLOGIA (adaptada do modelo de Marston, com forced-choice). Cada pergunta
 * oferece 4 alternativas; cada alternativa vale pontos para exatamente UM
 * fator. Isso evita o viés de quem "quer dar nota alta" em todos os itens: o
 * respondente escolhe entre opções, não concorda com afirmações.
 *
 * O respondente NÃO vê qual alternativa alimenta qual fator. Ver a alternativa,
 * ou o resultado da sua própria avaliação, seria medir o que a pessoa espera da
 * empresa, e não como ela age.
 *
 * TRÊS REGRAS QUE O MODELO NÃO CUMPRE, por escolha declarada:
 *  1. não mede capacidade, inteligência ou desempenho;
 *  2. não é diagnóstico psicológico e não serve para laudo;
 *  3. não diz se alguém é adequado a um cargo. Quem decide isso é o gestor, com
 *     o resultado como UM dos insumos — nunca como veredito.
 */
export type FatorDisc = 'D' | 'I' | 'S' | 'C';

export const FATORES_DISC: FatorDisc[] = ['D', 'I', 'S', 'C'];

export const NOMES_FATOR: Record<FatorDisc, string> = {
  D: 'Dominância',
  I: 'Influência',
  S: 'Estabilidade',
  C: 'Conformidade',
};

export const DESCRICAO_FATOR: Record<FatorDisc, string> = {
  D: 'Age para avançar rápido; prioriza resultado sobre consenso.',
  I: 'Busca interlocução e alinhamento; comunica e mobiliza pessoas.',
  S: 'Valoriza previsibilidade e permanência; sustenta o time.',
  C: 'Prioriza precisão, norma e procedimento; evita risco.',
};

export type AlternativaDisc = {
  id: string;
  texto: string;
  /** Ponto que a alternativa dá ao fator. Uma alternativa, um fator. */
  fator: FatorDisc;
};

export type PerguntaDisc = {
  id: string;
  texto: string;
  alternativas: AlternativaDisc[];
};


/**
 * As 12 perguntas.
 *
 * Cada bloco de 4 alternativas é uma escolha forçada: as quatro cobrem D, I, S e
 * C exatamente uma vez, na ordem canônica. Assim, responder N perguntas
 * distribui N pontos, um por fator — e o percentual de cada um é a fatia desse
 * total.
 */
export const QUESTIONARIO_DISC: PerguntaDisc[] = [
  {
    id: 'q1',
    texto: 'Quando há um prazo apertado, você:',
    alternativas: [
      { id: 'a', texto: 'Assume a frente e organiza o trabalho para caber no prazo', fator: 'D' },
      { id: 'b', texto: 'Pede apoio a quem conhece o tema e combina uma apresentação ao time', fator: 'I' },
      { id: 'c', texto: 'Mantém o ritmo que sempre funcionou e evita mudar a rotina agora', fator: 'S' },
      { id: 'd', texto: 'Confere o procedimento e a lista de checagem antes de começar', fator: 'C' },
    ],
  },
  {
    id: 'q2',
    texto: 'Em uma reunião com ideias conflitantes, você tende a:',
    alternativas: [
      { id: 'a', texto: 'Cortar a discussão e decidir o que fazer agora', fator: 'D' },
      { id: 'b', texto: 'Construir uma narrativa que convença a turma a favor de uma ideia', fator: 'I' },
      { id: 'c', texto: 'Buscar o consenso para não deixar ninguém de fora', fator: 'S' },
      { id: 'd', texto: 'Levantar dados para decidir com base em evidência', fator: 'C' },
    ],
  },
  {
    id: 'q3',
    texto: 'Sobre mudança de plano no meio do trabalho, sua reação é:',
    alternativas: [
      { id: 'a', texto: 'Replanejar rápido e seguir, sem perder o ritmo', fator: 'D' },
      { id: 'b', texto: 'Comunicar a mudança e ouvir como o time se sente com ela', fator: 'I' },
      { id: 'c', texto: 'Preferir a menor mudança possível para não desorganizar o time', fator: 'S' },
      { id: 'd', texto: 'Revisar o plano para que ele continue claro e rastreável', fator: 'C' },
    ],
  },
  {
    id: 'q4',
    texto: 'Um colega está com dificuldade. Você:',
    alternativas: [
      { id: 'a', texto: 'Ajudar a resolver agora, lado a lado', fator: 'D' },
      { id: 'b', texto: 'Conversar com ele para entender o que ele precisa', fator: 'I' },
      { id: 'c', texto: 'Ficar disponível para ele no dia a dia, sem alarde', fator: 'S' },
      { id: 'd', texto: 'Mostrar o procedimento que costuma resolver esse tipo de caso', fator: 'C' },
    ],
  },
  {
    id: 'q5',
    texto: 'Recebe uma tarefa nova e ambígua. A primeira pergunta é:',
    alternativas: [
      { id: 'a', texto: 'Qual o resultado que precisa existir até sexta?', fator: 'D' },
      { id: 'b', texto: 'Quem mais do time seria útil envolvido nisso?', fator: 'I' },
      { id: 'c', texto: 'Como isso se encaixa no que o time já faz?', fator: 'S' },
      { id: 'd', texto: 'Quais são os critérios de pronto e o padrão a seguir?', fator: 'C' },
    ],
  },
  {
    id: 'q6',
    texto: 'Quando o resultado não sai como esperado, você prioriza:',
    alternativas: [
      { id: 'a', texto: 'Correr atrás do que faltou e recuperar o prazo', fator: 'D' },
      { id: 'b', texto: 'Explicar a situação e reforçar a confiança do time', fator: 'I' },
      { id: 'c', texto: 'Garantir que o time consiga continuar trabalhando junto', fator: 'S' },
      { id: 'd', texto: 'Entender por que o processo não produziu o esperado', fator: 'C' },
    ],
  },
  {
    id: 'q7',
    texto: 'Quanto à decisão de ir por um caminho ainda não testado:',
    alternativas: [
      { id: 'a', texto: 'Vou de frente — o risco faz parte do resultado', fator: 'D' },
      { id: 'b', texto: 'Vou, e levo comigo quem está animado para a mudança', fator: 'I' },
      { id: 'c', texto: 'Só vou se ninguém for surpreendido depois', fator: 'S' },
      { id: 'd', texto: 'Só vou com o risco mapeado e um plano B definido', fator: 'C' },
    ],
  },
  {
    id: 'q8',
    texto: 'O que mais pesa na sua avaliação de um trabalho bem feito:',
    alternativas: [
      { id: 'a', texto: 'Entregou no prazo e superou o esperado', fator: 'D' },
      { id: 'b', texto: 'O time se engageu e as pessoas reconheceram', fator: 'I' },
      { id: 'c', texto: 'Não quebrou o funcionamento que já existia', fator: 'S' },
      { id: 'd', texto: 'Seguiu o padrão e deixou tudo documentado', fator: 'C' },
    ],
  },
  {
    id: 'q9',
    texto: 'Sobre feedback recebido de um gestor:',
    alternativas: [
      { id: 'a', texto: 'Uso como direção para ajustar e fazer mais no próximo ciclo', fator: 'D' },
      { id: 'b', texto: 'Converso sobre ele e construo um plano com o gestor', fator: 'I' },
      { id: 'c', texto: 'Levo em conta e mudo o que for para não desarrumar o time', fator: 'S' },
      { id: 'd', texto: 'Peço que venha por escrito, com exemplo concreto', fator: 'C' },
    ],
  },
  {
    id: 'q10',
    texto: 'Um projeto importante precisa do esforço de mais de uma área. Você:',
    alternativas: [
      { id: 'a', texto: 'Defino o que é prioridade e aloco o que for preciso', fator: 'D' },
      { id: 'b', texto: 'Mobilizo as áreas mostrando o ganho para cada uma', fator: 'I' },
      { id: 'c', texto: 'Busco a ação que cause menos atrito entre as áreas', fator: 'S' },
      { id: 'd', texto: 'Levanto o processo atual para achar a ação que cabe a cada área', fator: 'C' },
    ],
  },
  {
    id: 'q11',
    texto: 'Você recebe um pedido fora da sua responsabilidade. Responde:',
    alternativas: [
      { id: 'a', texto: 'Se é prioridade, faço e aviso que assumi', fator: 'D' },
      { id: 'b', texto: 'Pergunto o contexto e ajudo do jeito que for mais útil', fator: 'I' },
      { id: 'c', texto: 'Dou uma mão se não comprometer o que já está sob minha responsabilidade', fator: 'S' },
      { id: 'd', texto: 'Encaminho a quem é da responsabilidade e explicito o motivo', fator: 'C' },
    ],
  },
  {
    id: 'q12',
    texto: 'A equipe perdeu o ritmo nas últimas semanas. Você age:',
    alternativas: [
      { id: 'a', texto: 'Mudo a prioridade e desenho um plano para destravar', fator: 'D' },
      { id: 'b', texto: 'Converso com o time para descobrir o que está travando', fator: 'I' },
      { id: 'c', texto: 'Retomo o ritmo anterior, que funcionava', fator: 'S' },
      { id: 'd', texto: 'Reviso onde o processo parou de servir', fator: 'C' },
    ],
  },
];

export const TOTAL_PERGUNTAS_DISC = QUESTIONARIO_DISC.length;

/**
 * Resultado do questionário: percentuais por fator + perfil predominante.
 *
 * `percentuais` SEMPRE soma 100 (arredondado). As respostas dão pontos por
 * fator; o percentual é a fatia desses pontos. Ver `calcularDisc`.
 */
export type ResultadoDisc = {
  D: number;
  I: number;
  S: number;
  C: number;
  predominante: FatorDisc;
  /** Pontos brutos por fator, para auditoria. */
  pontos: Record<FatorDisc, number>;
  answered: number;
  total: number;
};

/**
 * Calcula D/I/S/C a partir das alternativas marcadas.
 *
 * Regras do cálculo, todas declaradas para que o número seja conferível:
 *
 *  1. Cada alternativa marcada vale 1 ponto para o SEU fator. É a única
 *     abordagem que não deixa o respondente "distribuir" pontos como quiser.
 *  2. O percentual de cada fator é sua fatia sobre o total marcado. Como cada
 *     pergunta distribui exatamente 1 ponto, o total é o número de perguntas
 *     respondidas.
 *  3. A soma é 100 por construção. O arredondamento de cada fator pode somar 99
 *     ou 101 em meios pontos, então a diferença é jogada no FATOR PREDOMINANTE
 *     — o maior, que é o único que a tela destaca e o único que muda de verdade.
 *  4. Empate: desempate na ordem clássica D > I > S > C (dos fatores mais ativos
 *     para os mais passivos). Declarado porque o modelo precisa escolher um, e
 *     não pode ser "o primeiro que aparecer na lista".
 *  5. Pergunta sem resposta NÃO conta como zero. O resultado só é gerado sobre
 *     o questionário completo, e a rota recusa salvar avaliação incompleta.
 */
export function calcularDisc(
  respostas: Array<{ perguntaId: string; alternativaId: string }>,
): ResultadoDisc {
  // Uma resposta por pergunta: a ÚLTIMA ocorrência vence, para o caso de o
  // cliente reenviar o formulário inteiro. Índice por pergunta evita contar a
  // mesma duas vezes.
  const ultimaPorPergunta = new Map<string, string>();
  for (const r of respostas) {
    if (!QUESTIONARIO_DISC.some((p) => p.id === r.perguntaId)) continue;
    ultimaPorPergunta.set(r.perguntaId, r.alternativaId);
  }

  const respondidas = new Set<string>();
  const pontos: Record<FatorDisc, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const [perguntaId, alternativaId] of ultimaPorPergunta) {
    const pergunta = QUESTIONARIO_DISC.find((p) => p.id === perguntaId)!;
    const alt = pergunta.alternativas.find((a) => a.id === alternativaId);
    if (!alt) continue;
    respondidas.add(perguntaId);
    pontos[alt.fator] += 1;
  }

  const answered = respondidas.size;
  const total = TOTAL_PERGUNTAS_DISC;

  if (answered === 0) {
    return { D: 0, I: 0, S: 0, C: 0, predominante: 'D', pontos, answered, total };
  }

  const arredondado: Record<FatorDisc, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const f of FATORES_DISC) {
    arredondado[f] = Math.round((pontos[f] / answered) * 100);
  }
  let soma = FATORES_DISC.reduce((s, f) => s + arredondado[f], 0);

  // Desempate na ordem clássica D > I > S > C: `reduce` só troca quando o
  // candidato tem MAIS pontos, então em empate o anterior (mais ativo) fica.
  const predominante = FATORES_DISC.reduce(
    (melhor, f) => (pontos[f] > pontos[melhor] ? f : melhor),
    'D' as FatorDisc,
  );

  // Ajusta o arredondamento até bater 100. Prioriza o predominante e, se ele já
  // estiver no limite, o próximo maior — nunca gera percentual impossível.
  const ordemAjuste: FatorDisc[] = [
    predominante,
    ...FATORES_DISC.filter((f) => f !== predominante).sort((x, y) => pontos[y] - pontos[x]),
  ];
  let i = 0;
  while (soma !== 100 && i < ordemAjuste.length * 100) {
    const passo = soma < 100 ? 1 : -1;
    const f = ordemAjuste[i % ordemAjuste.length];
    if (arredondado[f] + passo >= 0 && arredondado[f] + passo <= 100) {
      arredondado[f] += passo;
      soma += passo;
    }
    i++;
  }

  return { ...arredondado, predominante, pontos, answered, total };
}

/**
 * REGRA DE VIGÊNCIA de uma avaliação comportamental.
 *
 * Vence a avaliação de DATA MAIS RECENTE, e não a última gravada. As duas coisas
 * só costumam coincidir; divergem quando o RH registra uma avaliação antiga
 * depois de uma nova (o questionário foi aplicado em 10/09 mas só lançado hoje,
 * depois de uma de 28/09). Se a vigência fosse "a última gravada", o Radar
 * passaria a exibir o perfil velho como se fosse o atual, sem nenhum aviso.
 *
 * Devolve os ids que devem ficar com `vigente: true` — no máximo um. Os demais
 * vão para `false`, mas continuam no histórico.
 *
 * Desempate de data: vence a registrada mais recentemente (`createdAt`). É
 * arbitrário, porém DETERMINÍSTICO — a mesma entrada produz sempre a mesma
 * saída, que é o que permite testar.
 *
 * Fica aqui, e não na rota, porque é regra de negócio do modelo DISC e precisa
 * ser testável sem subir servidor nem banco.
 */
export function definirVigenciasDisc<T extends { id: string; dataAvaliacao: Date; createdAt: Date }>(
  avaliacoes: T[],
): { vigenteId: string | null; desligarIds: string[] } {
  if (avaliacoes.length === 0) return { vigenteId: null, desligarIds: [] };

  const ordenada = [...avaliacoes].sort(
    (a, b) =>
      b.dataAvaliacao.getTime() - a.dataAvaliacao.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const [vencedora] = ordenada;
  return {
    vigenteId: vencedora.id,
    desligarIds: ordenada.slice(1).map((a) => a.id),
  };
}

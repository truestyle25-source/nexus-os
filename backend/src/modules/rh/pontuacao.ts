// ===========================================================================
//  PONTUAÇÃO CONFIGURÁVEL POR EMPRESA — Ciclo 5
//  Regras puras: o que o NEXUS mede, compara e credita.
// ===========================================================================
//
//  A LINHA QUE SEPARA ESTE ARQUIVO DE UMA POLÍTICA DO NEXUS
//  -------------------------------------------------------
//  Aqui não existe "quanto vale absenceiro". Existe apenas a pergunta que o
//  banco consegue responder, o operador de comparação, e a aritmética. O
//  VALOR e a QUANTIDADE DE PONTOS chegam como argumento, sempre da empresa.
//
//  Um teste que prova isso: `cumprE()` funciona igual com 10 pontos ou com
//  10.000. Se este arquivo tivesse um `pontos: 10` fixo, a política do NEXUS
//  estaria valendo para toda empresa do sistema — o oposto do que o ciclo
//  pediu.
//
//  POR QUE MEDIR É SEPARADO DE COMPARAR
//  ------------------------------------
//  A rota faz as consultas ao banco; `cumprE` é aritmética pura, testável sem
//  banco. Separar mantém a regra verificável: se a consulta de falta mudar
//  amanhã, ninguém precisa reavaliar se a comparação está certa.

export const EVENTOS = [
  'SEM_FALTA', 'SEM_ATRASO', 'SEM_ADVERTENCIA', 'META_BATIDA',
  'TREINAMENTO_PRESENTE', 'HORAS_EXTRAS', 'VENDAS_NO_PERIODO',
] as const;
export type EventoPontuacao = (typeof EVENTOS)[number];

export const OPERADORES = ['IGUAL', 'MAIOR_OU_IGUAL', 'MENOR_OU_IGUAL'] as const;
export type OperadorCriterio = (typeof OPERADORES)[number];

export const PERIODOS = ['MENSAL', 'TRIMESTRAL', 'ANUAL'] as const;
export type PeriodoCriterio = (typeof PERIODOS)[number];

/**
 * Rótulo e unidade de cada evento.
 *
 * Isto NÃO é uma lista de metas nem de valores: é o dicionário do que o NEXUS
 * consegue VERIFICAR. O evento é a pergunta; a empresa escolhe se quer perguntar
 * e quanto pagar pela resposta. A tela usa estes rótulos para explicar por que
 * um critério foi ou não creditado.
 */
export const DESCRICAO_EVENTO: Record<EventoPontuacao, { rotulo: string; unidade: string; explicacao: string }> = {
  SEM_FALTA: {
    rotulo: 'Faltas',
    unidade: 'faltas',
    explicacao: 'Quantas faltas o funcionário teve no período. Compare com 0 para premiar quem não faltou.',
  },
  SEM_ATRASO: {
    rotulo: 'Atrasos',
    unidade: 'minutos',
    explicacao: 'Minutos de atraso somados no período.',
  },
  SEM_ADVERTENCIA: {
    rotulo: 'Advertências',
    unidade: 'advertências',
    explicacao: 'Quantas advertências o funcionário recebeu no período.',
  },
  META_BATIDA: {
    rotulo: 'Meta',
    unidade: '%',
    explicacao: 'Percentual atingido nas metas do próprio funcionário. 100 significa a meta batida.',
  },
  TREINAMENTO_PRESENTE: {
    rotulo: 'Treinamentos',
    unidade: 'presenças',
    explicacao: 'Quantos treinamentos o funcionário esteve PRESENTE no período. O sistema não guarda "conclusão" de curso, só presença.',
  },
  HORAS_EXTRAS: {
    rotulo: 'Horas extras',
    unidade: 'minutos',
    explicacao: 'Minutos de hora extra somados no período.',
  },
  VENDAS_NO_PERIODO: {
    rotulo: 'Vendas',
    unidade: 'reais',
    explicacao: 'Valor total vendido pelo funcionário no período, em reais inteiros.',
  },
};

export const ROTULO_OPERADOR: Record<OperadorCriterio, string> = {
  IGUAL: 'igual a',
  MAIOR_OU_IGUAL: 'no mínimo',
  MENOR_OU_IGUAL: 'no máximo',
};

export const ROTULO_PERIODO: Record<PeriodoCriterio, string> = {
  MENSAL: 'Mensal',
  TRIMESTRAL: 'Trimestral',
  ANUAL: 'Anual',
};

/**
 * Aplica o operador da empresa sobre o valor medido.
 *
 * Devolve `false` — nunca lança — quando o operador é desconhecido. Um
 * critério gravado com um operador que o código não conhece não pode ser
 * considerado "cumprido" por acidente: o padrão seguro é não creditar.
 *
 * Repare que aqui não entra nenhum valor de ponto: esta função responde
 * "cumpre ou não", e a quantidade vem do critério da empresa. É o que
 * garante que 10 pontos e 10.000 pontos se comportem igual.
 */
export function cumprE(medido: number, operador: OperadorCriterio, alvo: number): boolean {
  switch (operador) {
    case 'IGUAL': return medido === alvo;
    case 'MAIOR_OU_IGUAL': return medido >= alvo;
    case 'MENOR_OU_IGUAL': return medido <= alvo;
    default: return false;
  }
}

/**
 * Chave do período — a mesma que vai para `AvaliacaoCriterio.periodo`.
 *
 * Precisa bater com a chave UNIQUE do banco, porque é ela que impede o mesmo
 * critério de pagar duas vezes no mesmo período. Mudar este formato exige
 * migrar os históricos já gravados; por isso ele é derivado da data e não
 * guardado em coluna livre.
 */
export function chavePeriodo(periodo: PeriodoCriterio, ref: Date): string {
  const ano = ref.getUTCFullYear();
  const mes = String(ref.getUTCMonth() + 1).padStart(2, '0');
  const trimestre = Math.floor(ref.getUTCMonth() / 3) + 1;
  if (periodo === 'ANUAL') return String(ano);
  if (periodo === 'TRIMESTRAL') return `${ano}-Q${trimestre}`;
  return `${ano}-${mes}`;
}

/** Primeiro e último dia do período, em UTC. As consultas do banco usam isto. */
export function intervaloPeriodo(periodo: PeriodoCriterio, ref: Date): { inicio: Date; fim: Date } {
  const ano = ref.getUTCFullYear();
  const mes = ref.getUTCMonth();
  if (periodo === 'ANUAL') {
    return { inicio: new Date(Date.UTC(ano, 0, 1)), fim: new Date(Date.UTC(ano, 11, 31)) };
  }
  if (periodo === 'TRIMESTRAL') {
    const primeiroMes = Math.floor(mes / 3) * 3;
    return {
      inicio: new Date(Date.UTC(ano, primeiroMes, 1)),
      fim: new Date(Date.UTC(ano, primeiroMes + 3, 0)),
    };
  }
  return { inicio: new Date(Date.UTC(ano, mes, 1)), fim: new Date(Date.UTC(ano, mes + 1, 0)) };
}

/**
 * Valida um critério que a EMPRESA está cadastrando.
 *
 * Existe por causa do requisito mais forte do ciclo: não pode haver valor
 * padrão silencioso. `pontos` é obrigatório e precisa ser um número inteiro, e
 * os eventos de ausência só fazem sentido comparados com zero.
 */
export function validarCriterio(c: {
  nome: string; evento: string; operador: string; valor: number; pontos: number;
}): string[] {
  const erros: string[] = [];
  if (!c.nome || c.nome.trim().length < 2) erros.push('Informe o nome do critério.');
  if (!(EVENTOS as readonly string[]).includes(c.evento)) {
    erros.push('Escolha um evento verificável.');
    return erros;
  }
  if (!(OPERADORES as readonly string[]).includes(c.operador)) {
    erros.push('Escolha um operador de comparação válido.');
  }
  if (!Number.isInteger(c.pontos)) {
    erros.push('A quantidade de pontos deve ser um número inteiro.');
  } else if (c.pontos === 0) {
    // Zero não é erro estrutural, mas um critério que paga zero não faz nada.
    // Deixar passar esconderia um erro de digitação atrás de um cadastro válido.
    erros.push('Zero pontos não credita nada. Use um valor diferente se quiser pontuar.');
  }
  if (!Number.isFinite(c.valor) || c.valor < 0) {
    erros.push('O valor de referência não pode ser negativo.');
  }
  const contaAusencias = c.evento === 'SEM_FALTA' || c.evento === 'SEM_ADVERTENCIA' || c.evento === 'SEM_ATRASO';
  if (contaAusencias && c.operador === 'IGUAL' && c.valor !== 0) {
    erros.push('Para contar ausências, compare com 0. O evento mede a quantidade existente.');
  }
  if (c.evento === 'META_BATIDA' && c.valor > 1000) {
    erros.push('O percentual de meta não passa de 1000.');
  }
  return erros;
}

/**
 * Verifica se um lançamento manual é coerente.
 *
 * O gestor pode lançar pontos fora das regras (reconhecimento, bônus) — é
 * decisão da empresa e o ciclo pede para existir. Mas um lançamento que ZERA o
 * saldo de alguém sem dizer por quê é perigoso, então o zero é recusado e o
 * gestor precisa escrever o motivo, que é o que a pessoa verá no histórico.
 */
export function validarLancamentoManual(pontos: number, descricao: string): string[] {
  const erros: string[] = [];
  if (!Number.isInteger(pontos)) erros.push('A quantidade de pontos deve ser um número inteiro.');
  if (pontos === 0) erros.push('Zero pontos não muda nada. Lance um valor diferente.');
  if (Math.abs(pontos) > 100000) erros.push('Lançamento muito alto. Revise o valor.');
  if (!descricao || descricao.trim().length < 3) {
    erros.push('Descreva o motivo do lançamento — é o que a pessoa verá no histórico.');
  }
  return erros;
}


/**
 * A condição que A EMPRESA escreveu, em frase.
 *
 * Descreve a REGRA, não o resultado: "Faltas igual a 0", "Meta no mínimo
 * 100%". É o que a empresa configurou, e é o mesmo texto em qualquer empresa —
 * o que muda é o evento, o operador e o alvo que ela escolheu.
 */
export function descreverCondicao(c: {
  evento: EventoPontuacao; operador: OperadorCriterio; valor: number;
}): string {
  const d = DESCRICAO_EVENTO[c.evento];
  if (!d) return `${c.operador} ${c.valor}`;
  return `${d.rotulo} ${ROTULO_OPERADOR[c.operador]} ${c.valor} ${d.unidade}`;
}

/**
 * A evidência que o NEXUS congelou: o que foi MEDIDO de verdade.
 *
 * "Faltas medidas: 0" ao lado de "Faltas igual a 0" é o que permite a alguém
 * conferir, meses depois, que o ponto veio de um dado real e não de um palpite.
 * Por isso evidência e condição são textos diferentes: uma é o fato, a outra é
 * a regra.
 */
export function descreverEvidencia(
  evento: EventoPontuacao,
  medido: number,
  condicao: { operador: OperadorCriterio; valor: number },
): string {
  const d = DESCRICAO_EVENTO[evento];
  const base = d ? `${d.rotulo}: ${medido} ${d.unidade}` : String(medido);
  return `${base} (condicao: ${descreverCondicao({ evento, ...condicao })})`;
}

/**
 * Frase resumida do critério, para a tela listar a política da empresa.
 *
 * Fica em `descreverCondicao` quando quem chama só tem o critério; a evidência
 * completa é montada por `descreverEvidencia`.
 */
export function descreverCriterio(c: {
  evento: EventoPontuacao; operador: OperadorCriterio; valor: number;
}): string {
  return descreverCondicao(c);
}

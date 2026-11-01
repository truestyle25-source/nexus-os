import { chaveDiaSql } from '../radar/radar.regras.js';

// ===========================================================================
//  LOJA DE RECOMPENSAS — Ciclo 4
//  Regra pura: saldo, elegibilidade e transições de status.
// ===========================================================================
//
//  A CONTA DE SALDO — o ponto mais delicado deste ciclo
//  --------------------------------------------------
//  `RegistroGamificacao` só SOMA pontos. O resgate DEBITA. Então o saldo é:
//
//      saldo = soma(registros ATIVOS) − soma(resgates que CONSUMIRAM pontos)
//
//  E não é `soma(registros)`, por três motivos concretos:
//    1. um resgate CANCELADO tem que devolver os pontos;
//    2. um registro com status ANULADO tem que deixar de contar;
//    3. saldo é histórico de saldo, não soma de coluna.
//
//  Nenhum saldo é gravado em coluna. Se fosse, o primeiro lançamento de pontos
//  já deixaria a coluna fora do valor real, e ninguém saberia por quê.
//
//  NUNCA HÁ SALDO NEGATIVO
//  ----------------------
//  Um saldo negativo na tela seria mentira: significaria que o NEXUS diz que a
//  pessoa deve pontos. A regra de negócio já proíbe o resgate além do saldo, e
//  o clamp é a segunda barreira — para o caso de alguém anular um registro de
//  pontos depois do resgate.

export const STATUS_RESGATE = ['SOLICITADO', 'APROVADO', 'ENTREGUE', 'REJEITADO', 'CANCELADO'] as const;
export type StatusResgate = (typeof STATUS_RESGATE)[number];

export const CATEGORIAS_RECOMPENSA = [
  'BENEFICIO', 'EXPERIENCIA', 'CURSO', 'ALIMENTACAO', 'FOLGA', 'BRINDE', 'OUTRO',
] as const;
export type CategoriaRecompensa = (typeof CATEGORIAS_RECOMPENSA)[number];

export const ROTULO_CATEGORIA: Record<CategoriaRecompensa, string> = {
  BENEFICIO: 'Benefício', EXPERIENCIA: 'Experiência', CURSO: 'Curso',
  ALIMENTACAO: 'Alimentação', FOLGA: 'Folga', BRINDE: 'Brinde', OUTRO: 'Outros',
};
export const ROTULO_STATUS: Record<StatusResgate, string> = {
  SOLICITADO: 'Solicitado', APROVADO: 'Aprovado', ENTREGUE: 'Entregue',
  REJEITADO: 'Rejeitado', CANCELADO: 'Cancelado',
};

/** Status em que o resgate CONSOME pontos. Enquanto é SOLICITADO, reserva estoque. */
export const CONSOME_PONTOS: ReadonlySet<string> = new Set(['APROVADO', 'ENTREGUE']);

/**
 * Transições válidas de status.
 *
 * Um resgate ENTREGUE não volta para SOLICITADO, e um REJEITADO não vira
 * ENTREGUE: permitir isso reabria a porta de debitar pontos duas vezes sobre o
 * mesmo item, ou de entregar algo que foi recusado.
 */
export const TRANSICOes: Record<StatusResgate, StatusResgate[]> = {
  SOLICITADO: ['APROVADO', 'REJEITADO', 'CANCELADO'],
  APROVADO: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  REJEITADO: [],
  CANCELADO: [],
};

export function podeTransicionar(de: string, para: string): boolean {
  const origem = TRANSICOes[de as StatusResgate];
  if (!origem) return false;
  return origem.includes(para as StatusResgate);
}

/**
 * Saldo de pontos de um funcionário.
 *
 * `registros` são os `RegistroGamificacao`; `resgates` são os resgates DELE
 * (a rota já filtra por `funcionarioId` + `empresaId` antes de chamar).
 */
export function saldoDePontos(
  registros: Array<{ pontos: number; status: string }>,
  resgates: Array<{ pontosUtilizados: number; status: string }>,
): number {
  const ganhos = registros
    .filter((r) => r.status === 'ATIVO')
    .reduce((a, r) => a + (r.pontos ?? 0), 0);
  const debitados = resgates
    .filter((r) => CONSOME_PONTOS.has(r.status))
    .reduce((a, r) => a + (r.pontosUtilizados ?? 0), 0);
  // O clamp nunca deveria disparar — a elegibilidade barra antes —, mas um
  // saldo negativo na tela seria pior que um número conservador.
  return Math.max(0, ganhos - debitados);
}

export type MotivoBloqueio =
  | 'FUNCIONARIO_NAO_EXISTE'
  | 'RECOMPENSA_INATIVA'
  | 'SEM_ESTOQUE'
  | 'PONTOS_INSUFICIENTES'
  | 'JA_RESGATOU'
  | 'FORA_DA_JANELA';

export type Elegibilidade = {
  pode: boolean;
  motivo: MotivoBloqueio | null;
  /** Frase para a tela. `null` quando pode. */
  mensagem: string | null;
};

/**
 * Diz se um resgate pode ser solicitado — e, se não, POR QUE.
 *
 * A ordem das checagens é a ordem em que o gestor precisa ouvir: primeiro
 * o que está errado com a recompensa, depois o estoque, e só por último os
 * pontos da pessoa. Um "você tem 300 pontos" quando o problema real é estoque
 * zerado manda o gestor procurar no lugar errado.
 */
export function avaliarElegibilidade(input: {
  ativo: boolean;
  quantidadeDisponivel: number;
  custoPontos: number;
  saldo: number;
  /** `true` quando a pessoa já tem um resgate ATIVO desta recompensa. */
  jaResgatouAtivo?: boolean;
}): Elegibilidade {
  if (!input.ativo) {
    return { pode: false, motivo: 'RECOMPENSA_INATIVA', mensagem: 'Esta recompensa não está disponível.' };
  }
  if (input.quantidadeDisponivel <= 0) {
    return { pode: false, motivo: 'SEM_ESTOQUE', mensagem: 'Recompensa esgotada no momento.' };
  }
  if (input.jaResgatouAtivo) {
    return {
      pode: false, motivo: 'JA_RESGATOU',
      mensagem: 'Já existe um resgate desta recompensa em andamento para este funcionário.',
    };
  }
  if (input.saldo < input.custoPontos) {
    return {
      pode: false, motivo: 'PONTOS_INSUFICIENTES',
      mensagem: `Pontos insuficientes: saldo de ${input.saldo}, necessários ${input.custoPontos}.`,
    };
  }
  return { pode: true, motivo: null, mensagem: null };
}

/**
 * Normaliza uma recompensa vinda do banco.
 *
 * O estoque NUNCA aparece negativo. Um `quantidadeDisponivel` negativo é
 * impossível pelo caminho normal — a rota decrementa só com estoque
 * suficiente —, mas se um lançamento legado tiver deixado, a tela mostraria
 * "-3 disponíveis" e o clamp evita.
 */
export function estoqueVisivel(quantidade: number): number {
  return Math.max(0, quantidade ?? 0);
}

/** Uma recompensa só aparece na vitrine se estiver ativa E tiver estoque. */
export function apareceNaVitrine(ativa: boolean, quantidade: number): boolean {
  return ativa && estoqueVisivel(quantidade) > 0;
}

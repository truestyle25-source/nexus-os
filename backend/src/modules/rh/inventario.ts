// ===========================================================================
//  SESSÃO DE INVENTÁRIO — Ciclo 6
//  Regras puras: o que é uma folha, o que é uma contagem, o que fecha.
// ===========================================================================
//
//  O SALDO CONGELADO
//  -----------------
//  `quantidadeSistema` é copiado no momento em que a folha abre. Esta função é
//  a única coisa que decide o que entra congelado, e é o ponto do ciclo: se a
//  divergência fosse recalculada contra o estoque atual, uma compra no meio da
//  contagem pareceria desvio, e o inventário perderia o sentido.
//
//  POR QUE A CONTAGEM NÃO É GRAVADA AQUI
//  -------------------------------------
//  Gravar é trabalho da rota. Este arquivo só diz o que é válido, o que é uma
//  contagem coerente e o que um resumo de sessão contém — para ser testado sem
//  banco.

export const STATUS_SESSAO = ['ABERTA', 'CONCLUIDA', 'CANCELADA'] as const;
export type StatusSessao = (typeof STATUS_SESSAO)[number];

/** Uma sessão só em `ABERTA` aceita contagem. */
export function aceitaContagem(status: string): boolean {
  return status === 'ABERTA';
}

/**
 * Transições válidas do status da sessão.
 *
 * Uma sessão CONCLUIDA é documento: reabrir uma contagem fechada mudaria o
 * histórico depois que alguém já usou os números para decidir. Quem errou
 * precisa abrir outra sessão, e as duas ficam no histórico lado a lado.
 */
export const TRANSICOES_SESSAO: Record<StatusSessao, StatusSessao[]> = {
  ABERTA: ['CONCLUIDA', 'CANCELADA'],
  CONCLUIDA: [],
  CANCELADA: [],
};

export function podeMudarStatus(de: string, para: string): boolean {
  const origem = TRANSICOES_SESSAO[de as StatusSessao];
  if (!origem) return false;
  return origem.includes(para as StatusSessao);
}

export type Divergencia = 'BATEU' | 'SOBROU' | 'FALTOU';

export function classificarDivergencia(sistema: number, contada: number | null): Divergencia | null {
  if (contada === null || contada === undefined) return null;
  if (contada === sistema) return 'BATEU';
  return contada > sistema ? 'SOBROU' : 'FALTOU';
}

/**
 * Resumo de uma sessão — o que a tela mostra no cabeçalho e o que o histórico
 * guarda.
 *
 * `pendentes` é o número que realmente importa: uma sessão concluída com item
 * não contado é um inventário incompleto, e é exatamente por isso que a rota
 * recusa fechar uma sessão com pendência.
 */
export function resumirSessao(contagens: Array<{ quantidadeSistema: number; quantidadeContada: number | null }>): {
  total: number;
  contados: number;
  pendentes: number;
  bateram: number;
  sobraram: number;
  faltaram: number;
  fechavel: boolean;
} {
  let bateram = 0;
  let sobraram = 0;
  let faltaram = 0;
  let contados = 0;
  for (const c of contagens) {
    const d = classificarDivergencia(c.quantidadeSistema, c.quantidadeContada);
    if (d === null) continue;
    contados++;
    if (d === 'BATEU') bateram++;
    else if (d === 'SOBROU') sobraram++;
    else faltaram++;
  }
  const pendentes = contagens.length - contados;
  return {
    total: contagens.length,
    contados,
    pendentes,
    bateram,
    sobraram,
    faltaram,
    // Uma folha vazia não fecha: sem itens não houve contagem, e marcar como
    // CONCLUIDA criaria um histórico de inventário que não existe.
    fechavel: contagens.length > 0 && pendentes === 0,
  };
}

/**
 * Valida a contagem que o gestor está lançando para um item.
 *
 * `null` é a resposta de "ainda não contei" e é sempre aceito — quem está
 * no meio da contagem precisa poder voltar a um item. O que se recusa é o
 * número impossível, que na folha de papel viraria "-3 caixas" e passaria
 * batido.
 */
export function validarContagem(bruto: unknown): { valor: number | null } | { erro: string } {
  if (bruto === null || bruto === undefined || bruto === '') return { valor: null };
  const n = typeof bruto === 'number' ? bruto : Number(bruto);
  if (!Number.isFinite(n)) return { erro: 'Informe um número.' };
  if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-8) return { erro: 'A contagem aceita no máximo 3 casas decimais.' };
  if (n < 0) return { erro: 'A contagem física não pode ser negativa.' };
  return { valor: n };
}

/**
 * Motivo para recusar a criação de uma sessão.
 *
 * A regra que não é óbvia: uma sessão aberta congela o saldo, e duas folhas
 * abertas na mesma filial significam duas medições incompatíveis do mesmo
 * estoque. Retomar é o certo; começar outra por cima é a fonte de dois
 * números diferentes para o mesmo depósito.
 */
export function validarAbertura(input: {
  nome: string;
  filialId: string;
  itensNaFilial: number;
  sessoesAbertasNaFilial: number;
}): string[] {
  const erros: string[] = [];
  if (!input.nome || input.nome.trim().length < 2) erros.push('Dê um nome à contagem.');
  if (!input.filialId) erros.push('Escolha a filial que será contada.');
  if (input.itensNaFilial === 0) erros.push('Esta filial não tem nenhum item em estoque para contar.');
  if (input.sessoesAbertasNaFilial > 0) {
    erros.push('Já existe uma contagem aberta nesta filial. Retome a que está em andamento.');
  }
  return erros;
}

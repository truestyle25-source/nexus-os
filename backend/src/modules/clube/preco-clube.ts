/**
 * NEXUS CLUB — regra ÚNICA de preço das promoções do clube (plano D.4).
 *
 * Usada pela vitrine do app (Fase 7) e, na etapa do PDV (Fase 9), pelo caixa e por POST /vendas:
 * o mesmo cálculo em todo lugar, sem mecanismo paralelo. Função pura (sem banco), testada à parte.
 *
 * Ordem: dentre as promoções PUBLICADAS e vigentes que valem para a filial, as "só membros"
 * contam apenas para quem é membro ativo; vence o MENOR preço; sem promoção, fica o preço base
 * (preço da filial, se houver, senão o do produto).
 */
export interface PromocaoParaPreco {
  id: string;
  tipo: 'TODOS' | 'MEMBROS';
  status: 'RASCUNHO' | 'PUBLICADA' | 'ENCERRADA' | 'CANCELADA';
  precoPromocional: number;
  inicio: Date;
  fim: Date;
  todasFiliais: boolean;
  filiais: string[];
}

export type SituacaoPromocao = 'RASCUNHO' | 'AGENDADA' | 'ATIVA' | 'VENCIDA' | 'ENCERRADA' | 'CANCELADA';

/** Situação para mostrar na tela: agendada/ativa/vencida saem das datas de uma promoção publicada. */
export function situacaoPromocao(p: Pick<PromocaoParaPreco, 'status' | 'inicio' | 'fim'>, agora = new Date()): SituacaoPromocao {
  if (p.status !== 'PUBLICADA') return p.status;
  if (agora < p.inicio) return 'AGENDADA';
  if (agora >= p.fim) return 'VENCIDA';
  return 'ATIVA';
}

export function promocaoValeAgora(p: PromocaoParaPreco, ctx: { filialId?: string | null; membro: boolean; agora?: Date }): boolean {
  if (situacaoPromocao(p, ctx.agora) !== 'ATIVA') return false;
  if (p.tipo === 'MEMBROS' && !ctx.membro) return false;
  if (!p.todasFiliais && (!ctx.filialId || !p.filiais.includes(ctx.filialId))) return false;
  return p.precoPromocional > 0;
}

export function precoComPromocao(
  precoBase: number,
  promocoes: PromocaoParaPreco[],
  ctx: { filialId?: string | null; membro: boolean; agora?: Date },
): { preco: number; promocao: PromocaoParaPreco | null; desconto: number } {
  let melhor: PromocaoParaPreco | null = null;
  for (const p of promocoes) {
    if (!promocaoValeAgora(p, ctx) || p.precoPromocional >= precoBase) continue;
    if (!melhor || p.precoPromocional < melhor.precoPromocional) melhor = p;
  }
  const preco = melhor ? melhor.precoPromocional : precoBase;
  return { preco, promocao: melhor, desconto: Math.round((precoBase - preco) * 100) / 100 };
}

/** % de desconto (uma casa decimal), para a alçada e para a tela. */
export function percentualDesconto(de: number, por: number): number {
  if (!(de > 0)) return 0;
  return Math.round(((de - por) / de) * 1000) / 10;
}

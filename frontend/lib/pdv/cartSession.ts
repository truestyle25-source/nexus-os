// ============================================================================
// FASE 3 PDV PRO — Persistência do carrinho (recuperação).
//
// Requisito da missão: recuperar o estado após refresh, fechamento inesperado do
// navegador e queda de energia. O carrinho é gravado no IndexedDB a cada
// alteração e reidratado ao reabrir a tela. Guardamos só o necessário para
// remontar a venda (ids, quantidades, descontos) — nada sensível.
// ============================================================================
import { db } from './db';
import type { CarrinhoLocal, ContextoLocal } from './tipos';

const chaveAtual = (contexto: ContextoLocal) => `${contexto.empresaId}:${contexto.usuarioId}:atual`;

export interface ItemCarrinhoInput {
  produtoId: string;
  nome: string;
  preco: number;
  quantidade: number;
  estoque?: number;
  desconto: number;
  imagem?: string | null;
}

export interface SalvarCarrinhoInput extends ContextoLocal {
  filialId: string;
  clienteId?: string | null;
  forma: string;
  descontoGeral: number;
  valorRecebido?: string | null;
  parcelas?: number;
  itens: ItemCarrinhoInput[];
}

/** Grava (substitui) o carrinho atual. Chamado a cada mudança no carrinho. */
export async function salvarCarrinho(input: SalvarCarrinhoInput): Promise<void> {
  const registro: CarrinhoLocal = {
    chave: chaveAtual(input),
    empresaId: input.empresaId,
    usuarioId: input.usuarioId,
    filialId: input.filialId,
    clienteId: input.clienteId ?? null,
    forma: input.forma,
    descontoGeral: input.descontoGeral,
    valorRecebido: input.valorRecebido ?? null,
    parcelas: input.parcelas ?? 1,
    itens: input.itens,
    atualizadoEm: Date.now(),
  };
  await db().carrinho.put(registro);
}

/** Recupera o carrinho salvo (ou null). Usado ao abrir a tela do PDV. */
export async function recuperarCarrinho(contexto: ContextoLocal): Promise<CarrinhoLocal | null> {
  const r = await db().carrinho.get(chaveAtual(contexto));
  return r ?? null;
}

/** Limpa o carrinho salvo (após venda confirmada ou limpeza manual). */
export async function limparCarrinho(contexto: ContextoLocal): Promise<void> {
  await db().carrinho.delete(chaveAtual(contexto));
}

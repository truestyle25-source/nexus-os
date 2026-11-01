// ============================================================================
// FASE 3 PDV PRO — Catálogo local (operação offline).
//
// Objetivo: bipou o código -> resultado imediato, sem ida ao servidor a cada
// produto. Preparado para até ~10.000 produtos com atualização incremental
// (guardamos `atualizadoEm` e só substituímos o que mudou).
//
// Decisão: NÃO usamos Fuse.js. Para o PDV o caso crítico é a bipagem EXATA
// (código de barras/SKU), que um índice do Dexie resolve em O(log n). A busca
// por nome usa prefixo + substring simples. Adicionar Fuse.js traria custo de
// bundle sem benefício real para o fluxo de caixa. Se no futuro houver busca
// fonética, aí sim vale reconsiderar.
// ============================================================================
import { db } from './db';
import type { ContextoLocal, ProdutoLocal } from './tipos';

/** Preço vigente considerando promoção por data (Janela promocional). */
export function precoVigente(p: ProdutoLocal, agora = Date.now()): number {
  if (p.precoPromocional != null) {
    const inicio = p.promocaoInicio ? Date.parse(p.promocaoInicio) : -Infinity;
    const fim = p.promocaoFim ? Date.parse(p.promocaoFim) : Infinity;
    if (agora >= inicio && agora <= fim) return p.precoPromocional;
  }
  return p.precoVenda;
}

/**
 * Upsert em lote de produtos (sincronização do servidor). Substitui apenas os
 * produtos cujo `atualizadoEm` é mais novo que o local — atualização incremental.
 * Retorna quantos foram gravados/atualizados.
 */
export async function sincronizarCatalogo(
  contexto: ContextoLocal,
  filialId: string,
  produtos: Array<Omit<ProdutoLocal, 'idLocal' | 'atualizadoEm'> & { atualizadoEm?: number }>,
  agora = Date.now(),
): Promise<{ gravados: number; ignorados: number }> {
  const tabela = db().catalogoProdutos;
  let gravados = 0;
  let ignorados = 0;
  await db().transaction('rw', tabela, async () => {
    for (const p of produtos) {
      const atualizadoEm = p.atualizadoEm ?? agora;
      if (p.empresaId !== contexto.empresaId || p.filialId !== filialId) continue;
      const idLocal = `${p.empresaId}:${p.filialId}:${p.id}`;
      const existente = await tabela.get(idLocal);
      if (existente && existente.atualizadoEm > atualizadoEm) {
        ignorados++;
        continue;
      }
      await tabela.put({ ...p, idLocal, atualizadoEm } as ProdutoLocal);
      gravados++;
    }
  });
  return { gravados, ignorados };
}

/** Busca por código de barras exato (o caso da bipagem). */
export async function buscarPorCodigoBarras(empresaId: string, filialId: string, codigo: string): Promise<ProdutoLocal | undefined> {
  const limpo = codigo.trim();
  if (!limpo) return undefined;
  return db().catalogoProdutos.where('[empresaId+filialId+codigoBarras]').equals([empresaId, filialId, limpo]).first();
}

/** Busca por SKU exato. */
export async function buscarPorSku(empresaId: string, filialId: string, sku: string): Promise<ProdutoLocal | undefined> {
  const limpo = sku.trim();
  if (!limpo) return undefined;
  return db().catalogoProdutos.where('[empresaId+filialId+sku]').equals([empresaId, filialId, limpo]).first();
}

/**
 * Busca por bipagem: tenta código de barras, depois SKU, e devolve o produto
 * ativo encontrado. É o caminho quente do PDV (precisa ser instantâneo).
 */
export async function resolverBipagem(empresaId: string, filialId: string, codigo: string): Promise<ProdutoLocal | undefined> {
  const porBarras = await buscarPorCodigoBarras(empresaId, filialId, codigo);
  if (porBarras && porBarras.ativo) return porBarras;
  const porSku = await buscarPorSku(empresaId, filialId, codigo);
  if (porSku && porSku.ativo) return porSku;
  return undefined;
}

/**
 * Busca textual por nome (prefixo case-insensitive, depois contém). Limita a
 * `limite` resultados — o PDV mostra poucos itens por vez.
 */
export async function buscarPorNome(empresaId: string, filialId: string, termo: string, limite = 24): Promise<ProdutoLocal[]> {
  const t = termo.trim().toLowerCase();
  if (!t) return [];
  // Filtra só ativos em memória e ordena por relevância (prefixo antes de
  // "contém"). Para o volume do PDV (~milhares), isto é instantâneo.
  const todos = await db().catalogoProdutos.where('[empresaId+filialId]').equals([empresaId, filialId]).filter((p) => p.ativo).toArray();
  const comeca = todos.filter((p) => p.nome.toLowerCase().startsWith(t));
  const contem = todos.filter((p) => !p.nome.toLowerCase().startsWith(t) && p.nome.toLowerCase().includes(t));
  return [...comeca, ...contem].slice(0, limite);
}

/** Conta produtos no catálogo local (usado em diagnóstico/UI mínima). */
export async function contarCatalogo(): Promise<number> {
  return db().catalogoProdutos.count();
}

/** Limpa o catálogo local (ex.: troca de empresa/filial). */
export async function limparCatalogo(empresaId: string, filialId: string): Promise<void> {
  await db().catalogoProdutos.where('[empresaId+filialId]').equals([empresaId, filialId]).delete();
}

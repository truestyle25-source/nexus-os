/**
 * Ordem de produção: consumo previsto pela ficha técnica e comparação com o realizado.
 * Quantidades de material são inteiros em milésimos (ex.: 1,250 kg = 1250), para
 * evitar erro de ponto flutuante.
 */

export type ItemFicha = { materialId: string; quantidadePorUnidadeMilesimos: number };

export type FichaTecnica = { produtoId: string; itens: ItemFicha[] };

export type Consumo = { materialId: string; quantidadeMilesimos: number };

export function validarFicha(f: FichaTecnica): void {
  if (f.itens.length === 0) throw new Error("Ficha técnica precisa de ao menos um material.");
  const vistos = new Set<string>();
  for (const i of f.itens) {
    if (vistos.has(i.materialId)) throw new Error(`Material repetido na ficha: ${i.materialId}.`);
    vistos.add(i.materialId);
    if (!Number.isSafeInteger(i.quantidadePorUnidadeMilesimos) || i.quantidadePorUnidadeMilesimos <= 0) {
      throw new Error(`Quantidade por unidade inválida para ${i.materialId}.`);
    }
  }
}

export function consumoPrevisto(f: FichaTecnica, quantidadeProduzida: number): Consumo[] {
  validarFicha(f);
  if (!Number.isSafeInteger(quantidadeProduzida) || quantidadeProduzida <= 0) {
    throw new Error("Quantidade produzida deve ser inteiro e maior que zero.");
  }
  return f.itens.map((i) => ({
    materialId: i.materialId,
    quantidadeMilesimos: i.quantidadePorUnidadeMilesimos * quantidadeProduzida,
  }));
}

export type VariacaoConsumo = {
  materialId: string;
  previstoMilesimos: number;
  realizadoMilesimos: number;
  diferencaMilesimos: number;
  /** Variação percentual em centésimos de ponto (ex.: 1250 = 12,50%). Null se não previsto. */
  variacaoCentesimosPorCento: number | null;
};

/** Compara previsto e realizado por material. Material consumido sem previsão aparece também. */
export function variacaoConsumo(previsto: Consumo[], realizado: Consumo[]): VariacaoConsumo[] {
  const ids = new Set([...previsto.map((c) => c.materialId), ...realizado.map((c) => c.materialId)]);
  const pMap = new Map(previsto.map((c) => [c.materialId, c.quantidadeMilesimos]));
  const rMap = new Map(realizado.map((c) => [c.materialId, c.quantidadeMilesimos]));
  return [...ids].sort().map((materialId) => {
    const p = pMap.get(materialId) ?? 0;
    const r = rMap.get(materialId) ?? 0;
    return {
      materialId,
      previstoMilesimos: p,
      realizadoMilesimos: r,
      diferencaMilesimos: r - p,
      variacaoCentesimosPorCento: p === 0 ? null : Math.round(((r - p) * 10_000) / p),
    };
  });
}

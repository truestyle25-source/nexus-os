import { ISO, exigirCentavos, somarMeses } from "./datas.js";

/**
 * Depreciação linear de ativo fixo. Base = aquisição − valor residual.
 * A cota mensal é arredondada para baixo; a diferença de centavos vai para o último
 * mês, de modo que a soma do cronograma sempre fecha exatamente na base.
 */

export type Bem = {
  id: string;
  descricao: string;
  dataAquisicao: ISO;
  valorAquisicaoCentavos: number;
  valorResidualCentavos: number;
  vidaUtilMeses: number;
};

export function validarBem(b: Bem): void {
  if (!b.descricao.trim()) throw new Error("Bem precisa de descrição.");
  exigirCentavos(b.valorAquisicaoCentavos, "valor de aquisição");
  exigirCentavos(b.valorResidualCentavos, "valor residual", { permitirZero: true });
  if (b.valorResidualCentavos >= b.valorAquisicaoCentavos) {
    throw new Error("Valor residual deve ser menor que o valor de aquisição.");
  }
  if (!Number.isInteger(b.vidaUtilMeses) || b.vidaUtilMeses < 1) {
    throw new Error("Vida útil deve ser um número inteiro de meses, maior que zero.");
  }
}

export type LinhaDepreciacao = {
  mes: number;
  data: ISO;
  depreciacaoCentavos: number;
  acumuladoCentavos: number;
  valorContabilCentavos: number;
};

export function cronogramaDepreciacao(b: Bem): LinhaDepreciacao[] {
  validarBem(b);
  const base = b.valorAquisicaoCentavos - b.valorResidualCentavos;
  const cota = Math.floor(base / b.vidaUtilMeses);
  const resto = base - cota * b.vidaUtilMeses;

  const linhas: LinhaDepreciacao[] = [];
  let acumulado = 0;
  for (let mes = 1; mes <= b.vidaUtilMeses; mes++) {
    const valor = mes === b.vidaUtilMeses ? cota + resto : cota;
    acumulado += valor;
    linhas.push({
      mes,
      data: somarMeses(b.dataAquisicao, mes),
      depreciacaoCentavos: valor,
      acumuladoCentavos: acumulado,
      valorContabilCentavos: b.valorAquisicaoCentavos - acumulado,
    });
  }
  return linhas;
}

/** Quanto já foi depreciado após N meses decorridos (limitado à vida útil). */
export function depreciadoAte(b: Bem, mesesDecorridos: number): number {
  const linhas = cronogramaDepreciacao(b);
  const n = Math.max(0, Math.min(mesesDecorridos, b.vidaUtilMeses));
  return n === 0 ? 0 : linhas[n - 1].acumuladoCentavos;
}

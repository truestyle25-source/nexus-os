import { ISO, exigirCentavos, exigirData, somarDias } from "./datas.js";

/**
 * Integração entre módulos. Cada função recebe um fato de origem (compra aprovada,
 * venda finalizada) e devolve os efeitos que os outros módulos devem registrar.
 * Não grava nada. A camada de banco aplica os efeitos numa única transação.
 *
 * Cada efeito traz uma chave de idempotência derivada da origem: reprocessar o mesmo
 * fato não pode duplicar títulos nem movimentos de estoque.
 */

export type EfeitoTitulo = {
  chave: string;
  tipo: "pagar" | "receber";
  valorCentavos: number;
  vencimento: ISO;
  origem: string;
};

export type EfeitoEstoque = {
  chave: string;
  materialId: string;
  quantidadeMilesimos: number;
  sentido: "entrada" | "saida";
  origem: string;
};

export type Efeitos = { titulos: EfeitoTitulo[]; estoque: EfeitoEstoque[] };

export type CompraAprovada = {
  id: string;
  dataAprovacao: ISO;
  valorCentavos: number;
  prazoDias: number;
  itens: Array<{ materialId: string; quantidadeMilesimos: number }>;
};

export function efeitosCompraAprovada(c: CompraAprovada): Efeitos {
  exigirData(c.dataAprovacao, "data de aprovação");
  exigirCentavos(c.valorCentavos, "valor da compra");
  if (!Number.isInteger(c.prazoDias) || c.prazoDias < 0) throw new Error("Prazo deve ser inteiro e não negativo.");
  if (c.itens.length === 0) throw new Error("Compra sem itens.");
  const origem = `compra:${c.id}`;
  return {
    titulos: [
      {
        chave: `${origem}:titulo`,
        tipo: "pagar",
        valorCentavos: c.valorCentavos,
        vencimento: somarDias(c.dataAprovacao, c.prazoDias),
        origem,
      },
    ],
    estoque: c.itens.map((i, idx) => ({
      chave: `${origem}:estoque:${idx}`,
      materialId: i.materialId,
      quantidadeMilesimos: i.quantidadeMilesimos,
      sentido: "entrada" as const,
      origem,
    })),
  };
}

export type VendaFinalizada = {
  id: string;
  dataVenda: ISO;
  valorCentavos: number;
  parcelas: number;
  intervaloDias: number;
  itens: Array<{ produtoId: string; quantidadeMilesimos: number }>;
};

/**
 * Divide o valor em parcelas inteiras. A última parcela absorve a diferença de centavos.
 */
export function dividirParcelas(valorCentavos: number, parcelas: number): number[] {
  exigirCentavos(valorCentavos, "valor");
  if (!Number.isInteger(parcelas) || parcelas < 1) throw new Error("Número de parcelas inválido.");
  const base = Math.floor(valorCentavos / parcelas);
  const resto = valorCentavos - base * parcelas;
  return Array.from({ length: parcelas }, (_, i) => (i === parcelas - 1 ? base + resto : base));
}

export function efeitosVendaFinalizada(v: VendaFinalizada): Efeitos {
  exigirData(v.dataVenda, "data da venda");
  exigirCentavos(v.valorCentavos, "valor da venda");
  if (v.itens.length === 0) throw new Error("Venda sem itens.");
  if (!Number.isInteger(v.intervaloDias) || v.intervaloDias < 1) throw new Error("Intervalo entre parcelas inválido.");
  const origem = `venda:${v.id}`;
  const valores = dividirParcelas(v.valorCentavos, v.parcelas);
  return {
    titulos: valores.map((valor, i) => ({
      chave: `${origem}:parcela:${i + 1}`,
      tipo: "receber" as const,
      valorCentavos: valor,
      vencimento: somarDias(v.dataVenda, v.intervaloDias * (i + 1)),
      origem,
    })),
    estoque: v.itens.map((i, idx) => ({
      chave: `${origem}:estoque:${idx}`,
      materialId: i.produtoId,
      quantidadeMilesimos: i.quantidadeMilesimos,
      sentido: "saida" as const,
      origem,
    })),
  };
}


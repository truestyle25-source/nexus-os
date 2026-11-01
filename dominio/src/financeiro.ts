import { ISO, diasEntre, exigirCentavos, exigirData } from "./datas.js";

/**
 * Financeiro: títulos a pagar e a receber, baixas (pagamentos e recebimentos parciais
 * ou totais), situação, fluxo de caixa projetado e conciliação com extrato bancário.
 * Todos os valores são inteiros em centavos.
 */

export type Baixa = { data: ISO; valorCentavos: number };

export type Titulo = {
  id: string;
  tipo: "pagar" | "receber";
  valorCentavos: number;
  vencimento: ISO;
  baixas: Baixa[];
  cancelado: boolean;
};

export type Situacao = "cancelado" | "pago" | "parcial" | "vencido" | "aberto";

export function criarTitulo(entrada: {
  id: string;
  tipo: "pagar" | "receber";
  valorCentavos: number;
  vencimento: string;
}): Titulo {
  if (!entrada.id) throw new Error("Título precisa de identificador.");
  if (entrada.tipo !== "pagar" && entrada.tipo !== "receber") throw new Error("tipo deve ser 'pagar' ou 'receber'.");
  return {
    id: entrada.id,
    tipo: entrada.tipo,
    valorCentavos: exigirCentavos(entrada.valorCentavos, "valor"),
    vencimento: exigirData(entrada.vencimento, "vencimento"),
    baixas: [],
    cancelado: false,
  };
}

export function totalBaixado(t: Titulo): number {
  return t.baixas.reduce((soma, b) => soma + b.valorCentavos, 0);
}

export function saldo(t: Titulo): number {
  return t.valorCentavos - totalBaixado(t);
}

export function situacao(t: Titulo, hoje: ISO): Situacao {
  if (t.cancelado) return "cancelado";
  if (saldo(t) === 0) return "pago";
  if (totalBaixado(t) > 0) return "parcial";
  return diasEntre(t.vencimento, hoje) > 0 ? "vencido" : "aberto";
}

/**
 * Registra uma baixa. Não altera o título recebido: devolve um novo.
 * Recusa baixa maior que o saldo, baixa em título cancelado e data anterior à emissão.
 */
export function baixar(t: Titulo, data: string, valorCentavos: number): Titulo {
  if (t.cancelado) throw new Error("Título cancelado não aceita baixa.");
  exigirData(data, "data da baixa");
  exigirCentavos(valorCentavos, "valor da baixa");
  const restante = saldo(t);
  if (valorCentavos > restante) {
    throw new Error(`Baixa de ${valorCentavos} centavos excede o saldo de ${restante} centavos.`);
  }
  return { ...t, baixas: [...t.baixas, { data, valorCentavos }] };
}

export function cancelar(t: Titulo): Titulo {
  if (t.baixas.length > 0) throw new Error("Título com baixa não pode ser cancelado; estorne as baixas antes.");
  return { ...t, cancelado: true };
}

export type DiaFluxo = {
  data: ISO;
  entradas: number;
  saidas: number;
  saldoProjetado: number;
};

/**
 * Projeção diária. Títulos vencidos antes da data inicial entram no primeiro dia,
 * porque ainda precisam ser pagos ou recebidos.
 */
export function fluxoDeCaixa(params: {
  saldoInicialCentavos: number;
  titulos: Titulo[];
  dataInicio: ISO;
  dias: number;
}): DiaFluxo[] {
  const { saldoInicialCentavos, titulos, dataInicio, dias } = params;
  exigirData(dataInicio, "dataInicio");
  if (!Number.isInteger(dias) || dias < 1 || dias > 366) throw new Error("dias deve estar entre 1 e 366.");

  const datas: ISO[] = [];
  const base = new Date(`${dataInicio}T00:00:00Z`).getTime();
  for (let i = 0; i < dias; i++) {
    datas.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }

  const entradaPorDia = new Map<ISO, number>();
  const saidaPorDia = new Map<ISO, number>();
  for (const t of titulos) {
    if (t.cancelado) continue;
    const aberto = saldo(t);
    if (aberto <= 0) continue;
    let dia = t.vencimento < dataInicio ? dataInicio : t.vencimento;
    if (!datas.includes(dia)) continue;
    const mapa = t.tipo === "receber" ? entradaPorDia : saidaPorDia;
    mapa.set(dia, (mapa.get(dia) ?? 0) + aberto);
  }

  let acumulado = saldoInicialCentavos;
  return datas.map((data) => {
    const entradas = entradaPorDia.get(data) ?? 0;
    const saidas = saidaPorDia.get(data) ?? 0;
    acumulado += entradas - saidas;
    return { data, entradas, saidas, saldoProjetado: acumulado };
  });
}

export type LancamentoBanco = { id: string; data: ISO; valorCentavos: number };

export type ResultadoConciliacao = {
  conciliados: Array<{ lancamentoId: string; tituloId: string }>;
  semTitulo: string[];
  semLancamento: string[];
};

/**
 * Conciliação automática por correspondência exata de valor e proximidade de data.
 * Valor positivo no extrato casa com título a receber; negativo, com título a pagar.
 * Cada título e cada lançamento são usados no máximo uma vez.
 * Pagamentos parciais NÃO são conciliados automaticamente: exigem conferência manual.
 */
export function conciliar(params: {
  lancamentos: LancamentoBanco[];
  titulos: Titulo[];
  toleranciaDias?: number;
}): ResultadoConciliacao {
  const tolerancia = params.toleranciaDias ?? 2;
  const usados = new Set<string>();
  const conciliados: ResultadoConciliacao["conciliados"] = [];
  const semTitulo: string[] = [];

  for (const l of params.lancamentos) {
    const tipo = l.valorCentavos > 0 ? "receber" : "pagar";
    const valorAbs = Math.abs(l.valorCentavos);
    const candidatos = params.titulos
      .filter((t) => !usados.has(t.id) && !t.cancelado && t.tipo === tipo)
      .filter((t) => t.baixas.length === 0 && t.valorCentavos === valorAbs)
      .filter((t) => Math.abs(diasEntre(t.vencimento, l.data)) <= tolerancia)
      .sort((a, b) => Math.abs(diasEntre(a.vencimento, l.data)) - Math.abs(diasEntre(b.vencimento, l.data)));

    const escolhido = candidatos[0];
    if (escolhido) {
      usados.add(escolhido.id);
      conciliados.push({ lancamentoId: l.id, tituloId: escolhido.id });
    } else {
      semTitulo.push(l.id);
    }
  }

  const semLancamento = params.titulos
    .filter((t) => !usados.has(t.id) && !t.cancelado && t.baixas.length === 0)
    .map((t) => t.id);

  return { conciliados, semTitulo, semLancamento };
}

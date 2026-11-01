import { ISO, exigirCentavos, exigirData } from "./datas.js";

/**
 * Plano de contas e lançamentos em partidas dobradas.
 * Todo lançamento tem débitos e créditos de mesmo total. Conta sintética agrupa
 * contas filhas e não recebe lançamento; só conta analítica recebe.
 */

export type Natureza = "ativo" | "passivo" | "patrimonio" | "receita" | "despesa";

export type Conta = { codigo: string; nome: string; natureza: Natureza };

export type Partida = { conta: string; tipo: "D" | "C"; valorCentavos: number };

export type Lancamento = { id: string; data: ISO; historico: string; partidas: Partida[] };

/** Pai de "1.1.01" é "1.1"; pai de "1" é null. */
export function codigoPai(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i === -1 ? null : codigo.slice(0, i);
}

export function validarPlano(contas: Conta[]): string[] {
  const erros: string[] = [];
  const codigos = new Set<string>();
  for (const c of contas) {
    if (!/^\d+(\.\d+)*$/.test(c.codigo)) erros.push(`Código inválido: "${c.codigo}".`);
    if (codigos.has(c.codigo)) erros.push(`Código duplicado: "${c.codigo}".`);
    codigos.add(c.codigo);
    if (!c.nome.trim()) erros.push(`Conta ${c.codigo} sem nome.`);
  }
  for (const c of contas) {
    const pai = codigoPai(c.codigo);
    if (pai !== null && !codigos.has(pai)) erros.push(`Conta ${c.codigo} tem pai inexistente (${pai}).`);
  }
  return erros;
}

/** Contas sintéticas são as que têm filhas. Só as demais aceitam lançamento. */
export function contasAnaliticas(contas: Conta[]): Set<string> {
  const pais = new Set<string>();
  for (const c of contas) {
    const p = codigoPai(c.codigo);
    if (p !== null) pais.add(p);
  }
  return new Set(contas.map((c) => c.codigo).filter((cod) => !pais.has(cod)));
}

export function validarLancamento(l: Lancamento, plano: Conta[]): string[] {
  const erros: string[] = [];
  try {
    exigirData(l.data, "data");
  } catch (e) {
    erros.push((e as Error).message);
  }
  if (!l.historico || !l.historico.trim()) erros.push("Lançamento precisa de histórico.");
  if (l.partidas.length < 2) erros.push("Lançamento precisa de pelo menos duas partidas.");

  const analiticas = contasAnaliticas(plano);
  const existentes = new Set(plano.map((c) => c.codigo));
  let debitos = 0;
  let creditos = 0;
  for (const p of l.partidas) {
    if (p.tipo !== "D" && p.tipo !== "C") erros.push(`Tipo de partida inválido: ${p.tipo}.`);
    try {
      exigirCentavos(p.valorCentavos, `valor da partida em ${p.conta}`);
    } catch (e) {
      erros.push((e as Error).message);
    }
    if (!existentes.has(p.conta)) erros.push(`Conta ${p.conta} não existe no plano.`);
    else if (!analiticas.has(p.conta)) erros.push(`Conta ${p.conta} é sintética e não recebe lançamento.`);
    if (p.tipo === "D") debitos += p.valorCentavos;
    if (p.tipo === "C") creditos += p.valorCentavos;
  }
  if (debitos !== creditos) erros.push(`Lançamento desbalanceado: débitos ${debitos} ≠ créditos ${creditos}.`);
  return erros;
}

/** Recusa o lançamento se houver qualquer erro. */
export function registrarLancamento(l: Lancamento, plano: Conta[]): Lancamento {
  const erros = validarLancamento(l, plano);
  if (erros.length) throw new Error(erros.join(" "));
  return l;
}

export type SaldoConta = { conta: string; debitos: number; creditos: number; saldo: number };

/** Saldo = débitos − créditos, na convenção de partidas dobradas. */
export function balancete(lancamentos: Lancamento[]): {
  contas: SaldoConta[];
  totalDebitos: number;
  totalCreditos: number;
  equilibrado: boolean;
} {
  const mapa = new Map<string, { debitos: number; creditos: number }>();
  let totalDebitos = 0;
  let totalCreditos = 0;
  for (const l of lancamentos) {
    for (const p of l.partidas) {
      const acc = mapa.get(p.conta) ?? { debitos: 0, creditos: 0 };
      if (p.tipo === "D") {
        acc.debitos += p.valorCentavos;
        totalDebitos += p.valorCentavos;
      } else {
        acc.creditos += p.valorCentavos;
        totalCreditos += p.valorCentavos;
      }
      mapa.set(p.conta, acc);
    }
  }
  const contas = [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(([conta, v]) => ({ conta, debitos: v.debitos, creditos: v.creditos, saldo: v.debitos - v.creditos }));
  return { contas, totalDebitos, totalCreditos, equilibrado: totalDebitos === totalCreditos };
}

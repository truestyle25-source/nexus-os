import { ISO, diasEntre, exigirCentavos, exigirData, somarDias, somarMeses } from "./datas.js";

/**
 * Contratos com vigência, renovação automática e reajuste.
 * Reajuste em pontos base (100 = 1%). Valor sempre em centavos.
 */

export type Contrato = {
  id: string;
  inicio: ISO;
  fim: ISO;
  valorCentavos: number;
  renovacaoAutomatica: boolean;
  periodoRenovacaoMeses: number;
  reajustePontosBase: number;
};

export function validarContrato(c: Contrato): void {
  exigirData(c.inicio, "início");
  exigirData(c.fim, "fim");
  if (c.fim <= c.inicio) throw new Error("Fim do contrato deve ser posterior ao início.");
  exigirCentavos(c.valorCentavos, "valor do contrato");
  if (!Number.isInteger(c.periodoRenovacaoMeses) || c.periodoRenovacaoMeses < 1) {
    throw new Error("Período de renovação deve ser de pelo menos 1 mês.");
  }
  if (!Number.isInteger(c.reajustePontosBase) || c.reajustePontosBase < 0 || c.reajustePontosBase > 10_000) {
    throw new Error("Reajuste deve ser inteiro entre 0 e 10000 pontos base.");
  }
}

/** Renova enquanto o contrato estiver vencido e a renovação for automática. */
export function renovarAte(c: Contrato, hoje: ISO): Contrato {
  validarContrato(c);
  let atual = { ...c };
  let limite = 1000;
  while (atual.fim < hoje && atual.renovacaoAutomatica && limite-- > 0) {
    const novoInicio = somarDias(atual.fim, 1);
    const novoFim = somarDias(somarMeses(novoInicio, atual.periodoRenovacaoMeses), -1);
    const novoValor = Math.round((atual.valorCentavos * (10_000 + atual.reajustePontosBase)) / 10_000);
    atual = { ...atual, inicio: novoInicio, fim: novoFim, valorCentavos: novoValor };
  }
  return atual;
}

export type AlertaContrato = { id: string; fim: ISO; diasRestantes: number; renovacaoAutomatica: boolean };

/** Contratos que vencem entre hoje e os próximos N dias, e que não se renovam sozinhos. */
export function contratosVencendo(contratos: Contrato[], hoje: ISO, dias: number): AlertaContrato[] {
  return contratos
    .filter((c) => !c.renovacaoAutomatica)
    .map((c) => ({
      id: c.id,
      fim: c.fim,
      diasRestantes: diasEntre(hoje, c.fim),
      renovacaoAutomatica: c.renovacaoAutomatica,
    }))
    .filter((a) => a.diasRestantes >= 0 && a.diasRestantes <= dias)
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

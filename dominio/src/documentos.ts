/**
 * Validação de CNPJ pelos dois dígitos verificadores (módulo 11).
 * Confere formato e dígitos. Não consulta a Receita: um CNPJ válido pode não estar ativo.
 */

const PESOS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function digitoVerificador(base: number[], pesos: number[]): number {
  const soma = base.reduce((acc, d, i) => acc + d * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(entrada: string): boolean {
  const cnpj = entrada.replace(/\D/g, "");
  if (cnpj.length !== 14) return false;
  // Sequências repetidas (ex.: 00000000000000) passam na conta, mas não são CNPJs.
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const d = cnpj.split("").map(Number);
  const dv1 = digitoVerificador(d.slice(0, 12), PESOS_1);
  const dv2 = digitoVerificador(d.slice(0, 12).concat(dv1), PESOS_2);
  return d[12] === dv1 && d[13] === dv2;
}

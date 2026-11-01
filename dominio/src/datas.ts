// Datas no formato AAAA-MM-DD, com aritmética em UTC para não sofrer com fuso horário.

export type ISO = string;

const PADRAO = /^\d{4}-\d{2}-\d{2}$/;

export function ehDataISO(s: unknown): s is ISO {
  if (typeof s !== "string" || !PADRAO.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function exigirData(s: unknown, campo: string): ISO {
  if (!ehDataISO(s)) throw new Error(`${campo} deve ser uma data real no formato AAAA-MM-DD.`);
  return s;
}

function paraMs(s: ISO): number {
  const [a, m, d] = s.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function deMs(ms: number): ISO {
  const dt = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Dias de a até b (positivo se b é depois de a). */
export function diasEntre(a: ISO, b: ISO): number {
  return Math.round((paraMs(b) - paraMs(a)) / 86_400_000);
}

export function somarDias(s: ISO, n: number): ISO {
  return deMs(paraMs(s) + n * 86_400_000);
}

/** Soma meses; se o dia não existir no mês de destino, usa o último dia do mês. */
export function somarMeses(s: ISO, n: number): ISO {
  const [a, m, d] = s.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return deMs(Date.UTC(ano, mes, Math.min(d, ultimoDia)));
}

/** Valida que o valor é inteiro em centavos e positivo (ou zero, se permitido). */
export function exigirCentavos(v: unknown, campo: string, { permitirZero = false } = {}): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new Error(`${campo} deve ser um número inteiro em centavos.`);
  }
  if (permitirZero ? v < 0 : v <= 0) {
    throw new Error(`${campo} deve ser ${permitirZero ? "zero ou positivo" : "maior que zero"}.`);
  }
  return v;
}

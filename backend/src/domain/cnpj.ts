/**
 * Normaliza um CNPJ removendo qualquer pontuação, mantendo só dígitos.
 * Ex: "11.222.333/0001-81" -> "11222333000181"
 */
export function normalizeCnpj(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Valida um CNPJ pelo algoritmo oficial dos dígitos verificadores
 * (módulo 11), aceitando entrada com ou sem pontuação.
 */
export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // todos os dígitos iguais

  const calcCheckDigit = (base: string): number => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const base12 = cnpj.slice(0, 12);
  const digit1 = calcCheckDigit(base12);
  const digit2 = calcCheckDigit(base12 + digit1);

  return cnpj === base12 + String(digit1) + String(digit2);
}

/** Formata um CNPJ normalizado (14 dígitos) para exibição: 00.000.000/0001-00 */
export function formatCnpj(cnpj: string): string {
  const digits = normalizeCnpj(cnpj);
  if (digits.length !== 14) return cnpj;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Gera um CNPJ válido aleatório — usado apenas no ambiente de teste/dev
 * para preencher o botão "Preencher CNPJ válido aleatório" da tela de
 * criar conta. Nunca usar isso como identidade real de empresa.
 */
export function generateRandomValidCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  const calcCheckDigit = (b: string): number => {
    const weights = b.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = b.split('').reduce((acc, digit, i) => acc + Number(digit) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calcCheckDigit(base);
  const d2 = calcCheckDigit(base + d1);
  return formatCnpj(base + String(d1) + String(d2));
}

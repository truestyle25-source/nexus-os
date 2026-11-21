/**
 * CPF: só dígitos, 11 posições, dígitos verificadores pelo módulo 11.
 * Rejeita sequências repetidas (000.000.000-00, 111..., etc.), que passam no cálculo mas não existem.
 */
export function normalizeCpf(input: string): string {
  return input.replace(/\D/g, '');
}

export function isValidCpf(input: string): boolean {
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(cpf.slice(0, 9), 10);
  const d2 = digito(cpf.slice(0, 10), 11);
  return cpf === cpf.slice(0, 9) + String(d1) + String(d2);
}

export function formatCpf(cpf: string): string {
  const d = normalizeCpf(cpf);
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : cpf;
}

/** CPF válido gerado aleatoriamente (testes). */
export function generateRandomValidCpf(): string {
  for (;;) {
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
    if (/^(\d)\1{8}$/.test(base)) continue;
    const soma1 = base.split('').reduce((a, d, i) => a + Number(d) * (10 - i), 0);
    const d1 = ((soma1 * 10) % 11) % 10;
    const soma2 = (base + d1).split('').reduce((a, d, i) => a + Number(d) * (11 - i), 0);
    const d2 = ((soma2 * 10) % 11) % 10;
    return base + d1 + d2;
  }
}

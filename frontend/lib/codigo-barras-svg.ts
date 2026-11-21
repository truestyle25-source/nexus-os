// Gera o desenho (SVG) de códigos EAN-13 e EAN-8 para impressão de etiquetas.
// Implementação direta do padrão GS1 (conjuntos L, G e R + paridade do 1º dígito). Sem dependências.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// Paridade dos 6 dígitos da esquerda do EAN-13, definida pelo primeiro dígito.
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function digitoVerificador(corpo: string): number {
  const soma = [...corpo].reverse().reduce((t, d, i) => t + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10;
}

export function eanValido(codigo: string): boolean {
  return /^(\d{8}|\d{13})$/.test(codigo) && digitoVerificador(codigo.slice(0, -1)) === Number(codigo.at(-1));
}

/** Sequência de módulos (1 = barra, 0 = espaço) de um EAN-13 ou EAN-8 válido; null se inválido. */
export function modulosEan(codigo: string): string | null {
  if (!eanValido(codigo)) return null;
  if (codigo.length === 13) {
    const p = PARIDADE[Number(codigo[0])];
    const esquerda = [...codigo.slice(1, 7)].map((d, i) => (p[i] === 'L' ? L : G)[Number(d)]).join('');
    const direita = [...codigo.slice(7)].map((d) => R[Number(d)]).join('');
    return `101${esquerda}01010${direita}101`;
  }
  const esquerda = [...codigo.slice(0, 4)].map((d) => L[Number(d)]).join('');
  const direita = [...codigo.slice(4)].map((d) => R[Number(d)]).join('');
  return `101${esquerda}01010${direita}101`;
}

/** SVG com as barras e o número embaixo. `modulo` = largura de cada módulo em px. */
export function svgEan(codigo: string, opcoes: { modulo?: number; altura?: number } = {}): string | null {
  const m = modulosEan(codigo);
  if (!m) return null;
  const mod = opcoes.modulo ?? 2;
  const alt = opcoes.altura ?? 60;
  const margem = 9 * mod;
  const largura = m.length * mod + margem * 2;
  let barras = '';
  for (let i = 0; i < m.length; i++) if (m[i] === '1') barras += `<rect x="${margem + i * mod}" y="0" width="${mod}" height="${alt}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${alt + 16}" viewBox="0 0 ${largura} ${alt + 16}" role="img" aria-label="Código de barras ${codigo}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras}</g><text x="${largura / 2}" y="${alt + 13}" font-family="monospace" font-size="12" text-anchor="middle" fill="#000">${codigo}</text></svg>`;
}

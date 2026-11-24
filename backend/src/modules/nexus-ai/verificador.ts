/**
 * Verificador de números: uma resposta bem escrita com número errado é REPROVADA.
 *
 * Todo número citado na resposta precisa existir nos resultados das ferramentas daquela
 * investigação (valores numéricos ou quantidades de itens das listas), aceitando só
 * diferenças de arredondamento e a forma percentual (0,125 ↔ 12,5%). Datas, horas e
 * marcadores de lista são ignorados. O modelo não faz contas: quem calcula é a ferramenta.
 */

export interface NumeroVerificado { texto: string; valor: number; conferido: boolean }
export interface ResultadoVerificacao { aprovada: boolean; numeros: NumeroVerificado[]; divergentes: string[] }

/** Coleta todos os números conhecidos (valores e tamanhos de listas) dos resultados. */
export function numerosConhecidos(resultados: unknown[]): number[] {
  const acc: number[] = [];
  const visitar = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) { acc.push(v); return; }
    if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) { acc.push(Number(v.replace(',', '.'))); return; }
    if (Array.isArray(v)) { acc.push(v.length); v.forEach(visitar); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(visitar);
  };
  resultados.forEach(visitar);
  return acc;
}

/** Converte "1.234,56", "R$ 12,5", "12.5", "1234" em número. */
export function lerNumeroBR(bruto: string): number | null {
  let s = bruto.replace(/[R$\s%]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // padrão brasileiro
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234 = milhar
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function extrairNumeros(texto: string): { texto: string; valor: number; percentual: boolean }[] {
  const limpo = texto
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ') // datas
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ') // horas
    .replace(/^\s*\d+[.)]\s/gm, ' ') // marcadores de lista "1." "2)"
    .replace(/\b(19|20)\d{2}\b/g, ' '); // anos
  const achados: { texto: string; valor: number; percentual: boolean }[] = [];
  // Dígitos colados a letras, hífen, sublinhado ou barra fazem parte de códigos (SKU, ids):
  // não são números da análise e não são verificados.
  const re = /(?<![\p{L}\d_\-\/`])-?(?:R\$\s?)?(?:\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)%?(?![\p{L}\d_\-`])/gu;
  for (const m of limpo.matchAll(re)) {
    const v = lerNumeroBR(m[0]);
    if (v !== null) achados.push({ texto: m[0].trim(), valor: v, percentual: m[0].includes('%') });
  }
  return achados;
}

function bate(alvo: number, conhecido: number): boolean {
  if (alvo === conhecido) return true;
  const tol = Math.max(0.011, Math.abs(conhecido) * 0.005);
  if (Math.abs(alvo - conhecido) <= tol) return true;
  for (const casas of [0, 1, 2]) { const f = 10 ** casas; if (Math.round(conhecido * f) / f === alvo) return true; }
  return false;
}

/**
 * `extras`: números que o próprio usuário informou (pergunta) e parâmetros usados nas
 * ferramentas (ex.: 60 dias) — o modelo pode repeti-los sem que venham de um resultado.
 */
export function verificarResposta(resposta: string, resultados: unknown[], extras: number[] = []): ResultadoVerificacao {
  const conhecidos = [...numerosConhecidos(resultados), ...extras];
  const numeros = extrairNumeros(resposta).map((n) => {
    const candidatos = n.percentual ? [n.valor, n.valor / 100] : [n.valor];
    const conferido = candidatos.some((c) => conhecidos.some((k) => bate(c, k) || (n.percentual && bate(c, k * 100))));
    return { texto: n.texto, valor: n.valor, conferido };
  });
  const divergentes = numeros.filter((n) => !n.conferido).map((n) => n.texto);
  return { aprovada: divergentes.length === 0, numeros, divergentes };
}

/**
 * Gerador de PDF nativo (sem dependência externa).
 *
 * Monta o arquivo no buffer — objetos, xref e trailer — usando as fontes base-14 do
 * PDF, que todo leitor abre sem embedder. A4 em pontos, margens fixas, quebra
 * de linha pela largura real dos glifos (tabela Helvetica), negrito, três
 * alinhamentos e paginação.
 *
 * Vive em módulo próprio porque a folha de pagamento também gera documento;
 * duplicar isto em dois arquivos seria a origem clássica de "o PDF da folha
 * sai diferente do recibo".
 */

const A4_LARGURA = 595.28; // pt
const A4_ALTURA = 841.89;  // pt
const MARGEM = 50;
const ALTURA_LINHA = 14;
const LARGURA_UTIL = A4_LARGURA - MARGEM * 2;

export type Alinhamento = 'esquerda' | 'centro' | 'direita';

const LARGURAS_HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export interface Bloco {
  texto: string;
  tamanho?: number;
  negrito?: boolean;
  alinhamento?: Alinhamento;
  /** Linha em branco antes do bloco. */
  espacoAntes?: number;
  /** Não quebra linha (títulos curtos e linhas de assinatura). */
  semQuebra?: boolean;
}

export interface DocPdf {
  titulo: string;
  subtitulo?: string;
  blocos: Bloco[];
  /** Rodapé repetido em todas as páginas. */
  rodape?: string;
}

/** Largura em pt de um texto numa dada fonte/tamanho. */
function larguraTexto(texto: string, tamanho: number, negrito: boolean): number {
  let total = 0;
  for (const ch of texto) {
    const cod = ch.codePointAt(0) ?? 32;
    if (cod < 32 || cod > 126) { total += 556; continue; }
    total += (LARGURAS_HELVETICA[cod - 32] ?? 556) * (negrito ? 1.06 : 1);
  }
  return (total * tamanho) / 1000;
}

/**
 * Escapa texto para literal PDF.
 *
 * `\`, `(` e `)` são especiais. Caracteres acima de 0x7F vão crus: com
 * `/WinAnsiEncoding` eles viram o byte Latin-1 certo, e é assim que os acentos
 * chegam corretos no leitor.
 */
function escaparPdf(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** Quebra o texto em linhas que caibam na largura útil. */
function quebrarLinha(texto: string, tamanho: number, negrito: boolean, semQuebra: boolean): string[] {
  if (semQuebra || !texto) return [texto];
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let linha = '';
  for (const palavra of palavras) {
    const tentativa = linha ? `${linha} ${palavra}` : palavra;
    if (linha && larguraTexto(tentativa, tamanho, negrito) > LARGURA_UTIL) {
      linhas.push(linha);
      linha = palavra;
    } else {
      linha = tentativa;
    }
  }
  if (linha) linhas.push(linha);
  return linhas.length ? linhas : [''];
}

/**
 * Monta o PDF completo.
 *
 * A paginação é calculada antes de serializar: cada página vira um objeto
 * `/Page` apontando para seu próprio `/Contents`, e a `xref` é escrita com os
 * offsets REAIS de cada objeto — é o ponto em que geradores de PDF improvisados
 * costumam produzir arquivo que o leitor recusa a abrir.
 */
export function gerarPdf(doc: DocPdf): Buffer {
  const paginas: string[] = [];
  let atual: string[] = [];
  let y = A4_ALTURA - MARGEM;
  const limiteInferior = MARGEM + (doc.rodape ? 26 : 8);

  /** Escreve uma linha de texto na posição X/Y. */
  const escrever = (texto: string, x: number, tamanho: number, negrito: boolean) => {
    atual.push(`BT ${negrito ? '/F2' : '/F1'} ${tamanho} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escaparPdf(texto)}) Tj ET`);
    y -= ALTURA_LINHA;
  };

  const fecharPagina = () => {
    if (!atual.length) return;
    if (doc.rodape) {
      atual.push(`BT /F1 8 Tf 1 0 0 1 ${MARGEM} ${MARGEM + 2} Tm (${escaparPdf(doc.rodape)}) Tj ET`);
    }
    paginas.push(atual.join('\n'));
    atual = [];
    y = A4_ALTURA - MARGEM;
  };

  // Cabeçalho na primeira página: título centralizado e subtítulo (CNPJ).
  if (doc.titulo) {
    const larguraTitulo = larguraTexto(doc.titulo, 14, true);
    escrever(doc.titulo, MARGEM + (LARGURA_UTIL - larguraTitulo) / 2, 14, true);
    y -= 4;
    if (doc.subtitulo) {
      const larguraSub = larguraTexto(doc.subtitulo, 9.5, false);
      escrever(doc.subtitulo, MARGEM + (LARGURA_UTIL - larguraSub) / 2, 9.5, false);
    }
    y -= 6;
  }

  let primeiro = true;
  for (const bloco of doc.blocos) {
    if (!bloco || !bloco.texto) continue;
    const tamanho = bloco.tamanho ?? 10.5;
    const negrito = bloco.negrito ?? false;
    const alinhamento = bloco.alinhamento ?? 'esquerda';
    y -= bloco.espacoAntes ?? (primeiro ? 0 : 10);

    for (const linha of quebrarLinha(bloco.texto, tamanho, negrito, bloco.semQuebra ?? false)) {
      if (y < limiteInferior) fecharPagina();
      const largura = larguraTexto(linha, tamanho, negrito);
      let x = MARGEM;
      if (alinhamento === 'centro') x = MARGEM + (LARGURA_UTIL - largura) / 2;
      else if (alinhamento === 'direita') x = A4_LARGURA - MARGEM - largura;
      escrever(linha, x, tamanho, negrito);
    }
    primeiro = false;
  }

  if (y < limiteInferior) fecharPagina();
  fecharPagina();
  if (!paginas.length) paginas.push(`BT /F1 10.5 Tf 1 0 0 1 ${MARGEM} ${limiteInferior} Tm () Tj ET`);

  // --- Serialização dos objetos -------------------------------------------
  // 1 = Catalog, 2 = Pages, 3.. = Page, depois os Contents, por último as fontes.
  const primeiroPagina = 3;
  const primeiroContent = primeiroPagina + paginas.length;
  const ultimoContent = primeiroContent + paginas.length - 1;
  const idF1 = ultimoContent + 1;
  const idF2 = ultimoContent + 2;

  const objetos: string[] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objetos.push(
    `<< /Type /Pages /Kids [${paginas.map((_, i) => `${primeiroPagina + i} 0 R`).join(' ')}] /Count ${paginas.length} >>`,
  );
  paginas.forEach((_, i) => {
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_LARGURA} ${A4_ALTURA}] ` +
        `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> >> ` +
        `/Contents ${primeiroContent + i} 0 R >>`,
    );
  });
  for (const conteudo of paginas) {
    objetos.push(`<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`);
  }
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let posicao = partes[0].length;

  objetos.forEach((corpo, indice) => {
    const buffer = Buffer.from(`${indice + 1} 0 obj\n${corpo}\nendobj\n`, 'latin1');
    offsets.push(posicao);
    partes.push(buffer);
    posicao += buffer.length;
  });

  const inicioXref = posicao;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  partes.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(partes);
}

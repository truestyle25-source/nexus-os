/**
 * Impressão direta em impressora térmica (ESC/POS) pelo navegador.
 *
 * Usa a Web Serial API (Chrome/Edge no computador): a impressora ligada por
 * USB aparece como porta serial. O operador escolhe a porta UMA vez ("Conectar
 * impressora"); o navegador lembra a permissão e, nas próximas vendas, o cupom
 * vai direto para a impressora, sem a janela de impressão do sistema.
 *
 * Sem suporte (Firefox, Safari, celular) ou sem impressora conectada, quem
 * chama cai no `window.print()` de sempre. Nenhum dado sai do computador: os
 * bytes vão do navegador direto para o cabo.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Página de código 860 (Português) — acentos do cupom. */
const CP860: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87,
  'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f,
  'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97,
  'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2,
  'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '°': 0xa7,
};

/** Converte o texto para bytes da página 860; o que não existe nela vira sem acento ou '?'. */
export function codificarCp860(texto: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of texto.replace(/\r\n/g, '\n')) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) { bytes.push(code); continue; }
    if (CP860[ch] != null) { bytes.push(CP860[ch]); continue; }
    if (ch === ' ') { bytes.push(0x20); continue; } // espaço do Intl.NumberFormat
    const semAcento = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    bytes.push(semAcento && semAcento.charCodeAt(0) < 0x80 ? semAcento.charCodeAt(0) : 0x3f);
  }
  return Uint8Array.from(bytes);
}

/** Monta o cupom em ESC/POS: inicializa, página 860, texto, avança e corta. */
export function montarEscPos(texto: string): Uint8Array {
  const inicio = [ESC, 0x40, ESC, 0x74, 3]; // ESC @ (reset) · ESC t 3 (CP860)
  const fim = [0x0a, 0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]; // avança e corte parcial
  const corpo = codificarCp860(texto.endsWith('\n') ? texto : `${texto}\n`);
  const saida = new Uint8Array(inicio.length + corpo.length + fim.length);
  saida.set(inicio, 0);
  saida.set(corpo, inicio.length);
  saida.set(fim, inicio.length + corpo.length);
  return saida;
}

type PortaSerial = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: unknown;
  writable: WritableStream<Uint8Array> | null;
};
type SerialNav = { serial?: { requestPort(): Promise<PortaSerial>; getPorts(): Promise<PortaSerial[]> } };

const serial = (): SerialNav['serial'] =>
  typeof navigator !== 'undefined' ? (navigator as unknown as SerialNav).serial : undefined;

/** O navegador permite impressão direta? (Chrome/Edge no computador.) */
export function impressaoDiretaSuportada(): boolean {
  return Boolean(serial());
}

/** Já existe impressora autorizada neste navegador? */
export async function impressoraConectada(): Promise<boolean> {
  const s = serial();
  if (!s) return false;
  try { return (await s.getPorts()).length > 0; } catch { return false; }
}

/** Pede ao operador para escolher a porta da impressora (precisa de clique). */
export async function conectarImpressora(): Promise<void> {
  const s = serial();
  if (!s) throw new Error('Este navegador não imprime direto. Use Chrome ou Edge no computador.');
  await s.requestPort();
}

/** Envia o texto para a impressora autorizada. Lança erro se não houver. */
export async function imprimirTextoTermico(texto: string, baudRate = 9600): Promise<void> {
  const s = serial();
  if (!s) throw new Error('Impressão direta indisponível neste navegador.');
  const [porta] = await s.getPorts();
  if (!porta) throw new Error('Nenhuma impressora conectada.');
  await porta.open({ baudRate }).catch((e: unknown) => {
    // Porta já aberta por uma impressão anterior: segue usando.
    if (!(e instanceof Error) || !/already open/i.test(e.message)) throw e;
  });
  if (!porta.writable) throw new Error('A impressora não aceitou dados.');
  const writer = porta.writable.getWriter();
  try {
    await writer.write(montarEscPos(texto));
  } finally {
    writer.releaseLock();
    await porta.close().catch(() => undefined);
  }
}

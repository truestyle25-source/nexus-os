import { EdgeTTS } from 'node-edge-tts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Voz da ATMA — a essência inteligente do NEXUS OS.
 *
 * Identidade vocal: mulher jovem adulta, timbre médio, suave e levemente aveludado, português
 * brasileiro neutro, velocidade natural e moderada, tom inteligente, acolhedor e seguro.
 * Escolhida pelo responsável entre amostras reais (24/11/2026): "Thalita calma" — voz neural
 * pt-BR-ThalitaNeural, um pouco mais lenta (-6%) e mais grave (-2 Hz) que o padrão, para
 * evitar uma voz aguda ou acelerada.
 *
 * Síntese: Microsoft Edge TTS (neural, sem custo). Ajustável sem mudar código por
 * NEXUS_TTS_VOZ, NEXUS_TTS_VELOCIDADE e NEXUS_TTS_TOM.
 */
export const VOZ_ATMA = {
  voz: process.env.NEXUS_TTS_VOZ || 'pt-BR-ThalitaNeural',
  velocidade: process.env.NEXUS_TTS_VELOCIDADE || '-6%',
  tom: process.env.NEXUS_TTS_TOM || '-2Hz',
} as const;

/**
 * Prepara o texto escrito para ser FALADO com naturalidade:
 *  - remove marcação (negrito, títulos, crases) e identificadores internos (ids do banco),
 *    que soariam como uma sequência de letras soltas;
 *  - transforma itens de lista em frases ("- Produto: Farinha" → "Produto: Farinha.");
 *  - troca símbolos que a voz leria mal ("→", "≥", "×") por palavras.
 * Números e valores (R$ 1.234,56) ficam intactos: a voz neural já os lê em português.
 */
export function textoParaFala(texto: string): string {
  return texto
    .replace(/\(\s*ID:?\s*[^)]*\)/gi, '') // "(ID: cmwu...)"
    .replace(/\b(?:ID|id)\s*:\s*[a-z0-9]{20,}\b/g, '')
    .replace(/\bc[a-z0-9]{20,30}\b/g, '') // ids cuid soltos
    .replace(/`[^`]*`/g, (m) => (/^`[a-z0-9_-]{16,}`$/i.test(m) ? '' : m.slice(1, -1)))
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*|__|[*_~>#`]/g, '')
    .replace(/\(\s*\)/g, '') // parênteses que ficaram vazios após remover um id
    .replace(/^\s*(?:[-•]|\d+[.)])\s+(.+?)\s*$/gm, (_m, item: string) => (/[.!?:;]$/.test(item) ? item : `${item}.`))
    .replace(/\s*→\s*/g, ' para ')
    .replace(/≥/g, ' maior ou igual a ').replace(/≤/g, ' menor ou igual a ')
    .replace(/(\d)\s*×/g, '$1 vezes').replace(/×/g, ' vezes ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.!?])\.+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function gerarVozNatural(texto: string, voz = VOZ_ATMA.voz): Promise<Buffer> {
  const cleanText = textoParaFala(texto);
  if (!cleanText) return Buffer.alloc(0);

  const tts = new EdgeTTS({
    voice: voz,
    lang: 'pt-BR',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: VOZ_ATMA.velocidade,
    pitch: VOZ_ATMA.tom,
    timeout: 30_000,
  });

  const tempFile = path.join(os.tmpdir(), `nexus_tts_${crypto.randomUUID()}.mp3`);
  try {
    await tts.ttsPromise(cleanText, tempFile);
    return await fs.readFile(tempFile);
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
  }
}

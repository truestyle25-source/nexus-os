import { EdgeTTS } from 'node-edge-tts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Síntese de Voz Neural Humana e Grátis (Microsoft Edge TTS).
 * Vozes pt-BR recomendadas (iguais Meta AI):
 * - 'pt-BR-FranciscaNeural' (feminina, suave e natural - padrão)
 * - 'pt-BR-AntonioNeural' (masculina, clara e executiva)
 */
export async function gerarVozNatural(
  texto: string,
  voice = 'pt-BR-FranciscaNeural',
): Promise<Buffer> {
  const cleanText = texto
    .replace(/[*#_`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) {
    return Buffer.alloc(0);
  }

  const tts = new EdgeTTS({
    voice,
    lang: 'pt-BR',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  });

  const tempFile = path.join(os.tmpdir(), `nexus_tts_${crypto.randomUUID()}.mp3`);

  try {
    await tts.ttsPromise(cleanText, tempFile);
    const audioBuffer = await fs.readFile(tempFile);
    return audioBuffer;
  } finally {
    try {
      await fs.unlink(tempFile);
    } catch {}
  }
}


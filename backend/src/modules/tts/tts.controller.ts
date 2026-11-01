import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { gerarVozNatural } from './tts.service.js';

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  const ttsHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { text, texto } = (req.body as { text?: string; texto?: string }) || {};
    const conteudo = (text || texto || '').trim();

    if (!conteudo) {
      return reply.status(400).send({ error: 'Texto obrigatório para conversão em voz' });
    }

    if (conteudo.length > 2000) {
      return reply.status(400).send({ error: 'Texto muito longo para conversão em voz (máx. 2000 caracteres)' });
    }

    try {
      const audioBuffer = await gerarVozNatural(conteudo);
      if (!audioBuffer || audioBuffer.length === 0) {
        return reply.status(502).send({ error: 'Não foi possível gerar o áudio agora' });
      }
      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Cache-Control', 'public, max-age=86400')
        .send(audioBuffer);
    } catch (err: any) {
      req.log.error({ err }, 'Erro ao gerar TTS neural');
      return reply.status(500).send({ error: 'Falha ao sintetizar voz natural' });
    }
  };

  // TTS exige login (mesmo padrão do /ia/perguntar) — evita uso anônimo da cota/CPU.
  // Compat: GET /integracoes e telas públicas continuam sem auth; só o TTS fecha.
  app.post('/api/v1/tts', { preHandler: [(app as any).authenticate] }, ttsHandler);
  app.post('/tts', { preHandler: [(app as any).authenticate] }, ttsHandler);
}


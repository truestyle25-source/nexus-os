/**
 * Serviço de Chat da IA do NEXUS OS.
 * Integração oficial com Google Gemini.
 * Suporta modo texto e modo conversação por voz (síntese e reconhecimento de voz no frontend).
 */

export interface ChatMessageOptions {
  pergunta: string;
  contextoDados?: string;
}

export async function processarMensagemIA({ pergunta, contextoDados = '' }: ChatMessageOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no .env do backend');
  }

  // Modelo vem SEMPRE do .env (GEMINI_MODEL) — nunca hardcoded.
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  const systemPrompt = `Você é o NEXUS, a IA do NEXUS OS, em português do Brasil, direta, empática e precisa.
Dados reais da empresa: ${contextoDados || 'Nenhum dado crítico no momento'}.
INSTRUÇÃO IMPORTANTE: Você é uma IA multimodal conversacional com suporte nativo a voz e texto. NUNCA diga 'Atualmente, opero em modo texto' ou que não pode falar ou emitir som, pois sua voz é sintetizada automaticamente em tempo real para o usuário no frontend.
Responda de forma executiva, clara e natural, ideal tanto para ser lida na tela quanto falada em voz alta. Evite prefixos desnecessários como 'Você perguntou:'.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nPergunta: ${pergunta}` }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = (await response.json()) as any;
    if (!response.ok) {
      throw new Error(data.error?.message || `Falha na API da IA (HTTP ${response.status}, modelo ${modelo})`);
    }

    const resposta = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Olá! Como posso ajudar você hoje?';
    return resposta;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Gemini demorou demais (timeout 15s)');
    throw err instanceof Error ? err : new Error('Falha na API da IA');
  }
}


/**
 * Cliente do modelo de linguagem, extraído do handler de `/ia/perguntar`.
 *
 * POR QUE UM ARQUIVO SÓ
 * ---------------------
 * A chamada ao Gemini estava escrita DENTRO do handler de rota, ou seja, não
 * podia ser reutilizada por nenhum outro módulo. O Radar precisa da mesma
 * coisa com outro contexto (sinais de RH em vez de estoque/vendas), e duplicar
 * esse `fetch` — com timeout, tratamento de erro e modelo do .env — é
 * exatamente o tipo de estrutura duplicada que não deve existir: na segunda
 * cópia o timeout ou o modelo já divergem do primeiro.
 *
 * CONTINUIDADE: `ia.routes.ts` passou a chamar ESTE serviço. O comportamento
 * observável do /ia/perguntar é o mesmo; o que mudou é que a chamada deixou de
 * estar presa na rota.
 */

/** Instrução que o NEXUS usa em todas as conversas (voz + texto). */
const PAPEL_NEXUS = [
  'Você é o NEXUS, a IA do NEXUS OS, em português do Brasil, direta, empática e precisa.',
  "INSTRUÇÃO CRÍTICA: Você possui suporte completo tanto a voz quanto a texto, pois o sistema sintetiza suas respostas em áudio automaticamente no frontend.",
  "NUNCA diga 'Atualmente, opero em modo texto' nem afirme que não pode falar ou emitir voz.",
  'Seja natural, sem prefixos tipo "Você perguntou:". Resposta curta e executiva.',
].join(' ');

export type ResultadoIA = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * Extrai o JSON de uma resposta de modelo.
 *
 * Vive aqui, e não em cada consumidor, porque é o mesmo problema para todo
 * mundo que pede saída estruturada: o modelo às vezes embrulha o JSON em cercas
 * de código, às vezes precede de um "Claro!" e às vezes devolve só o raciocínio.
 *
 * Devolve `null` em vez de lançar, porque uma resposta malformada da IA é um
 * resultado ESPERADO, não uma exceção de programação — quem chama decide o que
 * fazer com a ausência de dado.
 */
export function extrairJsonTexto(textoBruto: string): unknown | null {
  if (!textoBruto) return null;
  const limpo = textoBruto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const i0 = limpo.indexOf('{');
  const i1 = limpo.lastIndexOf('}');
  const corpo = i0 >= 0 && i1 > i0 ? limpo.slice(i0, i1 + 1) : limpo;
  try {
    return JSON.parse(corpo);
  } catch {
    return null;
  }
}


/**
 * Consulta o modelo. Devolve resultado tipado em vez de lançar: quem chama
 * decide a resposta HTTP e o texto de fallback, porque o fallback é diferente
 * em cada contexto (o /ia/perguntar tem um texto próprio; o Radar tem outro).
 */
export async function consultarIA(
  pergunta: string,
  opcoes: { papel?: string; temperatura?: number; maxTokens?: number; json?: boolean } = {},
): Promise<ResultadoIA> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, motivo: 'GEMINI_API_KEY não configurada no ambiente.' };
  }

  // Modelo vem SEMPRE do .env (GEMINI_MODEL) — nunca fixo no código.
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const sistema = `${opcoes.papel ?? PAPEL_NEXUS}\n\n${pergunta}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: sistema }] }],
          generationConfig: {
            temperature: opcoes.temperatura ?? 0.7,
            maxOutputTokens: opcoes.maxTokens ?? 400,
            // `json: true` faz a API responder em JSON válido, em vez de
            // "pensar" em texto e correr o risco de truncar no meio. Quem
            // pede estruturado (fornecedores, relatório, plano) usa; quem
            // conversa continua sem, porque obrigar JSON na conversa ruinsa o
            // texto. O mesmo recurso já é usado em `iaFornecedores`.
            ...(opcoes.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
        signal: controller.signal,
      },
    );
    const data = (await r.json()) as any;
    if (!r.ok) {
      return { ok: false, motivo: data.error?.message || `Falha na API da IA (HTTP ${r.status}, modelo ${modelo})` };
    }
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return texto
      ? { ok: true, texto }
      : { ok: false, motivo: 'O modelo devolveu resposta vazia.' };
  } catch (erro: any) {
    const cancelado = erro?.name === 'AbortError';
    return { ok: false, motivo: cancelado ? 'Tempo esgotado ao consultar o modelo (15s).' : String(erro?.message ?? erro) };
  } finally {
    clearTimeout(timeout);
  }
}

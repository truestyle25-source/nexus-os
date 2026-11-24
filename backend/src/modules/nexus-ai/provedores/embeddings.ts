/**
 * Embeddings (vetores semânticos) para a busca nos documentos — Gemini `gemini-embedding-001`,
 * 768 dimensões (GEMINI_EMBEDDING_MODEL para trocar). A chave fica só no servidor.
 *
 * Falha do provedor NUNCA impede gravar ou buscar documentos: devolve null e a busca usa
 * apenas a pesquisa de texto do PostgreSQL. Em testes, `definirEmbedderDeTeste` injeta vetores
 * determinísticos.
 */
export const DIMENSOES = 768;
type Tarefa = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
type Embedder = (textos: string[], tarefa: Tarefa) => Promise<number[][] | null>;

let deTeste: Embedder | null = null;
export function definirEmbedderDeTeste(e: Embedder | null) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Embedder de teste só é permitido em NODE_ENV=test.');
  deTeste = e;
}

async function gemini(textos: string[], tarefa: Tarefa): Promise<number[][] | null> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave || process.env.NODE_ENV === 'test') return null;
  const modelo = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
  const saida: number[][] = [];
  for (let i = 0; i < textos.length; i += 100) {
    const lote = textos.slice(i, i + 100);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify({ requests: lote.map((t) => ({ model: `models/${modelo}`, content: { parts: [{ text: t.slice(0, 8000) }] }, taskType: tarefa, outputDimensionality: DIMENSOES })) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { embeddings?: { values: number[] }[] };
      if (!j.embeddings || j.embeddings.length !== lote.length) return null;
      saida.push(...j.embeddings.map((e) => normalizar(e.values)));
    } catch {
      return null;
    }
  }
  return saida;
}

/** Vetores com menos de 3072 dimensões precisam ser normalizados para a distância de cosseno ficar estável. */
function normalizar(v: number[]) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export async function gerarEmbeddings(textos: string[], tarefa: Tarefa): Promise<number[][] | null> {
  if (!textos.length) return [];
  return (deTeste ?? gemini)(textos, tarefa);
}

/** Formato literal aceito pelo pgvector: '[0.1,0.2,...]'. */
export const literalVetor = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

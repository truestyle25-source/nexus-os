-- NEXUS AI: busca semântica nos documentos (pgvector). Aditiva: só cria a extensão (se faltar),
-- uma coluna opcional e um índice. Trechos sem vetor continuam achados pela busca de texto.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "AITrecho" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
CREATE INDEX IF NOT EXISTS "AITrecho_embedding_idx" ON "AITrecho" USING hnsw ("embedding" vector_cosine_ops);

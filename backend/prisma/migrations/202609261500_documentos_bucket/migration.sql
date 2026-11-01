-- ===========================================================================
--  Documentos em bucket (S3 / Supabase Storage)
--
--  Escrita à mão, e não pelo `prisma migrate diff`, porque o diff gerado
--  automaticamente continha operações destrutivas que NÃO devem ser aplicadas:
--
--    1. DROP TABLE "Importacao" — a tabela existe no banco com dados reais, mas
--       não está no schema.prisma. Apagá-la destruiria registro do cliente.
--    2. DROP CONSTRAINT em Caixa/ChaveApi → Empresa — são chaves estrangeiras
--       válidas que protegem o isolamento por empresa.
--
--  Ambas foram descartadas de propósito. O que esta migração faz é SOMENTE
--  criar a tabela de documentos e seus índices.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS "Documento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "entidadeTipo" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "funcionarioId" TEXT,
    "nomeOriginal" TEXT NOT NULL,
    -- Chave real dentro do bucket. É por ela que o download é feito: o nome
    -- original é apenas exibição e nunca monta caminho.
    "chave" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 's3',
    "contentType" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "descricao" TEXT,
    "enviadoPorId" TEXT,
    -- "disponivel" | "arquivado". Arquivar NÃO apaga o objeto do bucket.
    "situacao" TEXT NOT NULL DEFAULT 'disponivel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- `chave` é única no bucket: dois anexos nunca colidem no mesmo endereço.
CREATE UNIQUE INDEX IF NOT EXISTS "Documento_chave_key" ON "Documento"("chave");

-- Índice principal de leitura: lista os anexos de uma entidade, já filtrada
-- por empresa (isolamento por tenant na própria consulta).
CREATE INDEX IF NOT EXISTS "Documento_empresaId_entidadeTipo_entidadeId_idx"
    ON "Documento"("empresaId", "entidadeTipo", "entidadeId");

CREATE INDEX IF NOT EXISTS "Documento_funcionarioId_idx" ON "Documento"("funcionarioId");
CREATE INDEX IF NOT EXISTS "Documento_empresaId_situacao_idx" ON "Documento"("empresaId", "situacao");
CREATE INDEX IF NOT EXISTS "Documento_entidadeId_idx" ON "Documento"("entidadeId");

-- ON DELETE SET NULL: remover um funcionário não pode apagar o histórico dos
-- documentos que ele tinha — o registro do documento sobrevive sem o vínculo.
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_funcionarioId_fkey"
    FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Documento" ADD CONSTRAINT "Documento_enviadoPorId_fkey"
    FOREIGN KEY ("enviadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

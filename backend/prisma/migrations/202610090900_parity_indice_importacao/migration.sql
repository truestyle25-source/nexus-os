-- ===========================================================================
-- NEXUS OS — paridade: índice secundário de Importacao
--
-- O schema.prisma declara @@index([empresaId, createdAt]) em `Importacao`, mas
-- bancos legados aplicados antes da revisão da cadeia não têm este índice
-- (o diff `migrate diff --from-url` acusava somente esta diferença). Em
-- instalação limpa a baseline já o cria; este arquivo cobre o banco existente.
--
-- IF NOT EXISTS torna o passo um no-op onde o índice já existe — seguro em
-- qualquer ambiente, sem checksum de migrations antigas alteradas.
-- ===========================================================================

CREATE INDEX IF NOT EXISTS "Importacao_empresaId_createdAt_idx" ON "Importacao"("empresaId", "createdAt");

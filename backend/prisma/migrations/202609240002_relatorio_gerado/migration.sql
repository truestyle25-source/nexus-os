-- Relatórios gerados pela IA NEXUS (Seção 33). Escrita à mão no padrão do
-- projeto: rode `prisma migrate deploy` ou `prisma db push` com banco.
CREATE TABLE "RelatorioGerado" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "perguntaOriginal" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "insights" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RelatorioGerado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RelatorioGerado_empresaId_criadoEm_idx" ON "RelatorioGerado"("empresaId", "criadoEm");

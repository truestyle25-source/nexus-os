-- NEXUS AI — Fase 01 (fundação). Somente aditiva.
-- CreateTable
CREATE TABLE "AIConversa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMensagem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "execucaoId" TEXT,
    "detalhes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIExecucao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "conversaId" TEXT,
    "agente" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'PERGUNTA',
    "entrada" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "etapas" JSONB,
    "resposta" TEXT,
    "verificacao" JSONB,
    "erro" TEXT,
    "modelo" TEXT,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,
    "duracaoMs" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIExecucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIExecucaoFerramenta" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "execucaoId" TEXT NOT NULL,
    "ferramenta" TEXT NOT NULL,
    "entrada" JSONB,
    "resultado" JSONB,
    "ok" BOOLEAN NOT NULL,
    "erro" TEXT,
    "duracaoMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIExecucaoFerramenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConsumo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "execucoes" INTEGER NOT NULL DEFAULT 0,
    "tokensEntrada" INTEGER NOT NULL DEFAULT 0,
    "tokensSaida" INTEGER NOT NULL DEFAULT 0,
    "custoCentavos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AIConsumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AILimite" (
    "empresaId" TEXT NOT NULL,
    "execucoesMes" INTEGER,
    "custoMesCentavos" INTEGER,
    "bloqueadoManualmente" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AILimite_pkey" PRIMARY KEY ("empresaId")
);

-- CreateIndex
CREATE INDEX "AIConversa_empresaId_usuarioId_updatedAt_idx" ON "AIConversa"("empresaId", "usuarioId", "updatedAt");

-- CreateIndex
CREATE INDEX "AIMensagem_empresaId_conversaId_createdAt_idx" ON "AIMensagem"("empresaId", "conversaId", "createdAt");

-- CreateIndex
CREATE INDEX "AIExecucao_empresaId_createdAt_idx" ON "AIExecucao"("empresaId", "createdAt");

-- CreateIndex
CREATE INDEX "AIExecucao_status_updatedAt_idx" ON "AIExecucao"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIExecucao_empresaId_idempotencyKey_key" ON "AIExecucao"("empresaId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AIExecucaoFerramenta_empresaId_execucaoId_idx" ON "AIExecucaoFerramenta"("empresaId", "execucaoId");

-- CreateIndex
CREATE UNIQUE INDEX "AIConsumo_empresaId_dia_key" ON "AIConsumo"("empresaId", "dia");

-- AddForeignKey
ALTER TABLE "AIConversa" ADD CONSTRAINT "AIConversa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMensagem" ADD CONSTRAINT "AIMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "AIConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIExecucao" ADD CONSTRAINT "AIExecucao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIExecucaoFerramenta" ADD CONSTRAINT "AIExecucaoFerramenta_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "AIExecucao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConsumo" ADD CONSTRAINT "AIConsumo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AILimite" ADD CONSTRAINT "AILimite_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


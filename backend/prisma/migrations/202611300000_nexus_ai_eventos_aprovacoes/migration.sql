-- NEXUS AI — Fase 06: eventos (outbox), insights, aprovações e automações. Somente aditiva.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoAlerta" ADD VALUE IF NOT EXISTS 'SEGURANCA';
ALTER TYPE "TipoAlerta" ADD VALUE IF NOT EXISTS 'INTEGRACAO';

-- CreateTable
CREATE TABLE "AIEvento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'MEDIA',
    "dados" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiraEm" TIMESTAMP(3),
    "instancia" TEXT,
    "erro" TEXT,
    "processadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "eventoId" TEXT,
    "alertaId" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'MONITOR',
    "tipo" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "severidade" TEXT NOT NULL DEFAULT 'MEDIA',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "evidencias" JSONB,
    "periodo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAprovacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "proposta" JSONB NOT NULL,
    "evidencias" JSONB,
    "impacto" TEXT,
    "valorCentavos" INTEGER,
    "nivel" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "solicitadoPor" TEXT,
    "execucaoId" TEXT,
    "insightId" TEXT,
    "decididoPor" TEXT,
    "decididoEm" TIMESTAMP(3),
    "motivo" TEXT,
    "resultado" JSONB,
    "erro" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAprovacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAutomacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "valorMaxCentavos" INTEGER,
    "atualizadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAutomacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIEvento_status_leaseExpiraEm_idx" ON "AIEvento"("status", "leaseExpiraEm");

-- CreateIndex
CREATE INDEX "AIEvento_empresaId_createdAt_idx" ON "AIEvento"("empresaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIEvento_empresaId_chave_key" ON "AIEvento"("empresaId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "AIInsight_eventoId_key" ON "AIInsight"("eventoId");

-- CreateIndex
CREATE INDEX "AIInsight_empresaId_status_createdAt_idx" ON "AIInsight"("empresaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AIAprovacao_empresaId_status_createdAt_idx" ON "AIAprovacao"("empresaId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIAprovacao_empresaId_idempotencyKey_key" ON "AIAprovacao"("empresaId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "AIAutomacao_empresaId_acao_key" ON "AIAutomacao"("empresaId", "acao");

-- AddForeignKey
ALTER TABLE "AIEvento" ADD CONSTRAINT "AIEvento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAprovacao" ADD CONSTRAINT "AIAprovacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAutomacao" ADD CONSTRAINT "AIAutomacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


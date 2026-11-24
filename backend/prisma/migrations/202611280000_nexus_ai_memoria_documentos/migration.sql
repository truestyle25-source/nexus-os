-- NEXUS AI — Fase 04: memória, documentos e hierarquia de investigações. Somente aditiva.
-- AlterTable
ALTER TABLE "AIExecucao" ADD COLUMN     "execucaoPaiId" TEXT;

-- CreateTable
CREATE TABLE "AIMemoria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIMemoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIDocumento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "modulo" TEXT,
    "caracteres" INTEGER NOT NULL,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AITrecho" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,

    CONSTRAINT "AITrecho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIMemoria_empresaId_ativa_idx" ON "AIMemoria"("empresaId", "ativa");

-- CreateIndex
CREATE INDEX "AIDocumento_empresaId_idx" ON "AIDocumento"("empresaId");

-- CreateIndex
CREATE INDEX "AITrecho_empresaId_documentoId_idx" ON "AITrecho"("empresaId", "documentoId");

-- AddForeignKey
ALTER TABLE "AIMemoria" ADD CONSTRAINT "AIMemoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDocumento" ADD CONSTRAINT "AIDocumento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITrecho" ADD CONSTRAINT "AITrecho_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "AIDocumento"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- NEXUS AI: registro de exportações (auditoria EXPORTAR) e avaliação das respostas. Somente aditiva.
-- AlterEnum
ALTER TYPE "AcaoAuditoria" ADD VALUE IF NOT EXISTS 'EXPORTAR';

-- AlterTable
ALTER TABLE "AIExecucao" ADD COLUMN     "avaliacao" TEXT,
ADD COLUMN     "avaliacaoComentario" TEXT,
ADD COLUMN     "avaliadoEm" TIMESTAMP(3),
ADD COLUMN     "avaliadoPor" TEXT;


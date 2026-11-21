-- Tipo de produto KIT e composição de kit com unidade (2026-11-21).
-- 100% aditiva: valores novos de enum, colunas opcionais, índice e FKs. Nenhum dado existente muda.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoProdutoEnum" ADD VALUE 'KIT';
ALTER TYPE "TipoProdutoEnum" ADD VALUE 'FABRICA';
ALTER TYPE "TipoProdutoEnum" ADD VALUE 'NAO_CLASSIFICADO';

-- AlterTable
ALTER TABLE "ComposicaoKit" ADD COLUMN     "ordem" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantidade" DECIMAL(14,6),
ADD COLUMN     "unidadeId" TEXT;

-- AlterTable
ALTER TABLE "EstoqueMovimentacao" ADD COLUMN     "kitProdutoId" TEXT;

-- AlterTable
ALTER TABLE "VendaItem" ADD COLUMN     "composicaoKit" JSONB;

-- CreateIndex
CREATE INDEX "EstoqueMovimentacao_empresaId_kitProdutoId_idx" ON "EstoqueMovimentacao"("empresaId", "kitProdutoId");

-- AddForeignKey
ALTER TABLE "ComposicaoKit" ADD CONSTRAINT "ComposicaoKit_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueMovimentacao" ADD CONSTRAINT "EstoqueMovimentacao_kitProdutoId_fkey" FOREIGN KEY ("kitProdutoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;


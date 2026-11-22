-- Fase C2: campos de cobrança externa no Financeiro. Somente aditiva.
-- AlterTable
ALTER TABLE "Financeiro" ADD COLUMN     "cobrancaId" TEXT,
ADD COLUMN     "cobrancaProvedor" TEXT,
ADD COLUMN     "cobrancaStatus" TEXT,
ADD COLUMN     "cobrancaUrl" TEXT,
ADD COLUMN     "pagamentoExternoId" TEXT,
ADD COLUMN     "pagoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Financeiro_cobrancaProvedor_cobrancaId_idx" ON "Financeiro"("cobrancaProvedor", "cobrancaId");


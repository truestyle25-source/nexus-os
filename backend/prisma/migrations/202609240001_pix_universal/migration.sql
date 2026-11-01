-- PIX universal NEXUS OS: recebimento direto na conta do lojista (BR Code EMV BACEN).
-- Escrita a mao no mesmo padrao de 202609201000_pdv_caixa: rode `prisma migrate deploy`
-- ou `prisma db push` num ambiente com banco antes de usar.
-- tenantId do pedido = Empresa.id (multi-tenant isolado por empresaId).

CREATE TYPE "TipoChavePix" AS ENUM ('CPF', 'CNPJ', 'PHONE', 'EMAIL', 'RANDOM');
CREATE TYPE "StatusCobrancaPix" AS ENUM ('PENDENTE', 'PAGO', 'EXPIRADO', 'CANCELADO');

CREATE TABLE "PixSettings" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "keyType" "TipoChavePix" NOT NULL,
    "pixKey" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "merchantCity" TEXT NOT NULL,
    "document" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PixSettings_empresaId_key" ON "PixSettings"("empresaId");
CREATE INDEX "PixSettings_empresaId_idx" ON "PixSettings"("empresaId");

CREATE TABLE "PixCobranca" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "vendaId" TEXT,
    "txid" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "StatusCobrancaPix" NOT NULL DEFAULT 'PENDENTE',
    "pagoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixCobranca_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PixCobranca_txid_key" ON "PixCobranca"("txid");
CREATE INDEX "PixCobranca_empresaId_status_idx" ON "PixCobranca"("empresaId", "status");
CREATE INDEX "PixCobranca_vendaId_idx" ON "PixCobranca"("vendaId");

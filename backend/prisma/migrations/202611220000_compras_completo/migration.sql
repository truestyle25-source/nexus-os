-- Módulo Compras completo (2026-11-21): fluxo de aprovação/envio, recebimento parcial, NF de entrada e envios.
-- 100% aditiva: valores novos de enum, colunas opcionais/com padrão, 4 tabelas novas, índices e FKs.
-- Dados preenchidos (só colunas novas): número sequencial das compras existentes e quantidade
-- recebida dos itens de compras já RECEBIDAS (para o saldo pendente não aparecer errado).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusCompra" ADD VALUE 'RASCUNHO';
ALTER TYPE "StatusCompra" ADD VALUE 'AGUARDANDO_APROVACAO';
ALTER TYPE "StatusCompra" ADD VALUE 'APROVADA';
ALTER TYPE "StatusCompra" ADD VALUE 'ENVIADA';
ALTER TYPE "StatusCompra" ADD VALUE 'PARCIAL';
ALTER TYPE "StatusCompra" ADD VALUE 'CONCLUIDA';

-- AlterTable
ALTER TABLE "Compra" ADD COLUMN     "aprovadoEm" TIMESTAMP(3),
ADD COLUMN     "aprovadoPorId" TEXT,
ADD COLUMN     "atualizadoEm" TIMESTAMP(3),
ADD COLUMN     "atualizadoPorId" TEXT,
ADD COLUMN     "centroCusto" TEXT,
ADD COLUMN     "confirmadoEm" TIMESTAMP(3),
ADD COLUMN     "contaFinanceira" TEXT,
ADD COLUMN     "criadoPorId" TEXT,
ADD COLUMN     "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "enviadoEm" TIMESTAMP(3),
ADD COLUMN     "formaPagamento" TEXT,
ADD COLUMN     "frete" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "motivoCancelamento" TEXT,
ADD COLUMN     "numero" INTEGER,
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "observacoesFinanceiras" TEXT,
ADD COLUMN     "observacoesFornecedor" TEXT,
ADD COLUMN     "outrasDespesas" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "parcelas" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "planoContas" TEXT,
ADD COLUMN     "previsaoEntrega" TIMESTAMP(3),
ADD COLUMN     "primeiroVencimento" TIMESTAMP(3),
ADD COLUMN     "prioridade" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "responsavelId" TEXT,
ADD COLUMN     "valorProdutos" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CompraItem" ADD COLUMN     "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "quantidadeRecebida" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "comprasExigeAprovacao" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EstoqueMovimentacao" ADD COLUMN     "recebimentoId" TEXT;

-- CreateTable
CREATE TABLE "CompraRecebimento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "usuarioId" TEXT,
    "dataRecebimento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notaFiscalId" TEXT,
    "observacoes" TEXT,
    "valorRecebido" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompraRecebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraRecebimentoItem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "compraItemId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidadeRecebida" DECIMAL(14,3) NOT NULL,
    "quantidadeBase" DECIMAL(14,3) NOT NULL,
    "quantidadeAvariada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantidadeRecusada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "divergencia" TEXT,

    CONSTRAINT "CompraRecebimentoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraNotaFiscal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT,
    "chaveAcesso" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataEntrada" TIMESTAMP(3),
    "valorTotal" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'REGISTRADA',
    "divergencias" TEXT,
    "observacoes" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompraNotaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraEnvio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "compraId" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provedor" TEXT,
    "provedorId" TEXT,
    "erro" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompraEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompraRecebimento_empresaId_compraId_idx" ON "CompraRecebimento"("empresaId", "compraId");

-- CreateIndex
CREATE INDEX "CompraRecebimento_empresaId_dataRecebimento_idx" ON "CompraRecebimento"("empresaId", "dataRecebimento");

-- CreateIndex
CREATE UNIQUE INDEX "CompraRecebimento_empresaId_idempotencyKey_key" ON "CompraRecebimento"("empresaId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompraRecebimento_compraId_numero_key" ON "CompraRecebimento"("compraId", "numero");

-- CreateIndex
CREATE INDEX "CompraRecebimentoItem_empresaId_recebimentoId_idx" ON "CompraRecebimentoItem"("empresaId", "recebimentoId");

-- CreateIndex
CREATE INDEX "CompraNotaFiscal_empresaId_compraId_idx" ON "CompraNotaFiscal"("empresaId", "compraId");

-- CreateIndex
CREATE UNIQUE INDEX "CompraNotaFiscal_empresaId_chaveAcesso_key" ON "CompraNotaFiscal"("empresaId", "chaveAcesso");

-- CreateIndex
CREATE INDEX "CompraEnvio_empresaId_compraId_idx" ON "CompraEnvio"("empresaId", "compraId");

-- CreateIndex
CREATE INDEX "Compra_empresaId_status_idx" ON "Compra"("empresaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_empresaId_numero_key" ON "Compra"("empresaId", "numero");

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimento" ADD CONSTRAINT "CompraRecebimento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimento" ADD CONSTRAINT "CompraRecebimento_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimento" ADD CONSTRAINT "CompraRecebimento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimento" ADD CONSTRAINT "CompraRecebimento_notaFiscalId_fkey" FOREIGN KEY ("notaFiscalId") REFERENCES "CompraNotaFiscal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimentoItem" ADD CONSTRAINT "CompraRecebimentoItem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimentoItem" ADD CONSTRAINT "CompraRecebimentoItem_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "CompraRecebimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraRecebimentoItem" ADD CONSTRAINT "CompraRecebimentoItem_compraItemId_fkey" FOREIGN KEY ("compraItemId") REFERENCES "CompraItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraNotaFiscal" ADD CONSTRAINT "CompraNotaFiscal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraNotaFiscal" ADD CONSTRAINT "CompraNotaFiscal_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraEnvio" ADD CONSTRAINT "CompraEnvio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraEnvio" ADD CONSTRAINT "CompraEnvio_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Número sequencial das compras existentes (por empresa, na ordem de criação).
UPDATE "Compra" c SET "numero" = x.n
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "empresaId" ORDER BY "createdAt", "id") AS n FROM "Compra") x
WHERE c."id" = x."id" AND c."numero" IS NULL;

-- Itens de compras já recebidas pelo fluxo antigo (recebimento total).
UPDATE "CompraItem" i SET "quantidadeRecebida" = i."quantidade"
FROM "Compra" c WHERE c."id" = i."compraId" AND c."status" = 'RECEBIDA';

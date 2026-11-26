-- PDV: quem autorizou a sangria/estorno e registro de itens cancelados no carrinho.
-- Somente adições; nenhuma linha existente é alterada.
ALTER TABLE "MovimentacaoCaixa" ADD COLUMN "autorizadoPorId" TEXT;

CREATE TABLE "ItemCanceladoPdv" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "autorizadoPorId" TEXT,
    "produtoId" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorUnitario" DECIMAL(12,2) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCanceladoPdv_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ItemCanceladoPdv_empresaId_caixaId_idx" ON "ItemCanceladoPdv"("empresaId", "caixaId");

-- Adiciona campos financeiros à tabela Venda.
ALTER TABLE "Venda"
ADD COLUMN IF NOT EXISTS "troco" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "valorRecebido" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "observacao" VARCHAR(500);
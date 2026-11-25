-- PDV: troco gravado no pagamento em dinheiro.
-- Colunas opcionais: vendas antigas ficam com NULL (troco não registrado).
ALTER TABLE "VendaPagamento" ADD COLUMN "valorRecebido" DECIMAL(12,2);
ALTER TABLE "VendaPagamento" ADD COLUMN "troco" DECIMAL(12,2);

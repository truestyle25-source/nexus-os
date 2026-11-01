-- Separa sucesso, descarte intencional e falha terminal na fila de webhooks.
-- String status aceita os novos valores sem conversão de dados existentes.
ALTER TABLE "NotificacaoMercadoLivre"
    ADD COLUMN "finalizadaEm" TIMESTAMP(3);

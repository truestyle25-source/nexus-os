-- Caixa durável dos webhooks do Mercado Livre.
-- O endpoint público persiste o evento e confirma rapidamente; o agendador
-- reprocessa tarefas vencidas ou abandonadas após reinício.
CREATE TABLE "NotificacaoMercadoLivre" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaExecucaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiraEm" TIMESTAMP(3),
    "processadaEm" TIMESTAMP(3),
    "ultimoErro" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificacaoMercadoLivre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificacaoMercadoLivre_empresaId_eventKey_key"
    ON "NotificacaoMercadoLivre"("empresaId", "eventKey");
CREATE INDEX "NotificacaoMercadoLivre_status_proximaExecucaoEm_idx"
    ON "NotificacaoMercadoLivre"("status", "proximaExecucaoEm");

ALTER TABLE "NotificacaoMercadoLivre"
    ADD CONSTRAINT "NotificacaoMercadoLivre_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

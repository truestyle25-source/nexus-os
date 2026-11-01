-- Sincronização automática do Mercado Livre — tabela de estado-máquina das
-- tarefas recorrentes (produtos / estoque / pedidos). Aditiva: nenhuma
-- estrutura ou dado existente é alterado (diff verificado via shadow db).
-- CreateTable
CREATE TABLE "SincronizacaoTarefa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "proximaExecucaoEm" TIMESTAMP(3) NOT NULL,
    "leaseExpiraEm" TIMESTAMP(3),
    "instanciaId" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "recuperadas" INTEGER NOT NULL DEFAULT 0,
    "ultimaExecucaoEm" TIMESTAMP(3),
    "ultimoSucessoEm" TIMESTAMP(3),
    "ultimoErro" JSONB,
    "processadosUltima" INTEGER NOT NULL DEFAULT 0,
    "falhasUltima" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SincronizacaoTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SincronizacaoTarefa_status_proximaExecucaoEm_idx" ON "SincronizacaoTarefa"("status", "proximaExecucaoEm");

-- CreateIndex
CREATE UNIQUE INDEX "SincronizacaoTarefa_empresaId_tipo_key" ON "SincronizacaoTarefa"("empresaId", "tipo");

-- AddForeignKey
ALTER TABLE "SincronizacaoTarefa" ADD CONSTRAINT "SincronizacaoTarefa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

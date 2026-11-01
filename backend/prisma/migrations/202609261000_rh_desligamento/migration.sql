-- ============================================================================
-- Desligamento / termo de rescisão (RH)
--
-- A aba "Desligamento" do RH montava o termo e as verbas só no estado do
-- navegador e ainda criava um registro DE EXEMPLO quando a lista estava
-- vazia — termo com dados fictícios que sumia ao recarregar. Este modelo
-- torna o termo um registro real, persistente e auditável.
--
-- As verbas (13º, férias+1/3, aviso+FGTS) ficam gravadas como snapshot:
-- o salário pode mudar depois, mas o termo já apurado precisa continuar
-- fiel ao que foi registrado.
-- ============================================================================
CREATE TABLE "Desligamento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "tipoLabel" TEXT NOT NULL,
    "art" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "aviso" TEXT NOT NULL DEFAULT 'indenizado',
    "saldoDias" INTEGER NOT NULL DEFAULT 0,
    "verbas13" DECIMAL(12,2),
    "verbasFerias" DECIMAL(12,2),
    "verbasAviso" DECIMAL(12,2),
    "verbasTotal" DECIMAL(12,2),
    "alineas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "observacoes" TEXT,
    "documentos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "documentoNome" TEXT,
    "documentoGeradoEm" TIMESTAMP(3),
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Desligamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Desligamento_empresaId_idx" ON "Desligamento"("empresaId");
CREATE INDEX "Desligamento_empresaId_funcionarioId_idx" ON "Desligamento"("empresaId", "funcionarioId");
CREATE INDEX "Desligamento_empresaId_status_idx" ON "Desligamento"("empresaId", "status");

ALTER TABLE "Desligamento"
  ADD CONSTRAINT "Desligamento_funcionarioId_fkey"
  FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

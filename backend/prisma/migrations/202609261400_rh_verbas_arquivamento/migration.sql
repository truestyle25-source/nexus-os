-- ===========================================================================
--  Verbas rescisórias, cancelamento e arquivamento (aba Desligamento do RH)
--
--  Escrita à mão, e não pelo `prisma migrate diff`, porque o diff gerado
--  automaticamente continha
--  aplicadas aqui:
--
--    1. DROP TABLE "Importacao" — a tabela existe no banco com dados reais,
--       mas não está no schema.prisma. Apagá-la destruiria registro do cliente.
--    2. DROP CONSTRAINT em Caixa/ChaveApi → Empresa — são chaves estrangeiras
--       válidas que protegem o isolamento por empresa; removê-las permitiria
--       apontar registros para uma empresa inexistente.
--
--  Ambas foram descartadas de propósito. O que esta migração faz é SOMENTE
--  adicionar o que o novo fluxo de desligamento precisa.
-- ===========================================================================

-- Novo status de funcionário: arquivado (30 dias após o desligamento).
ALTER TYPE "StatusFuncionario" ADD VALUE IF NOT EXISTS 'ARQUIVADO';

-- Detalhamento das verbas (art. 477). Antes estes valores eram calculados no
-- navegador com percentuais fixos e não eram gravados — o PDF saía com
-- números que o banco não conseguia reproduzir.
ALTER TABLE "Desligamento" ADD COLUMN IF NOT EXISTS "verbasTerco" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "verbasSaldo" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "verbasFeriasProporc" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "meses13" INTEGER,
ADD COLUMN IF NOT EXISTS "anosCompletos" INTEGER,
ADD COLUMN IF NOT EXISTS "diasAviso" INTEGER;

-- FGTS e multa rescisória: ficam nulos até existir a tabela de depósitos.
-- Deliberadamente NULL (e não 0) para que "não apurado" seja diferente de
-- "apurado como zero" no termo.
ALTER TABLE "Desligamento" ADD COLUMN IF NOT EXISTS "saldoFgts" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "multaFgts" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "fgtsApurado" BOOLEAN NOT NULL DEFAULT false;

-- Cancelamento (art. 5 CLT): o registro não é apagado, entra em CANCELADO e o
-- funcionário volta a ATIVO. O histórico fica preservado.
ALTER TABLE "Desligamento" ADD COLUMN IF NOT EXISTS "canceladoEm" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "canceladoPorId" TEXT,
ADD COLUMN IF NOT EXISTS "motivoCancelamento" TEXT;

-- Janela de 30 dias e dossiê.
ALTER TABLE "Desligamento" ADD COLUMN IF NOT EXISTS "arquivadoEm" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "dossieGeradoEm" TIMESTAMP(3);

-- Suporta a varredura "quem venceu os 30 dias": só entram no índice os
-- desligamentos ainda dentro da janela (arquivadoEm nulo).
CREATE INDEX IF NOT EXISTS "Desligamento_arquivadoEm_status_idx" ON "Desligamento"("arquivadoEm", "status");

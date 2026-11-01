-- FASE 1 PDV PRO — núcleo transacional
-- timezone da filial, caixa numerado/multicaixa, idempotência, VendaPagamento,
-- movimentação de caixa vinculada à venda, data operacional, divergências e
-- reserva temporária de estoque. Todas as colunas novas são anuláveis/default
-- para preservar dados existentes (migration reversível e sem perda).

-- Fuso horário da filial (prevalece para data operacional do caixa/vendas)
ALTER TABLE "Filial" ADD COLUMN "fusoHorario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- Caixa numerado (multicaixa): número único por filial
ALTER TABLE "Caixa" ADD COLUMN "numero" INTEGER;
CREATE UNIQUE INDEX "Caixa_filialId_numero_key" ON "Caixa"("filialId", "numero");

-- MovimentacaoCaixa passa a referenciar a venda (estorno automático rastreável)
ALTER TABLE "MovimentacaoCaixa" ADD COLUMN "vendaId" TEXT;

-- Venda: idempotência, data operacional e alçada de desconto
ALTER TABLE "Venda" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Venda" ADD COLUMN "dataOperacional" DATE;
ALTER TABLE "Venda" ADD COLUMN "descontoAutorizadoPor" TEXT;
ALTER TABLE "Venda" ADD COLUMN "motivoDesconto" TEXT;

CREATE INDEX "Venda_empresaId_filialId_dataOperacional_idx" ON "Venda"("empresaId", "filialId", "dataOperacional");
CREATE INDEX "Venda_empresaId_idempotencyKey_idx" ON "Venda"("empresaId", "idempotencyKey");

-- FK MovimentacaoCaixa -> Venda
ALTER TABLE "MovimentacaoCaixa" ADD CONSTRAINT "MovimentacaoCaixa_vendaId_fkey"
  FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MovimentacaoCaixa_vendaId_idx" ON "MovimentacaoCaixa"("vendaId");

-- Enums novos
CREATE TYPE "StatusReserva" AS ENUM ('ATIVA', 'CONVERTIDA', 'EXPIRADA', 'CANCELADA');
CREATE TYPE "StatusIdempotencia" AS ENUM ('PROCESSANDO', 'CONFIRMADA', 'REJEITADA');
CREATE TYPE "StatusDivergencia" AS ENUM ('ABERTA', 'JUSTIFICADA', 'RESOLVIDA');

-- Pagamento misto da venda
CREATE TABLE "VendaPagamento" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 1,
    "referencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendaPagamento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VendaPagamento_vendaId_idx" ON "VendaPagamento"("vendaId");
CREATE INDEX "VendaPagamento_empresaId_forma_idx" ON "VendaPagamento"("empresaId", "forma");
ALTER TABLE "VendaPagamento" ADD CONSTRAINT "VendaPagamento_vendaId_fkey"
  FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reserva temporária de estoque (criada só no início do pagamento; expira sozinha)
CREATE TABLE "EstoqueReserva" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "vendaId" TEXT,
    "caixaId" TEXT,
    "operadorId" TEXT,
    "quantidade" INTEGER NOT NULL,
    "status" "StatusReserva" NOT NULL DEFAULT 'ATIVA',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EstoqueReserva_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EstoqueReserva_empresaId_filialId_produtoId_status_idx" ON "EstoqueReserva"("empresaId", "filialId", "produtoId", "status");
CREATE INDEX "EstoqueReserva_vendaId_idx" ON "EstoqueReserva"("vendaId");
CREATE INDEX "EstoqueReserva_expiraEm_idx" ON "EstoqueReserva"("expiraEm");
ALTER TABLE "EstoqueReserva" ADD CONSTRAINT "EstoqueReserva_vendaId_fkey"
  FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Idempotência: mesma key + mesma empresa = mesma operação (fonte normativa)
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "caixaId" TEXT,
    "operadorId" TEXT,
    "vendaId" TEXT,
    "status" "StatusIdempotencia" NOT NULL DEFAULT 'PROCESSANDO',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyKey_empresaId_key_key" ON "IdempotencyKey"("empresaId", "key");
CREATE INDEX "IdempotencyKey_vendaId_idx" ON "IdempotencyKey"("vendaId");
CREATE INDEX "IdempotencyKey_caixaId_idx" ON "IdempotencyKey"("caixaId");

-- Divergências de caixa (nunca apagadas)
CREATE TABLE "DivergenciaCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorEsperado" DECIMAL(12,2),
    "valorInformado" DECIMAL(12,2),
    "diferenca" DECIMAL(12,2),
    "status" "StatusDivergencia" NOT NULL DEFAULT 'ABERTA',
    "operadorId" TEXT,
    "autorizadoPor" TEXT,
    "justificativa" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "DivergenciaCaixa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DivergenciaCaixa_caixaId_idx" ON "DivergenciaCaixa"("caixaId");
CREATE INDEX "DivergenciaCaixa_empresaId_status_idx" ON "DivergenciaCaixa"("empresaId", "status");
ALTER TABLE "DivergenciaCaixa" ADD CONSTRAINT "DivergenciaCaixa_caixaId_fkey"
  FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

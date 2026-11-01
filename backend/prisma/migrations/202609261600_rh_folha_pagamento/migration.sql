-- ===========================================================================
--  Folha de Pagamento (RH)
--
--  Escrita a mao, e nao pelo `prisma migrate diff`, porque o diff gerado
--  automaticamente continha operacoes destrutivas que NAO devem ser aplicadas:
--
--    1. DROP TABLE "Importacao" — a tabela existe no banco com dados reais, mas
--       nao esta no schema.prisma. Apaga-la destruiria registro do cliente.
--    2. DROP CONSTRAINT em Caixa/ChaveApi/Importacao — sao chaves estrangeiras
--       validas que protegem o isolamento por empresa.
--
--  Ambas foram descartadas de proposito. Aqui so entram as tabelas de folha.
-- ===========================================================================
-- CreateEnum
CREATE TYPE "StatusFolha" AS ENUM ('ABERTA', 'PROCESSADA', 'FECHADA');

-- CreateEnum
CREATE TYPE "StatusPagamentoFolha" AS ENUM ('PENDENTE', 'PAGO');

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('PROVENTO', 'DESCONTO');

-- CreateEnum
CREATE TYPE "OrigemLancamento" AS ENUM ('AUTOMATICO', 'PONTO', 'MANUAL');






-- CreateTable
CREATE TABLE "Folha" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "status" "StatusFolha" NOT NULL DEFAULT 'ABERTA',
    "dataAbertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataProcessamento" TIMESTAMP(3),
    "dataFechamento" TIMESTAMP(3),
    "fechadaPorId" TEXT,
    "totalProventos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDescontos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalLiquido" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoFolha" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "folhaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "referencia" DECIMAL(12,4),
    "valor" DECIMAL(12,2) NOT NULL,
    "salarioBase" DECIMAL(12,2),
    "percentual" DECIMAL(6,4),
    "observacoes" TEXT,
    "origem" "OrigemLancamento" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LancamentoFolha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoRH" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "folhaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "valorLiquido" DECIMAL(12,2) NOT NULL,
    "valorPago" DECIMAL(12,2),
    "status" "StatusPagamentoFolha" NOT NULL DEFAULT 'PENDENTE',
    "dataPrevista" TIMESTAMP(3),
    "dataPagamento" TIMESTAMP(3),
    "formaPagamento" TEXT,
    "observacoes" TEXT,
    "documentoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagamentoRH_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecimoTerceiro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "salarioBase" DECIMAL(12,2) NOT NULL,
    "mesesDireito" INTEGER NOT NULL DEFAULT 12,
    "valorBruto" DECIMAL(12,2) NOT NULL,
    "valorPrimeiraParcela" DECIMAL(12,2),
    "dataPrimeiraParcela" TIMESTAMP(3),
    "valorSegundaParcela" DECIMAL(12,2),
    "dataSegundaParcela" TIMESTAMP(3),
    "totalDescontos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valorLiquido" DECIMAL(12,2) NOT NULL,
    "fgtsReferencia" DECIMAL(6,4),
    "saldoFgts" DECIMAL(12,2),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "dataPagamento" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecimoTerceiro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Folha_empresaId_status_idx" ON "Folha"("empresaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Folha_empresaId_competencia_key" ON "Folha"("empresaId", "competencia");

-- CreateIndex
CREATE INDEX "LancamentoFolha_empresaId_folhaId_idx" ON "LancamentoFolha"("empresaId", "folhaId");

-- CreateIndex
CREATE INDEX "LancamentoFolha_funcionarioId_folhaId_idx" ON "LancamentoFolha"("funcionarioId", "folhaId");

-- CreateIndex
CREATE INDEX "PagamentoRH_empresaId_folhaId_idx" ON "PagamentoRH"("empresaId", "folhaId");

-- CreateIndex
CREATE INDEX "PagamentoRH_funcionarioId_status_idx" ON "PagamentoRH"("funcionarioId", "status");

-- CreateIndex
CREATE INDEX "DecimoTerceiro_empresaId_ano_idx" ON "DecimoTerceiro"("empresaId", "ano");

-- CreateIndex
CREATE INDEX "DecimoTerceiro_funcionarioId_ano_idx" ON "DecimoTerceiro"("funcionarioId", "ano");

-- AddForeignKey
ALTER TABLE "Folha" ADD CONSTRAINT "Folha_fechadaPorId_fkey" FOREIGN KEY ("fechadaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFolha" ADD CONSTRAINT "LancamentoFolha_folhaId_fkey" FOREIGN KEY ("folhaId") REFERENCES "Folha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoFolha" ADD CONSTRAINT "LancamentoFolha_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoRH" ADD CONSTRAINT "PagamentoRH_folhaId_fkey" FOREIGN KEY ("folhaId") REFERENCES "Folha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoRH" ADD CONSTRAINT "PagamentoRH_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoRH" ADD CONSTRAINT "PagamentoRH_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecimoTerceiro" ADD CONSTRAINT "DecimoTerceiro_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


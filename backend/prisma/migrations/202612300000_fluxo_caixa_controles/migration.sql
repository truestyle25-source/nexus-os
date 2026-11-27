-- CreateEnum
CREATE TYPE "NivelAprovacaoCaixa" AS ENUM ('SUPERVISOR', 'GESTOR');

-- CreateEnum
CREATE TYPE "StatusAprovacaoCaixa" AS ENUM ('PENDENTE', 'AUTORIZADA', 'APROVADA', 'REJEITADA');

-- CreateTable
CREATE TABLE "ConferenciaCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "cega" BOOLEAN NOT NULL DEFAULT true,
    "totalEsperado" DECIMAL(12,2) NOT NULL,
    "totalContado" DECIMAL(12,2) NOT NULL,
    "diferenca" DECIMAL(12,2) NOT NULL,
    "justificativa" TEXT,
    "aprovacaoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConferenciaCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenciaCaixaItem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "conferenciaId" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "esperado" DECIMAL(12,2) NOT NULL,
    "contado" DECIMAL(12,2) NOT NULL,
    "diferenca" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ConferenciaCaixaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AprovacaoCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "caixaId" TEXT,
    "tipo" TEXT NOT NULL,
    "referenciaId" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "nivelExigido" "NivelAprovacaoCaixa" NOT NULL,
    "status" "StatusAprovacaoCaixa" NOT NULL DEFAULT 'PENDENTE',
    "solicitanteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AprovacaoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisaoAprovacaoCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "aprovacaoId" TEXT NOT NULL,
    "decisorId" TEXT NOT NULL,
    "nivel" "NivelAprovacaoCaixa" NOT NULL,
    "decisao" TEXT NOT NULL,
    "justificativa" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisaoAprovacaoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoCaixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "entradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saidaEm" TIMESTAMP(3),
    "recebidoPorId" TEXT,
    "valorEsperado" DECIMAL(12,2),
    "valorConferido" DECIMAL(12,2),
    "diferenca" DECIMAL(12,2),
    "observacao" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContaBancaria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT,
    "nome" TEXT NOT NULL,
    "banco" TEXT,
    "agencia" TEXT,
    "numero" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtratoImportacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "linhasNovas" INTEGER NOT NULL,
    "linhasRepetidas" INTEGER NOT NULL,
    "importadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtratoImportacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtratoLinha" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "documento" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtratoLinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciliacaoBancaria" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "extratoLinhaId" TEXT NOT NULL,
    "financeiroId" TEXT,
    "tipo" TEXT NOT NULL,
    "justificativa" TEXT,
    "aprovacaoId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desfeitaEm" TIMESTAMP(3),
    "desfeitaPorId" TEXT,

    CONSTRAINT "ConciliacaoBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adquirente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "taxaDebito" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxaCredito" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prazoDebitoDias" INTEGER NOT NULL DEFAULT 1,
    "prazoCreditoDias" INTEGER NOT NULL DEFAULT 30,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adquirente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConferenciaCaixa_empresaId_caixaId_idx" ON "ConferenciaCaixa"("empresaId", "caixaId");

-- CreateIndex
CREATE INDEX "ConferenciaCaixaItem_conferenciaId_idx" ON "ConferenciaCaixaItem"("conferenciaId");

-- CreateIndex
CREATE INDEX "AprovacaoCaixa_empresaId_status_idx" ON "AprovacaoCaixa"("empresaId", "status");

-- CreateIndex
CREATE INDEX "AprovacaoCaixa_caixaId_idx" ON "AprovacaoCaixa"("caixaId");

-- CreateIndex
CREATE INDEX "DecisaoAprovacaoCaixa_aprovacaoId_idx" ON "DecisaoAprovacaoCaixa"("aprovacaoId");

-- CreateIndex
CREATE INDEX "TurnoCaixa_empresaId_caixaId_idx" ON "TurnoCaixa"("empresaId", "caixaId");

-- CreateIndex
CREATE INDEX "ContaBancaria_empresaId_idx" ON "ContaBancaria"("empresaId");

-- CreateIndex
CREATE INDEX "ExtratoImportacao_empresaId_contaId_idx" ON "ExtratoImportacao"("empresaId", "contaId");

-- CreateIndex
CREATE INDEX "ExtratoLinha_empresaId_contaId_data_idx" ON "ExtratoLinha"("empresaId", "contaId", "data");

-- CreateIndex
CREATE UNIQUE INDEX "ExtratoLinha_contaId_hash_key" ON "ExtratoLinha"("contaId", "hash");

-- CreateIndex
CREATE INDEX "ConciliacaoBancaria_empresaId_contaId_idx" ON "ConciliacaoBancaria"("empresaId", "contaId");

-- CreateIndex
CREATE INDEX "ConciliacaoBancaria_extratoLinhaId_idx" ON "ConciliacaoBancaria"("extratoLinhaId");

-- CreateIndex
CREATE INDEX "Adquirente_empresaId_idx" ON "Adquirente"("empresaId");

-- AddForeignKey
ALTER TABLE "ConferenciaCaixa" ADD CONSTRAINT "ConferenciaCaixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenciaCaixaItem" ADD CONSTRAINT "ConferenciaCaixaItem_conferenciaId_fkey" FOREIGN KEY ("conferenciaId") REFERENCES "ConferenciaCaixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisaoAprovacaoCaixa" ADD CONSTRAINT "DecisaoAprovacaoCaixa_aprovacaoId_fkey" FOREIGN KEY ("aprovacaoId") REFERENCES "AprovacaoCaixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoCaixa" ADD CONSTRAINT "TurnoCaixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


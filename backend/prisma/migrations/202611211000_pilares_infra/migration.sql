-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "sessoesValidasDesde" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RateLimitJanela" (
    "chave" TEXT NOT NULL,
    "janelaInicio" TIMESTAMP(3) NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 1,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitJanela_pkey" PRIMARY KEY ("chave","janelaInicio")
);

-- CreateTable
CREATE TABLE "TarefaAgendada" (
    "nome" TEXT NOT NULL,
    "ultimoDia" TEXT,
    "leaseExpiraEm" TIMESTAMP(3),
    "instancia" TEXT,
    "ultimaExecucaoEm" TIMESTAMP(3),
    "ultimoSucessoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TarefaAgendada_pkey" PRIMARY KEY ("nome")
);

-- CreateIndex
CREATE INDEX "RateLimitJanela_expiraEm_idx" ON "RateLimitJanela"("expiraEm");


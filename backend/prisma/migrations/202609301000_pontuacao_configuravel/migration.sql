-- ===========================================================================
-- Ciclo 5 — Pontuação CONFIGURÁVEL por empresa
-- ===========================================================================
--
-- O QUE ESTE CICULO MUDA
-- -----------------------
-- Antes, a pontuação era uma lista fixa de 7 regras com valores fixos
-- (50/30/20/15/40/-20/-30) impressa no código do frontend, idêntica para toda
-- empresa que usasse o NEXUS. O botão de ligar/desligar regra só mexia em
-- estado do navegador: nada era gravado, nada afetava o saldo.
--
-- Agora cada empresa define OS SEUS critérios, com O SEU valor e OS SEUS
-- pontos. O NEXUS apenas verifica o evento real, compara com a condição
-- configurada e credita a quantidade que a empresa pediu.
--
-- POR QUE NÃO HÁ INSERT NESTA MIGRATION
-- -------------------------------------
-- Deliberado. Nenhuma empresa pode nascer com pontos, valor de meta ou
-- recompensa padrão: isso seria a política do NEXUS valendo para todo mundo,
-- que é exatamente o problema que este ciclo veio desfazer. A empresa cadastra
-- os próprios critérios e, sem critério, nada é creditado.
--
-- POR QUE DUAS TABELAS
-- --------------------
-- `CriterioPontuacao` é a CONFIGURAÇÃO (o que a empresa decidiu).
-- `AvaliacaoCriterio` é o HISTÓRICO (o que o NEXUS mediu e creditou).
-- Separar permite que a empresa mude o valor do critério amanhã sem reescrever
-- o que já foi pago no mês passado — o histórico continua fiel ao que valia
-- na apuração.
--
-- IDEMPOTÊNCIA
-- -------------
-- A restrição única (criterioId, funcionarioId, periodo) garante que um
-- critério credite UMA vez por pessoa por período. Rodar a avaliação dez vezes
-- no mesmo mês continua valendo o mesmo ponto, e o saldo não infla.

-- CreateEnum
CREATE TYPE "EventoPontuacao" AS ENUM (
    'SEM_FALTA',
    'SEM_ATRASO',
    'SEM_ADVERTENCIA',
    'META_BATIDA',
    'TREINAMENTO_CONCLUIDO',
    'HORAS_EXTRAS',
    'VENDAS_NO_PERIODO'
);

-- CreateEnum
CREATE TYPE "OperadorCriterio" AS ENUM ('IGUAL', 'MAIOR_OU_IGUAL', 'MENOR_OU_IGUAL');

-- CreateEnum
CREATE TYPE "PeriodoCriterio" AS ENUM ('MENSAL', 'TRIMESTRAL', 'ANUAL');

-- CreateTable
CREATE TABLE "CriterioPontuacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "evento" "EventoPontuacao" NOT NULL,
    "operador" "OperadorCriterio" NOT NULL DEFAULT 'IGUAL',
    "valor" INTEGER NOT NULL DEFAULT 0,
    "pontos" INTEGER NOT NULL,
    "periodo" "PeriodoCriterio" NOT NULL DEFAULT 'MENSAL',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterioPontuacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvaliacaoCriterio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "criterioId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "evidencia" TEXT NOT NULL,
    "valorMedido" INTEGER NOT NULL DEFAULT 0,
    "pontos" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "registroId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvaliacaoCriterio_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- `criterioId` separa o ponto de APURAÇÃO do lançamento MANUAL do gestor.
-- Ambos entram no mesmo saldo, mas a origem precisa ser auditável.
ALTER TABLE "RegistroGamificacao" ADD COLUMN "criterioId" TEXT;

-- CreateIndex
CREATE INDEX "CriterioPontuacao_empresaId_ativo_idx" ON "CriterioPontuacao"("empresaId", "ativo");

-- CreateIndex
CREATE INDEX "CriterioPontuacao_empresaId_evento_idx" ON "CriterioPontuacao"("empresaId", "evento");

-- CreateIndex
CREATE INDEX "AvaliacaoCriterio_empresaId_periodo_idx" ON "AvaliacaoCriterio"("empresaId", "periodo");

-- CreateIndex
CREATE INDEX "AvaliacaoCriterio_empresaId_funcionarioId_idx" ON "AvaliacaoCriterio"("empresaId", "funcionarioId");

-- CreateIndex
CREATE INDEX "RegistroGamificacao_empresaId_criterioId_idx" ON "RegistroGamificacao"("empresaId", "criterioId");

-- CreateIndex
-- A trava de não-duplicar: um critério, uma pessoa, um período.
CREATE UNIQUE INDEX "AvaliacaoCriterio_criterioId_funcionarioId_periodo_key" ON "AvaliacaoCriterio"("criterioId", "funcionarioId", "periodo");

-- AddForeignKey
ALTER TABLE "AvaliacaoCriterio" ADD CONSTRAINT "AvaliacaoCriterio_criterioId_fkey" FOREIGN KEY ("criterioId") REFERENCES "CriterioPontuacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- `SetNull`: apagar um critério não pode apagar o saldo que ele já gerou.
ALTER TABLE "RegistroGamificacao" ADD CONSTRAINT "RegistroGamificacao_criterioId_fkey" FOREIGN KEY ("criterioId") REFERENCES "CriterioPontuacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

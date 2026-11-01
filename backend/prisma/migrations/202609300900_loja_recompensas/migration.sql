-- Ciclo 4 — Loja de Recompensas e Resgates.
--
-- POR QUE DUAS TABELAS
-- -------------------
-- `Recompensa` é o CATÁLOGO (o que a empresa oferece, custo, estoque) e
-- `ResgateRecompensa` é a TRANSAÇÃO (quem pegou, quando, em que status).
-- Uma tabela só misturaria "a empresa tem 10 vale-presente" com "a Ana pegou
-- um deles" — e o estoque não se contaria.
--
-- SALDO DE PONTOS
-- ---------------
-- `RegistroGamificacao` só SOMA pontos; o resgate DEBITA. O saldo é calculado
-- em tempo de consulta como:
--
--     saldo = soma(registros com status ATIVO)
--           − soma(resgates com status APROVADO ou ENTREGUE)
--
-- e NÃO é uma coluna. Se fosse, o primeiro lançamento de pontos já a deixaria
-- fora do valor real, e ninguém saberia por quê. Um registro ANULADO deixa de
-- contar, e um resgate CANCELADO ou REJEITADO devolve os pontos pela própria
-- fórmula — sem um lançamento negativo espelhado, que duplicaria a conta.
--
-- ESTOQUE
-- -------
-- `quantidadeDisponivel` é o estoque real, e um resgate SOLICITADO já o
-- reserva: é o que impede que três pessoas resgatem o último vale-presente
-- antes de alguém aprovar. Cancelar e rejeitar devolvem ao estoque, na mesma
-- transação que muda o status.
--
-- HISTÓRICO
-- ----------
-- Rejeitar ou cancelar NÃO apaga a linha — ela vira histórico, com data,
-- pontos e quem decidiu. `pontosUtilizados` é o custo CONGELADO no momento do
-- resgate: se a empresa reajustar o preço depois, o registro continua dizendo
-- o que a pessoa pagou.
--
-- MULTI-TENANT E CASCATAS
-- ------------------------
-- `empresaId` como coluna escalar com índice, o padrão do projeto.
-- `recompensaId` CASCADE: a transação não sobrevive ao item do catálogo — e é
-- isso que evita linhas órfãs quando uma recompensa é desativada.
-- `funcionarioId` é coluna escalar SEM FK, como `AcaoRadar.responsavelId` e
-- `PlanoDesenvolvimento`: desligar a pessoa não pode apagar o histórico de
-- que ela resgatou. O nome é resolvido em consulta à parte.

CREATE TYPE "CategoriaRecompensa" AS ENUM (
    'BENEFICIO',
    'EXPERIENCIA',
    'CURSO',
    'ALIMENTACAO',
    'FOLGA',
    'BRINDE',
    'OUTRO'
);

CREATE TYPE "StatusResgate" AS ENUM (
    'SOLICITADO',
    'APROVADO',
    'ENTREGUE',
    'REJEITADO',
    'CANCELADO'
);

CREATE TABLE "Recompensa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" "CategoriaRecompensa" NOT NULL DEFAULT 'OUTRO',
    "custoPontos" INTEGER NOT NULL,
    -- 0 significa ESGOTADO, e some da vitrine. Não é "sem limite": isso seria
    -- outra decisão e teria outro campo.
    "quantidadeDisponivel" INTEGER NOT NULL DEFAULT 0,
    -- false ESCONDE da loja sem apagar o histórico de quem já resgatou.
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recompensa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Recompensa_empresaId_ativa_idx" ON "Recompensa"("empresaId", "ativa");
CREATE INDEX "Recompensa_empresaId_categoria_idx" ON "Recompensa"("empresaId", "categoria");

CREATE TABLE "ResgateRecompensa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "recompensaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    -- Custo congelado no resgate. Se o preço mudar depois, o histórico
    -- continua dizendo o que foi pago.
    "pontosUtilizados" INTEGER NOT NULL,
    "status" "StatusResgate" NOT NULL DEFAULT 'SOLICITADO',
    "aprovadoPorId" TEXT,
    -- DATE (@db.Date): o dia do fato, sem hora e sem fuso.
    "data" DATE NOT NULL,
    "aprovadoEm" DATE,
    "entregueEm" DATE,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResgateRecompensa_pkey" PRIMARY KEY ("id")
);

-- Histórico do funcionário e fila de aprovação do gestor.
CREATE INDEX "ResgateRecompensa_empresaId_funcionarioId_data_idx"
    ON "ResgateRecompensa"("empresaId", "funcionarioId", "data");
CREATE INDEX "ResgateRecompensa_empresaId_status_idx"
    ON "ResgateRecompensa"("empresaId", "status");

ALTER TABLE "ResgateRecompensa" ADD CONSTRAINT "ResgateRecompensa_recompensaId_fkey" FOREIGN KEY ("recompensaId") REFERENCES "Recompensa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

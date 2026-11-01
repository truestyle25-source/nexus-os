-- Ciclo 3 — Liderança Empática: registro de feedback.
--
-- POR QUE UMA TABELA NOVA E NÃO REAPROVEITAR `RegistroGamificacao`
-- ---------------------------------------------------------------------
-- `RegistroGamificacao` é PLACAR: pontos, regra que gerou o ponto, evento de
-- origem. Ele responde "quantos pontos a pessoa tem".
--
-- Feedback de liderança é CONVERSA: precisa guardar o que foi reconhecido, o
-- que precisa desenvolver, o que ficou acordado e QUANDO será revisado. Nada
-- disso cabe em `descricao TEXT` + `pontos INT` — forçar significaria
-- transformar "o gestor conversou com a pessoa" em "+20 pontos", que é o
-- oposto de liderança empática.
--
-- QUEM É "LÍDER"
-- --------------
-- Não existe coluna `lideranca` e NENHUMA foi criada: a decisão foi inferir do
-- CARGO, que já existe e já é do gestor. Se ninguém cadastrar o cargo como
-- "Líder", ninguém é considerado líder — e o sistema informa isso em vez de
-- inventar. A lista de termos mora em `src/modules/rh/lideranca.ts`.
--
-- MULTI-TENANT
-- ------------
-- `empresaId` como coluna escalar com índice, o padrão de `AcaoRadar`,
-- `Treinamento` e `PlanoDesenvolvimento`.
--
-- CASCATA
-- ------
-- `funcionarioId` CASCADE: o histórico de conversa não sobrevive ao
-- desligamento da pessoa. A conversa é dado da RELAÇÃO entre duas pessoas da
-- mesma empresa; sem uma das duas, o registro não descreve nada.
--
-- `aplicadoPorId` é coluna escalar, SEM FK, como `AcaoRadar.responsavelId` e
-- `AcaoRadar` faz com o `Usuario`: remover um usuário não pode apagar o
-- histórico do que ele registrou. O nome é resolvido em consulta à parte.

CREATE TYPE "TipoFeedback" AS ENUM (
    'POSITIVO',
    'DESENVOLVIMENTO',
    'ACORDO'
);

CREATE TYPE "StatusAcompanhamento" AS ENUM (
    'PENDENTE',
    'REALIZADO',
    'CANCELADO'
);

CREATE TABLE "FeedbackLideranca" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "aplicadoPorId" TEXT NOT NULL,
    -- DATE (@db.Date): o dia da conversa, sem hora e sem fuso, pelo mesmo
    -- motivo de `Funcionario.horarioEntradaPrevisto`.
    "data" DATE NOT NULL,
    "tipo" "TipoFeedback" NOT NULL DEFAULT 'POSITIVO',

    -- Os três blocos que o gestor escreve. `acordos` é o que ficou
    -- combinado — é o campo que diferencia um feedback de um registro de
    -- conversa. Ambos os blocos de texto são NOT NULL porque um feedback sem
    -- "o que desenvolver" não é acompanhamento, é elogio.
    "pontosPositivos" TEXT NOT NULL,
    "pontosADesenvolver" TEXT NOT NULL,
    "acordos" TEXT,

    -- NULL = "sem data marcada", que é escolha do gestor, e não
    -- "esquecido pelo sistema".
    "proximoAcompanhamento" DATE,
    "status" "StatusAcompanhamento" NOT NULL DEFAULT 'PENDENTE',
    "realizadoEm" DATE,

    "observacoes" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackLideranca_pkey" PRIMARY KEY ("id")
);

-- Histórico geral, histórico por pessoa, e a FILA de acompanhamento.
CREATE INDEX "FeedbackLideranca_empresaId_data_idx" ON "FeedbackLideranca"("empresaId", "data");
CREATE INDEX "FeedbackLideranca_empresaId_funcionarioId_idx" ON "FeedbackLideranca"("empresaId", "funcionarioId");
CREATE INDEX "FeedbackLideranca_empresaId_status_proximoAcompanhamento_idx"
    ON "FeedbackLideranca"("empresaId", "status", "proximoAcompanhamento");

ALTER TABLE "FeedbackLideranca" ADD CONSTRAINT "FeedbackLideranca_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

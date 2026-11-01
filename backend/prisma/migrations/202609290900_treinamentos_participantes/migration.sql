-- Ciclo 2 — Treinamentos, participantes e presença.
--
-- Duas tabelas e três enums.
--
-- POR QUE TABELAS NOVAS (e não reaproveitar `AcaoRadar` / `PlanoDesenvolvimento`)
-- ----------------------------------------------------------------------------
-- Um treinamento é um EVENTO com data, hora, instrutor e local. Nada disso
-- existe nas entidades atuais: `AvaliacaoComportamental` é uma medição
-- pontual, `PlanoDesenvolvimento` é um compromisso de desenvolvimento e
-- `AcaoRadar` é reação a um alerta. A ação `TREINAMENTO` do plano é um TEXTO
-- dentro de um array — sem data, sem sala, sem lista de quem compareceu.
--
-- POR QUE TABELA PARA PARTICIPANTES (e não array JSON)
-- ---------------------------------------------------
-- O projeto guarda listas em `Json` quando elas são texto livre e consultadas
-- nunca (`acoes` do plano, `causas` do alerta). Aqui a lista É a consulta:
-- quem presente, quem faltou, histórico de um funcionário. Isso exige linha,
-- índice e chave única — o mesmo caminho de `Ponto` com
-- `@@unique([funcionarioId, data])`.
--
-- SEPARADO DO PONTO, DE PROPÓSITO
-- -------------------------------
-- Presença em treinamento NÃO gera falta, NÃO gera hora extra e NÃO entra no
-- espelho de ponto. Um treinamento de 2h não pode aparecer como "2 horas
-- trabalhadas" na folha. Misturar os dois contaminaria o cálculo de jornada
-- com capacitação — e a ausência em treinamento jamais poderia ser tratada
-- como falta disciplinar.
--
-- HORÁRIO COMO TEXTO
-- ------------------
-- `horaInicio`/`horaFim` são VARCHAR 'HH:MM' e não `TIME`, exatamente pela
-- razão documentada em `Funcionario.horarioEntradaPrevisto`: horário não tem
-- fuso, e um tipo de data/hora no banco convida o bug de fuso que o projeto já
-- cometeu três vezes (13º, indicadores e marcação de ponto) — o valor lido em
-- UTC e o mostrado em São Paulo divergem. 'HH:MM' é texto puro: ordena,
-- subtrai e chega intacto na tela, no PDF e na API.
--
-- MULTI-TENANT
-- ------------
-- `empresaId` como coluna escalar com índice, padrão de `AcaoRadar`,
-- `AvaliacaoComportamental` e `PlanoDesenvolvimento`. Em `ParticipanteTreinamento`
-- ela é redundante com a do treinamento e fica mesmo assim: permite filtrar em
-- UMA tabela só, sem join, e garante que uma limpeza em massa de uma empresa
-- não alcance registros de outra.
--
-- CASCATAS
-- --------
-- `funcionarioId` CASCADE — a participação não sobrevive à pessoa.
-- `treinamentoId` CASCADE — não sobrevive ao treinamento, e é o que evita
-- linhas órfãs quando um cancelamento remove o evento.

-- Enums ----------------------------------------------------------------------

CREATE TYPE "StatusTreinamento" AS ENUM (
    'PLANEJADO',
    'AGENDADO',
    'EM_ANDAMENTO',
    'CONCLUIDO',
    'CANCELADO'
);

CREATE TYPE "PrioridadeTreinamento" AS ENUM (
    'BAIXA',
    'MEDIA',
    'ALTA'
);

-- `CONVIDADO`/`CONFIRMADO` descrevem a INTENÇÃO; `PRESENTE`/`AUSENTE`
-- descrevem o que ACONTECEU. São estados diferentes de propósito: um
-- treinamento CONCLUIDO com gente ainda em `CONFIRMADO` tem ausência não
-- registrada, e a tela precisa poder dizer isso em vez de mostrar 100%
-- presente por omissão.
CREATE TYPE "StatusParticipante" AS ENUM (
    'CONVIDADO',
    'CONFIRMADO',
    'PRESENTE',
    'AUSENTE',
    'CANCELADO'
);

-- Tabela: Treinamento ------------------------------------------------------

CREATE TABLE "Treinamento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    -- Catálogo livre de texto (ex.: 'COMUNICACAO', 'SEGURANCA'). Sem tabela
    -- de categorias, como em `Produto.categoria` e `Meta.tipo`.
    "categoria" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    -- Texto, e não relação com Usuario: o instrutor quase nunca tem login no
    -- sistema (consultor, parceiro), e criar um cadastro para ele seria
    -- inventar dado.
    "instrutor" TEXT NOT NULL,
    "responsavelId" TEXT,
    -- DATE (@db.Date): o dia do fato, sem hora.
    "data" DATE NOT NULL,
    -- VARCHAR 'HH:MM' — ver a nota sobre fuso no topo.
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    -- Minutos, sempre DEDUZIDO de horaInicio/horaFim pela rota. A coluna
    -- existe para que a consulta de carga não precise recalcular, e é escrita
    -- junto com as duas — nunca por conta própria.
    "duracaoMinutos" INTEGER NOT NULL,
    "local" TEXT NOT NULL,
    -- NULL = sem limite. 0 NÃO é "sem limite": 0 seria "ninguém pode
    -- participar", que é uma decisão, não ausência de decisão.
    "limiteParticipantes" INTEGER,
    "status" "StatusTreinamento" NOT NULL DEFAULT 'PLANEJADO',
    -- Ligação opcional ao plano de desenvolvimento que motivou o treinamento.
    -- Scalar, sem FK: apagar o plano não pode apagar o registro histórico de
    -- que ele capacity.
    "planoDesenvolvimentoId" TEXT,
    -- Sugestão da IA que o gestor revisou. NULL quando não houve IA — o
    -- treinamento é válido de qualquer forma, e `origem` diz como nasceu.
    "analiseIA" JSONB,
    "observacoes" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Treinamento_pkey" PRIMARY KEY ("id")
);

-- A listagem da empresa (qualquer filtro), a agenda por data, e a ordenação do
-- histórico por criação.
CREATE INDEX "Treinamento_empresaId_status_idx" ON "Treinamento"("empresaId", "status");
CREATE INDEX "Treinamento_empresaId_data_idx" ON "Treinamento"("empresaId", "data");
CREATE INDEX "Treinamento_empresaId_createdAt_idx" ON "Treinamento"("empresaId", "createdAt");

-- Tabela: ParticipanteTreinamento -------------------------------------------

CREATE TABLE "ParticipanteTreinamento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "treinamentoId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "status" "StatusParticipante" NOT NULL DEFAULT 'CONVIDADO',
    "observacao" TEXT,
    -- Momento em que a pessoa entrou na lista, não em que o treinamento
    -- ocorreu: é o que ordena o histórico de capacitação de cada um.
    "dataRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticipanteTreinamento_pkey" PRIMARY KEY ("id")
);

-- Impede o mesmo funcionário entrar duas vezes no mesmo treinamento. É uma
-- restrição de BANCO, não da aplicação: um duplo clique ou dois requests
-- simultâneos criariam linhas duplicadas sem ela.
CREATE UNIQUE INDEX "ParticipanteTreinamento_treinamentoId_funcionarioId_key"
    ON "ParticipanteTreinamento"("treinamentoId", "funcionarioId");

-- Histórico do funcionário e chamada de presença.
CREATE INDEX "ParticipanteTreinamento_empresaId_funcionarioId_dataRegistro_idx"
    ON "ParticipanteTreinamento"("empresaId", "funcionarioId", "dataRegistro");
CREATE INDEX "ParticipanteTreinamento_empresaId_treinamentoId_status_idx"
    ON "ParticipanteTreinamento"("empresaId", "treinamentoId", "status");

-- Chaves estrangeiras ----------------------------------------------------------
-- CASCADE nas duas: a participação não sobrevive ao treinamento nem ao
-- desligamento da pessoa. Preservar histórico é feito por CANCELAR o
-- treinamento (que mantém a linha), não por impedir a exclusão do registro.

ALTER TABLE "ParticipanteTreinamento" ADD CONSTRAINT "ParticipanteTreinamento_treinamentoId_fkey" FOREIGN KEY ("treinamentoId") REFERENCES "Treinamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParticipanteTreinamento" ADD CONSTRAINT "ParticipanteTreinamento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

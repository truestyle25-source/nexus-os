-- Ciclo 1 — Plano de Desenvolvimento DISC.
--
-- Uma tabela nova (`PlanoDesenvolvimento`) e quatro enums.
--
-- POR QUE NÃO REAPROVEITAR `AcaoRadar`
-- -------------------------------------
-- `AcaoRadar` é o plano de ação derivado de um ALERTA: `alertaRef` e
-- `alertaTitulo` são NOT NULL porque a linha só existe junto de um alerta, e é
-- o `alertaRef` que faz o badge do alerta virar "Em ação"/"Resolvido" em
-- radar.routes.ts. O plano de desenvolvimento parte de uma AVALIAÇÃO e não tem
-- alerta de origem. Forçar o reuso exigiria tornar essas duas colunas
-- opcionais e adicionar seis campos, deixando a tabela guardando duas coisas
-- distintas com o mesmo nome.
--
-- SEGURANÇA DE DOMÍNIO GRAVADA NO BANCO
-- -------------------------------------
-- `perfil` e `scores` NÃO têm como ser preenchidos pela IA: eles são gravados
-- pelo servidor a partir de `avaliacaoId`. A IA escreve apenas em `analiseIA`.
-- É uma decisão de modelagem, não de confiança no código — não existe coluna que
-- a IA possa usar para alterar um percentual.
--
-- MULTI-TENANT
-- ------------
-- `empresaId` segue o padrão do projeto (RegistroGamificacao, AcaoRadar,
-- AvaliacaoComportamental): coluna escalar com índice, sem FK para Empresa.
-- A garantia de isolamento é a disciplina de código — toda consulta passa
-- `empresaId` vindo do token. Já a relação com `Funcionario` TEM FK com
-- CASCADE: plano não sobrevive à pessoa, e uma empresa não consegue criar
-- plano apontando para funcionário de outra (a FK valida, e a rota valida de
-- novo antes de gravar).

-- Enums ----------------------------------------------------------------------

CREATE TYPE "StatusPlanoDesenvolvimento" AS ENUM (
    'PLANEJADO',
    'EM_ANDAMENTO',
    'CONCLUIDO',
    'CANCELADO'
);

CREATE TYPE "ObjetivoDesenvolvimento" AS ENUM (
    'COMUNICACAO',
    'LIDERANCA',
    'ORGANIZACAO',
    'TRABALHO_EM_EQUIPE',
    'GESTAO_DE_CONFLITOS',
    'ATENDIMENTO',
    'OUTRO'
);

CREATE TYPE "CompetenciaDesenvolvimento" AS ENUM (
    'COMUNICACAO',
    'LIDERANCA',
    'ORGANIZACAO',
    'TRABALHO_EM_EQUIPE',
    'GESTAO_DE_CONFLITOS',
    'ATENDIMENTO',
    'PROATIVIDADE',
    'ADAPTABILIDADE',
    'OUTRO'
);

CREATE TYPE "TipoAcaoDesenvolvimento" AS ENUM (
    'TREINAMENTO',
    'ACOMPANHAMENTO',
    'FEEDBACK',
    'EXERCICIO_PRATICO',
    'MENTORIA',
    'OUTRO'
);

-- Tabela ---------------------------------------------------------------------

CREATE TABLE "PlanoDesenvolvimento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "avaliacaoId" TEXT NOT NULL,

    -- Snapshot do momento da criação. Sem estes, o histórico mudaria de
    -- significado quando uma avaliação nova entrasse: um plano de 2026
    -- passaria a exibir o perfil de 2027.
    "perfil" "PerfilDisc",
    "scores" JSONB,

    "objetivo" "ObjetivoDesenvolvimento" NOT NULL,
    "competencia" "CompetenciaDesenvolvimento" NOT NULL,
    "descricao" TEXT NOT NULL,

    -- [{ tipo, descricao, concluida }] — `concluida` é o progresso do gestor.
    -- Nenhuma ação nasce concluída; o Radar abria o modal marcando as duas
    -- primeiras, e o bug foi corrigido em paralelo.
    "acoes" JSONB NOT NULL,

    "responsavelId" TEXT,
    -- DATE (@db.Date): o dia do fato, sem hora. Mesmo padrão de Ponto,
    -- Desligamento, AvaliacaoComportamental e RegistroGamificacao.
    "dataInicio" DATE NOT NULL,
    "prazo" DATE,
    "status" "StatusPlanoDesenvolvimento" NOT NULL DEFAULT 'PLANEJADO',

    -- Sugestão da IA + o que o gestor aceitou/editou/recusou.
    -- NULL quando a IA não respondeu: o plano continua válido e é montado à mão.
    "analiseIA" JSONB,
    "observacoes" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanoDesenvolvimento_pkey" PRIMARY KEY ("id")
);

-- Índices ---------------------------------------------------------------------
-- O Radar lista por empresa + status (painel de planos em andamento) e o
-- histórico do RH lista por empresa + funcionário. O terceiro cobre a ordenação
-- por data de criação, que é como o histórico é lido.

CREATE INDEX "PlanoDesenvolvimento_empresaId_status_idx" ON "PlanoDesenvolvimento"("empresaId", "status");
CREATE INDEX "PlanoDesenvolvimento_empresaId_funcionarioId_idx" ON "PlanoDesenvolvimento"("empresaId", "funcionarioId");
CREATE INDEX "PlanoDesenvolvimento_empresaId_createdAt_idx" ON "PlanoDesenvolvimento"("empresaId", "createdAt");

-- Chaves estrangeiras ----------------------------------------------------------
-- `avaliacaoId` SEM CASCADE: um plano referencia a avaliação que o originou, e
-- apagar a avaliação deixaria o plano sem a origem que o justificou. O
-- cancelamento é o caminho para dispensar um plano, não a exclusão.
--
-- `funcionarioId` COM CASCADE: o plano é da pessoa.

ALTER TABLE "PlanoDesenvolvimento" ADD CONSTRAINT "PlanoDesenvolvimento_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanoDesenvolvimento" ADD CONSTRAINT "PlanoDesenvolvimento_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "AvaliacaoComportamental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

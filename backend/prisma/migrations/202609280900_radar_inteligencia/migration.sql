-- Radar Organizacional — camada de inteligência (cross-módulo).
--
-- Quatro tabelas novas, todas multi-tenant (empresaId). Nenhuma duplica
-- estrutura existente; o motivo de cada uma está documentado no schema.prisma,
-- no bloco "Radar Organizacional".
--
-- 1) AvaliacaoComportamental — perfil DISC registrado pelo RH. Sem esta tabela
--    o campo é sempre null, porque não existe nenhum outro lugar no banco
--    onde uma avaliação comportamental humana seja guardada.
-- 2) PesquisaBemEstar — bem-estar é percepção humana; o Radar cruza, não mede.
-- 3) RegistroGamificacao — pontos/ganhos/reconhecimento. O prompt proíbe
--    localStorage para informação empresarial.
-- 4) AcaoRadar — plano de ação criado a partir de um alerta.
--
-- "Json" em Postgres é jsonb: guarda estrutura variável (scores por eixo, lista
-- de ações) sem criar uma tabela por eixo/atualização.
--
-- NOTA DE FUSO: `dataAvaliacao`, `dataPesquisa` e `data` são DATE (@db.Date) —
-- o dia que o fato ocorreu, sem hora. Já é o padrão do projeto em Ponto,
-- Desligamento e IndicadorDiario.

-- Enum do perfil comportamental. D/I/S/C são as letras do modelo DISC.
CREATE TYPE "PerfilDisc" AS ENUM ('D', 'I', 'S', 'C');

-- CreateTable
CREATE TABLE "AvaliacaoComportamental" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "perfil" "PerfilDisc",
    "scores" JSONB,
    "observacoes" TEXT,
    "aplicadoPorId" TEXT,
    "dataAvaliacao" DATE NOT NULL,
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvaliacaoComportamental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PesquisaBemEstar" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "resposta" TEXT,
    "dataPesquisa" DATE NOT NULL,
    "aplicadoPorId" TEXT,
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PesquisaBemEstar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroGamificacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "pontos" INTEGER NOT NULL DEFAULT 0,
    "regraId" TEXT,
    "eventoOrigem" TEXT,
    "eventoId" TEXT,
    "data" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistroGamificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcaoRadar" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "alertaRef" TEXT NOT NULL,
    "alertaTitulo" TEXT NOT NULL,
    "funcionarioId" TEXT,
    "responsavelId" TEXT,
    "acoes" JSONB NOT NULL,
    "prazo" DATE,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcaoRadar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvaliacaoComportamental_empresaId_funcionarioId_idx" ON "AvaliacaoComportamental"("empresaId", "funcionarioId");
CREATE INDEX "AvaliacaoComportamental_empresaId_dataAvaliacao_idx" ON "AvaliacaoComportamental"("empresaId", "dataAvaliacao");
CREATE INDEX "PesquisaBemEstar_empresaId_dataPesquisa_idx" ON "PesquisaBemEstar"("empresaId", "dataPesquisa");
CREATE INDEX "PesquisaBemEstar_empresaId_funcionarioId_idx" ON "PesquisaBemEstar"("empresaId", "funcionarioId");
CREATE INDEX "RegistroGamificacao_empresaId_data_idx" ON "RegistroGamificacao"("empresaId", "data");
CREATE INDEX "RegistroGamificacao_empresaId_tipo_idx" ON "RegistroGamificacao"("empresaId", "tipo");
CREATE INDEX "AcaoRadar_empresaId_status_idx" ON "AcaoRadar"("empresaId", "status");
CREATE INDEX "AcaoRadar_empresaId_createdAt_idx" ON "AcaoRadar"("empresaId", "createdAt");

-- AddForeignKey
ALTER TABLE "AvaliacaoComportamental" ADD CONSTRAINT "AvaliacaoComportamental_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PesquisaBemEstar" ADD CONSTRAINT "PesquisaBemEstar_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegistroGamificacao" ADD CONSTRAINT "RegistroGamificacao_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AcaoRadar" ADD CONSTRAINT "AcaoRadar_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

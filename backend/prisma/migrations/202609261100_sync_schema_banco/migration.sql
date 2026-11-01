-- ============================================================================
-- Sincroniza o BANCO com o schema.prisma (a tabela estava defasada).
--
-- Diagnóstico: o schema evoluiu (avisos, suspensões, vínculo de funcionário
-- com usuário, atualização de chave de API, local de estoque), mas essas
-- mudanças nunca viraram migração. Resultado no ambiente: `GET /funcionarios`
-- respondia 500 ("column Funcionario.usuarioId does not exist"), a tabela
-- Suspensao NÃO EXISTIA e três colunas faltavam.
--
-- DECISÃO DELIBERADA: a tabela "Importacao" existe no banco e tem 1 linha real,
-- mas não está no schema. O `prisma migrate diff` sugeria DROP TABLE — NÃO foi
-- feito de propósito: apagar dado de cliente para alinhar o schema seria
-- perder informação. A tabela e suas constraints foram preservadas, e por isso
-- esta migração NÃO zera o drift; é um rest conscious de não destruir dado.
--
-- As FKs de Caixa/ChaveApi foram removidas pelo diff porque não apontam para
-- nenhuma tabela do schema. Serão recriadas aqui.
-- ============================================================================

-- Enums que faltavam no banco
CREATE TYPE "TipoAdvertencia" AS ENUM ('VERBAL', 'ESCRITA', 'SUSPENSAO');

-- Tabela que não existia (aba Suspensões do RH)
CREATE TABLE "Suspensao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "funcionarioId" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "aplicadaPor" TEXT,
    "statusPedido" TEXT NOT NULL DEFAULT 'APLICADA',
    "documentoNome" TEXT,
    "documentoGeradoEm" TIMESTAMP(3),
    "origem" "Origem" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suspensao_pkey" PRIMARY KEY ("id")
);

-- Colunas que faltavam.
-- `Advertencia` foi criada no banco SEM a coluna `empresaId` que o schema
-- declara: por isso o índice (empresaId, funcionarioId) nem podia ser criado.
-- A tabela está vazia hoje, mas o preenchimento vem do funcionário para não
-- quebrar ambientes que já tenham registro.
ALTER TABLE "Advertencia" ADD COLUMN     "empresaId" TEXT;

UPDATE "Advertencia" a
   SET "empresaId" = f."empresaId"
  FROM "Funcionario" f
 WHERE f."id" = a."funcionarioId";

ALTER TABLE "Advertencia" ALTER COLUMN "empresaId" SET NOT NULL;

ALTER TABLE "Advertencia" ADD COLUMN     "aplicadaPor" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "documentoGeradoEm" TIMESTAMP(3),
ADD COLUMN     "documentoNome" TEXT,
ADD COLUMN     "statusPedido" TEXT NOT NULL DEFAULT 'APLICADA';

ALTER TABLE "ChaveApi" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Estoque" ADD COLUMN     "local" TEXT;

ALTER TABLE "Funcionario" ADD COLUMN     "biometriaId" TEXT,
ADD COLUMN     "cargaHoraria" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "fotoUrl" TEXT,
ADD COLUMN     "jornada" TEXT,
ADD COLUMN     "matricula" TEXT,
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "pis" TEXT,
ADD COLUMN     "re" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "salario" DECIMAL(12,2),
ADD COLUMN     "telefone" TEXT,
ADD COLUMN     "tipoContrato" TEXT,
ADD COLUMN     "usuarioId" TEXT;
-- `origem` e `status` JÁ EXISTIAM em Funcionario (14 colunas no banco), por isso
-- não entram no ADD COLUMN acima.

-- Índices
CREATE INDEX "Suspensao_empresaId_funcionarioId_idx" ON "Suspensao"("empresaId", "funcionarioId");
CREATE INDEX "Advertencia_empresaId_funcionarioId_idx" ON "Advertencia"("empresaId", "funcionarioId");
CREATE INDEX "ChaveApi_status_idx" ON "ChaveApi"("status");
CREATE INDEX "Funcionario_usuarioId_idx" ON "Funcionario"("usuarioId");

-- Chave estrangeira do vínculo funcionário <-> usuário
ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Suspensao" ADD CONSTRAINT "Suspensao_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recria as FKs que o diff suggested remover (as tabelas existem no schema)

-- NOTA: as FKs Caixa_empresaId_fkey e ChaveApi_empresaId_fkey JA EXISTEM no
-- banco e estao corretas. O `prisma migrate diff` as remove e recria so porque
-- o schema nao declara `relation` para elas; recriar aqui daria "constraint
-- already exists". Sao deixadas como estao: sao integridade real, nao lixo, e
-- apaga-las so para agradar o diff seria perder seguranca.

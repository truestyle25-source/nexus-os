-- =============================================================================
-- Sincroniza o banco com o schema.prisma (drift detectado em 2026-11-20).
--
-- Diagnóstico: a produção é idêntica às 49 migrações anteriores; o schema.prisma
-- foi editado sem gerar migração. O `prisma migrate diff` automático usaria
-- DROP COLUMN + ADD COLUMN em ConsumoInterno.origem e TipoProduto.codigo (perda
-- de dados se houvesse linhas). Esta versão CONVERTE os tipos no lugar (USING),
-- preservando valores. Em 2026-11-20 todas as tabelas afetadas estavam vazias
-- na produção (0 linhas).
--
-- Depois de aplicar: rodar prisma/seguranca/01_rls_policies.sql (NexusErpRecord
-- é tabela nova e precisa de RLS; o script falha se alguma ficar sem).
-- =============================================================================

-- Enums declarados no schema.prisma
CREATE TYPE "DimensaoTipo" AS ENUM ('MASSA', 'VOLUME', 'CONTAGEM', 'COMPRIMENTO', 'EMBALAGEM');
CREATE TYPE "TipoProdutoEnum" AS ENUM ('MERCADORIA', 'INSUMO', 'FABRICADO', 'USO_INTERNO');

-- ConsumoInterno.origem: text -> enum Origem (conversão no lugar)
ALTER TABLE "ConsumoInterno" ALTER COLUMN "origem" DROP DEFAULT;
ALTER TABLE "ConsumoInterno" ALTER COLUMN "origem" TYPE "Origem" USING "origem"::"Origem";
ALTER TABLE "ConsumoInterno" ALTER COLUMN "origem" SET DEFAULT 'MANUAL';

-- Precisão monetária (2 casas), como no schema
ALTER TABLE "Estoque" ALTER COLUMN "valorTotal" SET DATA TYPE DECIMAL(14,2);
ALTER TABLE "EstoqueSnapshotDiario" ALTER COLUMN "valorTotal" SET DATA TYPE DECIMAL(14,2);
ALTER TABLE "ProducaoKit" ALTER COLUMN "custoTotal" SET DATA TYPE DECIMAL(14,2);
ALTER TABLE "ProducaoKit" ALTER COLUMN "quantidadeProduzida" DROP DEFAULT;

-- TipoProduto.codigo: text -> enum TipoProdutoEnum (conversão no lugar)
ALTER TABLE "TipoProduto" ALTER COLUMN "codigo" TYPE "TipoProdutoEnum" USING "codigo"::"TipoProdutoEnum";
-- CreateTable
CREATE TABLE "NexusErpRecord" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "data" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NexusErpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NexusErpRecord_empresaId_module_createdAt_idx" ON "NexusErpRecord"("empresaId", "module", "createdAt");

-- CreateIndex
CREATE INDEX "NexusErpRecord_empresaId_status_idx" ON "NexusErpRecord"("empresaId", "status");

-- CreateIndex
CREATE INDEX "NexusErpRecord_empresaId_title_idx" ON "NexusErpRecord"("empresaId", "title");

-- CreateIndex
-- Já existe na produção; a conversão no lugar o preserva (o diff automático o recriaria após DROP COLUMN).
CREATE UNIQUE INDEX IF NOT EXISTS "TipoProduto_empresaId_codigo_key" ON "TipoProduto"("empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "Dimensao" ADD CONSTRAINT "Dimensao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unidade" ADD CONSTRAINT "Unidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoProduto" ADD CONSTRAINT "TipoProduto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FatorConversao" ADD CONSTRAINT "FatorConversao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NexusErpRecord" ADD CONSTRAINT "NexusErpRecord_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NEXUS OS: Fase 3 (Compras/Fornecedores/Clientes) — decisões arquiteturais
-- 1 e 2 do pedido do usuário. Escrita manualmente (sem banco/rede neste
-- ambiente). Rodar `npx prisma migrate diff` contra schema.prisma antes de
-- aplicar (mesmo procedimento das migrações anteriores).

-- Decisão 1: Compra.filialId (destino), definida na criação da compra.
-- Se "Compra" já tiver linhas em produção, faça o backfill de "filialId"
-- ANTES de aplicar o NOT NULL — não há como inferir com segurança a filial
-- de uma compra antiga a partir dos dados existentes (o campo não existia).
ALTER TABLE "Compra" ADD COLUMN "filialId" TEXT;
-- Ambiente sem dados de produção: aplicar o NOT NULL direto.
ALTER TABLE "Compra" ALTER COLUMN "filialId" SET NOT NULL;
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_filialId_fkey"
  FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Compra_empresaId_filialId_idx" ON "Compra"("empresaId", "filialId");

-- Decisão 2: snapshot diário de estoque, base para giro real (Seção 9).
CREATE TABLE "EstoqueSnapshotDiario" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "filialId" TEXT NOT NULL,
  "produtoId" TEXT NOT NULL,
  "data" TIMESTAMP(3) NOT NULL,
  "quantidade" INTEGER NOT NULL,
  "custoUnitario" DECIMAL(10,2) NOT NULL,
  "valorTotal" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstoqueSnapshotDiario_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EstoqueSnapshotDiario_filialId_produtoId_data_key" ON "EstoqueSnapshotDiario"("filialId", "produtoId", "data");
CREATE INDEX "EstoqueSnapshotDiario_empresaId_data_idx" ON "EstoqueSnapshotDiario"("empresaId", "data");
ALTER TABLE "EstoqueSnapshotDiario" ADD CONSTRAINT "EstoqueSnapshotDiario_filialId_fkey"
  FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstoqueSnapshotDiario" ADD CONSTRAINT "EstoqueSnapshotDiario_produtoId_fkey"
  FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

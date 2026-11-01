ALTER TABLE "Produto"
  ADD COLUMN "ehKit" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ComposicaoKit" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "kitProdutoId" TEXT NOT NULL,
  "ingredienteProdutoId" TEXT NOT NULL,
  "quantidadePorKit" DECIMAL(12,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComposicaoKit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ComposicaoKit_quantidadePorKit_check" CHECK ("quantidadePorKit" > 0),
  CONSTRAINT "ComposicaoKit_kitProdutoId_fkey" FOREIGN KEY ("kitProdutoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ComposicaoKit_ingredienteProdutoId_fkey" FOREIGN KEY ("ingredienteProdutoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ComposicaoKit_kitProdutoId_ingredienteProdutoId_key" ON "ComposicaoKit"("kitProdutoId", "ingredienteProdutoId");
CREATE INDEX "ComposicaoKit_empresaId_kitProdutoId_idx" ON "ComposicaoKit"("empresaId", "kitProdutoId");
CREATE INDEX "ComposicaoKit_empresaId_ingredienteProdutoId_idx" ON "ComposicaoKit"("empresaId", "ingredienteProdutoId");

CREATE TABLE "ProducaoKit" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "filialId" TEXT NOT NULL,
  "produtoKitId" TEXT NOT NULL,
  "usuarioId" TEXT,
  "quantidade" INTEGER NOT NULL,
  "custoUnitario" DECIMAL(10,2) NOT NULL,
  "custoTotal" DECIMAL(12,2) NOT NULL,
  "composicaoSnapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProducaoKit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProducaoKit_quantidade_check" CHECK ("quantidade" > 0),
  CONSTRAINT "ProducaoKit_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProducaoKit_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProducaoKit_produtoKitId_fkey" FOREIGN KEY ("produtoKitId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProducaoKit_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProducaoKit_empresaId_idempotencyKey_key" ON "ProducaoKit"("empresaId", "idempotencyKey");
CREATE INDEX "ProducaoKit_empresaId_produtoKitId_createdAt_idx" ON "ProducaoKit"("empresaId", "produtoKitId", "createdAt");
CREATE INDEX "ProducaoKit_filialId_createdAt_idx" ON "ProducaoKit"("filialId", "createdAt");

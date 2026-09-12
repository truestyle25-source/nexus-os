-- NEXUS OS: integrity/security corrections
ALTER TABLE "VendaItem" ADD COLUMN "custoUnitario" DECIMAL(10,2);
UPDATE "VendaItem" vi SET "custoUnitario" = p."custo" FROM "Produto" p WHERE p."id" = vi."produtoId" AND vi."custoUnitario" IS NULL;
ALTER TABLE "VendaItem" ALTER COLUMN "custoUnitario" SET DEFAULT 0;
ALTER TABLE "VendaItem" ALTER COLUMN "custoUnitario" SET NOT NULL;
ALTER TABLE "IntegracaoPonto" ADD COLUMN "senhaCriptografada" TEXT;
CREATE TABLE "TokenRevogado" (
  "id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRevogado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TokenRevogado_jti_key" ON "TokenRevogado"("jti");
CREATE INDEX "TokenRevogado_expiraEm_idx" ON "TokenRevogado"("expiraEm");

ALTER TABLE "Produto" DROP CONSTRAINT IF EXISTS "Produto_sku_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Produto_empresaId_sku_key" ON "Produto"("empresaId","sku");
ALTER TABLE "Funcionario" DROP CONSTRAINT IF EXISTS "Funcionario_cpf_key";
ALTER TABLE "Funcionario" DROP CONSTRAINT IF EXISTS "Funcionario_idExternoPonto_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Funcionario_empresaId_cpf_key" ON "Funcionario"("empresaId","cpf");
CREATE UNIQUE INDEX IF NOT EXISTS "Funcionario_empresaId_idExternoPonto_key" ON "Funcionario"("empresaId","idExternoPonto");

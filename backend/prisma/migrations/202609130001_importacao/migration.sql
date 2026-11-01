CREATE TABLE "Importacao" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "mapeamento" JSONB,
  "erros" JSONB,
  "qtdTotal" INTEGER NOT NULL DEFAULT 0,
  "qtdImportada" INTEGER NOT NULL DEFAULT 0,
  "qtdErro" INTEGER NOT NULL DEFAULT 0,
  "origem" "Origem" NOT NULL DEFAULT 'IMPORTADO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Importacao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Importacao_empresaId_createdAt_idx" ON "Importacao"("empresaId", "createdAt");
ALTER TABLE "Importacao" ADD CONSTRAINT "Importacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Importacao" ADD CONSTRAINT "Importacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

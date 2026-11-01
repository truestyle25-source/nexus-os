-- Seção 36 — API pública NEXUS: tabela de chaves de API por empresa.
-- Escrita à mão pelo mesmo motivo documentado em DEBITO-TECNICO.md
-- (itens 3 e 6): sem banco/rede neste ambiente para gerar via
-- `prisma migrate dev`. Rodar `prisma migrate diff` (mesmo comando do
-- item 3) antes de aplicar em qualquer ambiente real.

CREATE TABLE "ChaveApi" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "chaveHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "escopos" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "ultimoUso" TIMESTAMP(3),
    "criadaPorUsuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),

    CONSTRAINT "ChaveApi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChaveApi_chaveHash_key" ON "ChaveApi"("chaveHash");
CREATE INDEX "ChaveApi_empresaId_idx" ON "ChaveApi"("empresaId");

ALTER TABLE "ChaveApi" ADD CONSTRAINT "ChaveApi_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

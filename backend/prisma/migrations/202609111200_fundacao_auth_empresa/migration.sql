-- NEXUS OS: fundação (auth/empresa/permissões)
-- Escrita manualmente porque este ambiente não tem acesso ao registry do npm
-- nem a um banco Postgres para rodar `prisma migrate dev`. Antes de aplicar,
-- rode `npx prisma migrate diff` (ou `migrate dev` num ambiente com banco)
-- para confirmar que este SQL corresponde exatamente ao schema.prisma atual.

ALTER TABLE "Empresa" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ATIVO';

CREATE TABLE "TokenRecuperacaoSenha" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "usadoEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenRecuperacaoSenha_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TokenRecuperacaoSenha_tokenHash_key" ON "TokenRecuperacaoSenha"("tokenHash");
CREATE INDEX "TokenRecuperacaoSenha_usuarioId_idx" ON "TokenRecuperacaoSenha"("usuarioId");
CREATE INDEX "TokenRecuperacaoSenha_expiraEm_idx" ON "TokenRecuperacaoSenha"("expiraEm");
ALTER TABLE "TokenRecuperacaoSenha" ADD CONSTRAINT "TokenRecuperacaoSenha_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

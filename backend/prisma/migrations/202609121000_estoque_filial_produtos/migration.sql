-- NEXUS OS: Produtos + Estoque
-- Escrita manualmente (sem acesso a banco/rede neste ambiente). Rodar
-- `npx prisma migrate diff` contra o schema.prisma antes de aplicar.

-- EstoqueMovimentacao passa a registrar em qual filial o efeito ocorreu
-- (necessário para relatórios por filial - Seção 33 - e para transferências
-- entre filiais - Seção 9). Se esta tabela já tiver linhas em produção,
-- faça o backfill de "filialId" ANTES de rodar o ALTER ... SET NOT NULL:
-- não há como inferir com segurança de qual filial uma movimentação antiga
-- veio, porque o campo nunca foi gravado antes desta migração.
ALTER TABLE "EstoqueMovimentacao" ADD COLUMN "filialId" TEXT;
ALTER TABLE "EstoqueMovimentacao" ADD COLUMN "filialDestinoId" TEXT;

-- Ambiente ainda sem dados de produção: aplicar o NOT NULL direto.
-- Se houver dados, faça o backfill primeiro e só then rode a linha abaixo.
ALTER TABLE "EstoqueMovimentacao" ALTER COLUMN "filialId" SET NOT NULL;

ALTER TABLE "EstoqueMovimentacao" ADD CONSTRAINT "EstoqueMovimentacao_filialId_fkey"
  FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EstoqueMovimentacao" ADD CONSTRAINT "EstoqueMovimentacao_filialDestinoId_fkey"
  FOREIGN KEY ("filialDestinoId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EstoqueMovimentacao_empresaId_filialId_idx" ON "EstoqueMovimentacao"("empresaId", "filialId");

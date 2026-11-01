-- ============================================================================
-- Segunda etapa da sincronização banco <-> schema.
--
-- A migração anterior (202609261100) parou nas colunas mais óbvias. Esta
-- fecha o que ainda faltava, apurado com `prisma migrate diff`:
--
--   - Advertencia.tipo   (o schema tem o enum TipoAdvertencia)
--   - ChaveApi.criadaPorUsuarioId  (o schema aceita nulo; o banco não)
--   - ChaveApi.updatedAt           (o schema não define DEFAULT; o banco tinha)
--   - Estoque.lote                (identificação de lote no inventário)
--   - Funcionario.cep             (endereço completo do funcionário)
--   - MovimentacaoCaixa.origem    (coluna órfã; a tabela está VAZIA, então
--                                   remover não perde nada)
--
-- Deliberadamente NÃO feitos, para não destruir dado real:
--   - DROP TABLE "Importacao"  (1 linha real, órfã do schema — mantida)
--   - DROP das FKs Caixa/ChaveApi -> Empresa (integridade válida — mantidas)
-- ============================================================================

ALTER TABLE "Advertencia" ADD COLUMN     "tipo" "TipoAdvertencia" NOT NULL DEFAULT 'VERBAL';

ALTER TABLE "ChaveApi" ALTER COLUMN "criadaPorUsuarioId" DROP NOT NULL;

ALTER TABLE "ChaveApi" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Estoque" ADD COLUMN     "lote" TEXT;

ALTER TABLE "Funcionario" ADD COLUMN     "cep" TEXT;

-- Tabela vazia no momento (0 linhas) — remover a coluna órfã não apaga dado.
ALTER TABLE "MovimentacaoCaixa" DROP COLUMN "origem";

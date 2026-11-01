-- Corrige a divergÃªncia entre schema.prisma (enum PoliticaCusto)
-- e a coluna TEXT criada em 202610260000_unidades_tipos_produtos.
-- Os valores existentes sÃ£o preservados pela conversÃ£o explÃ­cita.

CREATE TYPE "PoliticaCusto" AS ENUM (
    'ULTIMO_CUSTO',
    'MEDIO_PONDERADO',
    'PADRAO'
);

ALTER TABLE "Produto"
    ALTER COLUMN "politicaCusto" DROP DEFAULT;

ALTER TABLE "Produto"
    ALTER COLUMN "politicaCusto" TYPE "PoliticaCusto"
    USING ("politicaCusto"::"PoliticaCusto");

ALTER TABLE "Produto"
    ALTER COLUMN "politicaCusto" SET DEFAULT 'MEDIO_PONDERADO'::"PoliticaCusto";
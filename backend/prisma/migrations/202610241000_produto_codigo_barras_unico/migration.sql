DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Produto"
    WHERE "codigoBarras" IS NOT NULL
    GROUP BY "empresaId", "codigoBarras"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Não foi possível criar unicidade de código de barras: existem duplicidades por empresa em Produto.codigoBarras. Corrija-as e reaplique a migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Produto_empresaId_codigoBarras_key"
  ON "Produto"("empresaId", "codigoBarras");
-- Preenche a data operacional das vendas legadas usando o instante UTC
-- persistido e o fuso IANA da filial. Não altera createdAt nem valores da venda.
UPDATE "Venda" AS v
SET "dataOperacional" = (
  (v."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_timezone_names AS tz
      WHERE tz.name = NULLIF(f."fusoHorario", '')
    ) THEN f."fusoHorario"
    ELSE 'America/Sao_Paulo'
  END
)::date
FROM "Filial" AS f
WHERE f."id" = v."filialId"
  AND v."dataOperacional" IS NULL;

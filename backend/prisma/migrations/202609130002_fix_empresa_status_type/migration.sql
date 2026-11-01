DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Empresa' AND column_name = 'status' AND data_type = 'text'
  ) THEN
    ALTER TABLE "Empresa"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "StatusGeral" USING "status"::"StatusGeral",
      ALTER COLUMN "status" SET DEFAULT 'ATIVO'::"StatusGeral";
  END IF;
END $$;

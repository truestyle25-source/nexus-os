ALTER TABLE "Produto"
  ADD COLUMN "marca" TEXT,
  ADD COLUMN "pontoPedido" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "peso" TEXT,
  ADD COLUMN "ncm" TEXT,
  ADD COLUMN "precoPromocional" DECIMAL(10,2),
  ADD COLUMN "promocaoInicio" TIMESTAMP(3),
  ADD COLUMN "promocaoFim" TIMESTAMP(3),
  ADD COLUMN "promocaoLimite" INTEGER;
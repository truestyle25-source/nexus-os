-- NEXUS OS: aba /fornecedores v2 (artefato "nexus-fornecedores-add-v2").
-- Escrita manualmente (padrão deste repositório — sem `prisma migrate dev`).
-- Antes de aplicar, rode `npx prisma migrate diff` contra schema.prisma.
-- Script idempotente (IF NOT EXISTS / DO blocks) — seguro de reaplicar.
--
-- Resumo:
--  1. Colunas novas do Fornecedor (categoria, whatsapp, condicaoPagamento,
--     observacoes, produtos CSV, totais e último pedido).
--  2. Renomeia cnpjCpf -> cnpj.
--  3. Converte status de enum "StatusGeral" para TEXT: ATIVO->Ativo,
--     INATIVO/ARQUIVADO->Inativo, default 'Ativo'.
--  4. Índices (empresaId,status) e (empresaId,categoria).
--  5. Cria CompraFornecedor e faz BACKFILL real a partir de Compra
--     (SOLICITADA/PEDIDO -> Pendente, RECEBIDA -> Entregue; CANCELADA é
--     ignorada) e recalcula os totais do Fornecedor — é daí que vêm os KPIs.

-- 1) Colunas novas ----------------------------------------------------------
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "categoria" TEXT NOT NULL DEFAULT 'Outros';
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "condicaoPagamento" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "observacoes" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "produtos" TEXT;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "totalComprado" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "totalPedidos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Fornecedor" ADD COLUMN IF NOT EXISTS "ultimoPedidoAt" TIMESTAMP(3);

-- 2) Renomeia cnpjCpf -> cnpj (guardado) ------------------------------------
DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'Fornecedor' AND column_name = 'cnpjCpf'
     )
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'Fornecedor' AND column_name = 'cnpj'
     ) THEN
    ALTER TABLE "Fornecedor" RENAME COLUMN "cnpjCpf" TO "cnpj";
  END IF;
END $$;

-- 3) status legado -> TEXT com os valores usados pela aba /fornecedores ------
-- O schema atual declara Fornecedor.status como String e a UI usa
-- Ativo/Crítico/Inativo. Portanto não criamos um enum novo: normalizamos
-- qualquer coluna enumada legada para TEXT, preservando o contrato do Prisma.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Fornecedor'
      AND column_name = 'status'
      AND lower(udt_name) = 'statusgeral'
  ) THEN
    ALTER TABLE "Fornecedor" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Fornecedor"
      ALTER COLUMN "status" TYPE TEXT
      USING (
        CASE "status"::text
          WHEN 'ATIVO'     THEN 'Ativo'
          WHEN 'INATIVO'   THEN 'Inativo'
          WHEN 'ARQUIVADO' THEN 'Inativo'
          WHEN 'CRITICO'   THEN 'Crítico'
          WHEN 'CRÍTICO'  THEN 'Crítico'
          ELSE 'Ativo'
        END
      );
    ALTER TABLE "Fornecedor" ALTER COLUMN "status" SET DEFAULT 'Ativo';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Fornecedor'
      AND column_name = 'status'
      AND data_type = 'text'
  ) THEN
    UPDATE "Fornecedor"
       SET "status" = CASE
         WHEN "status" IN ('ATIVO', 'Ativo', 'ativo') THEN 'Ativo'
         WHEN "status" IN ('INATIVO', 'ARQUIVADO', 'Inativo', 'inativo') THEN 'Inativo'
         WHEN "status" IN ('CRITICO', 'CRÍTICO', 'Crítico', 'Critico', 'critico', 'crítico') THEN 'Crítico'
         ELSE "status"
       END;
    ALTER TABLE "Fornecedor" ALTER COLUMN "status" SET DEFAULT 'Ativo';
  END IF;
END $$;

-- 4) CompraFornecedor + backfill --------------------------------------------
CREATE TABLE IF NOT EXISTS "CompraFornecedor" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "fornecedorId" TEXT NOT NULL,
  "compraId" TEXT,
  "valor" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL,
  "dataPedido" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dataEntrega" TIMESTAMP(3),
  CONSTRAINT "CompraFornecedor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompraFornecedor_compraId_key" ON "CompraFornecedor"("compraId");
CREATE INDEX IF NOT EXISTS "CompraFornecedor_empresaId_fornecedorId_idx" ON "CompraFornecedor"("empresaId", "fornecedorId");
CREATE INDEX IF NOT EXISTS "CompraFornecedor_empresaId_status_idx" ON "CompraFornecedor"("empresaId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'CompraFornecedor_fornecedorId_fkey'
     ) THEN
    ALTER TABLE "CompraFornecedor"
      ADD CONSTRAINT "CompraFornecedor_fornecedorId_fkey"
      FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill somente na primeira aplicação (tabela vazia) e se Compra existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Compra')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Fornecedor')
     AND NOT EXISTS (SELECT 1 FROM "CompraFornecedor") THEN
    INSERT INTO "CompraFornecedor"
      ("id", "empresaId", "fornecedorId", "compraId", "valor", "status", "dataPedido", "dataEntrega")
    SELECT
      'cf_' || md5(c."id"),
      c."empresaId", c."fornecedorId", c."id", c."valorTotal",
      CASE c."status" WHEN 'RECEBIDA' THEN 'Entregue' ELSE 'Pendente' END,
      c."dataCompra", c."dataRecebimento"
    FROM "Compra" c
    WHERE c."status" IN ('SOLICITADA', 'PEDIDO', 'RECEBIDA');

    -- Totais reais do Fornecedor: alimenta "Total Comprado" e o gráfico
    -- doughnut "gasto por fornecedor" da aba /fornecedores.
    UPDATE "Fornecedor" f
       SET "totalPedidos"   = COALESCE(x.pedidos, 0),
           "totalComprado"  = COALESCE(x.gasto, 0),
           "ultimoPedidoAt" = x.ultimo
      FROM (
        SELECT "fornecedorId",
               COUNT(*)          AS pedidos,
               SUM("valor")      AS gasto,
               MAX("dataPedido") AS ultimo
          FROM "CompraFornecedor"
         GROUP BY "fornecedorId"
      ) x
     WHERE f."id" = x."fornecedorId";
  END IF;
END $$;

-- 4) Índices novos ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS "Fornecedor_empresaId_status_idx" ON "Fornecedor"("empresaId", "status");
CREATE INDEX IF NOT EXISTS "Fornecedor_empresaId_categoria_idx" ON "Fornecedor"("empresaId", "categoria");
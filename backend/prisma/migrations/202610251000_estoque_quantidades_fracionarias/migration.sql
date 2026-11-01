-- Estoque em unidade base com suporte a fracionamento (kg, g, L, ml etc.).
-- Conversões preservam os valores existentes exatamente; não há backfill destrutivo.
ALTER TABLE "Produto"
  ALTER COLUMN "custo" TYPE DECIMAL(14,6) USING "custo"::DECIMAL(14,6),
  ALTER COLUMN "estoqueMinimo" TYPE DECIMAL(14,3) USING "estoqueMinimo"::DECIMAL(14,3),
  ALTER COLUMN "estoqueMaximo" TYPE DECIMAL(14,3) USING "estoqueMaximo"::DECIMAL(14,3),
  ALTER COLUMN "pontoPedido" TYPE DECIMAL(14,3) USING "pontoPedido"::DECIMAL(14,3);

ALTER TABLE "Estoque"
  ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3);
ALTER TABLE "EstoqueMovimentacao"
  ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3);
ALTER TABLE "EstoqueSnapshotDiario"
  ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3),
  ALTER COLUMN "custoUnitario" TYPE DECIMAL(14,6) USING "custoUnitario"::DECIMAL(14,6);
ALTER TABLE "CompraItem"
  ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3),
  ALTER COLUMN "valorUnit" TYPE DECIMAL(14,6) USING "valorUnit"::DECIMAL(14,6);
ALTER TABLE "ContagemInventario"
  ALTER COLUMN "quantidadeSistema" TYPE DECIMAL(14,3) USING "quantidadeSistema"::DECIMAL(14,3),
  ALTER COLUMN "quantidadeContada" TYPE DECIMAL(14,3) USING "quantidadeContada"::DECIMAL(14,3);
ALTER TABLE "ProducaoKit"
  ALTER COLUMN "custoUnitario" TYPE DECIMAL(14,6) USING "custoUnitario"::DECIMAL(14,6);

-- Valores de produto vendidos e reservas permanecem inteiros nesta etapa:
-- o PDV e a venda por peso exigem contrato e interface próprios.

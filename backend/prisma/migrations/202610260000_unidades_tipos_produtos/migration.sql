-- Migration 202610260000_unidades_tipos_produtos
-- Adiciona catálogo de unidades, tipos de produto, fatores de conversão e consumo interno.
-- Aditiva: não altera nem exclui dados existentes. Valores inteiros são preservados exatamente.
-- NÃO toca em nenhuma tabela da Shopee.

-- ============================================================
-- 1. Tabela Dimensao (massa, volume, contagem, comprimento, embalagem)
-- ============================================================
CREATE TABLE "Dimensao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dimensao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Dimensao_empresaId_codigo_key" ON "Dimensao"("empresaId", "codigo");
CREATE INDEX "Dimensao_empresaId_idx" ON "Dimensao"("empresaId");

-- ============================================================
-- 2. Tabela Unidade (kg, g, L, mL, UN, dz, cx, saco, etc.)
-- ============================================================
CREATE TABLE "Unidade" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "dimensaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "simbolo" TEXT NOT NULL,
    "fatorCanonico" DECIMAL(14,6) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Unidade_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Unidade_dimensaoId_fkey" FOREIGN KEY ("dimensaoId") REFERENCES "Dimensao"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Unidade_empresaId_simbolo_key" ON "Unidade"("empresaId", "simbolo");
CREATE INDEX "Unidade_empresaId_dimensaoId_idx" ON "Unidade"("empresaId", "dimensaoId");

-- ============================================================
-- 3. Tabela TipoProduto (MERCADORIA, INSUMO, FABRICADO, USO_INTERNO)
-- ============================================================
CREATE TABLE "TipoProduto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TipoProduto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TipoProduto_empresaId_codigo_key" ON "TipoProduto"("empresaId", "codigo");
CREATE INDEX "TipoProduto_empresaId_idx" ON "TipoProduto"("empresaId");

-- ============================================================
-- 4. Tabela FatorConversao (produto -> unidade origem/destino, opcionalmente fornecedor)
-- ============================================================
CREATE TABLE "FatorConversao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "unidadeOrigemId" TEXT NOT NULL,
    "unidadeDestinoId" TEXT NOT NULL,
    "fornecedorId" TEXT,
    "fator" DECIMAL(14,6) NOT NULL,
    "vigenciaDe" TIMESTAMP(3),
    "vigenciaAte" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FatorConversao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FatorConversao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FatorConversao_unidadeOrigemId_fkey" FOREIGN KEY ("unidadeOrigemId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FatorConversao_unidadeDestinoId_fkey" FOREIGN KEY ("unidadeDestinoId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FatorConversao_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "FatorConversao_empresaId_produtoId_idx" ON "FatorConversao"("empresaId", "produtoId");
CREATE INDEX "FatorConversao_empresaId_unidadeOrigemId_unidadeDestinoId_idx" ON "FatorConversao"("empresaId", "unidadeOrigemId", "unidadeDestinoId");
CREATE INDEX "FatorConversao_empresaId_produtoId_fornecedorId_idx" ON "FatorConversao"("empresaId", "produtoId", "fornecedorId");

-- ============================================================
-- 5. Tabela ConsumoInterno (baixa de estoque por uso interno)
-- ============================================================
CREATE TABLE "ConsumoInterno" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "quantidadeBase" DECIMAL(14,3) NOT NULL,
    "fatorAplicado" DECIMAL(14,6) NOT NULL,
    "custoUnitario" DECIMAL(14,6) NOT NULL,
    "custoTotal" DECIMAL(14,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "aprovadoPorId" TEXT,
    "aprovadoEm" TIMESTAMP(3),
    "documento" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsumoInterno_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConsumoInterno_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumoInterno_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumoInterno_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumoInterno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumoInterno_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsumoInterno_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ConsumoInterno_empresaId_filialId_idx" ON "ConsumoInterno"("empresaId", "filialId");
CREATE INDEX "ConsumoInterno_empresaId_produtoId_idx" ON "ConsumoInterno"("empresaId", "produtoId");
CREATE INDEX "ConsumoInterno_createdAt_idx" ON "ConsumoInterno"("createdAt");

-- ============================================================
-- 6. Adicionar colunas em Produto (tipoProduto, unidadeBase, politicaCusto)
-- ============================================================
ALTER TABLE "Produto"
    ADD COLUMN "tipoProdutoId" TEXT,
    ADD COLUMN "unidadeBaseId" TEXT,
    ADD COLUMN "politicaCusto" TEXT NOT NULL DEFAULT 'MEDIO_PONDERADO';

ALTER TABLE "Produto"
    ADD CONSTRAINT "Produto_tipoProdutoId_fkey" FOREIGN KEY ("tipoProdutoId") REFERENCES "TipoProduto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Produto"
    ADD CONSTRAINT "Produto_unidadeBaseId_fkey" FOREIGN KEY ("unidadeBaseId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Produto_empresaId_tipoProdutoId_idx" ON "Produto"("empresaId", "tipoProdutoId");

-- ============================================================
-- 7. Adicionar colunas de snapshot em CompraItem (unidade/fator/quantidade base)
-- ============================================================
ALTER TABLE "CompraItem"
    ADD COLUMN "unidadeCompra" TEXT,
    ADD COLUMN "fatorAplicado" DECIMAL(14,6),
    ADD COLUMN "quantidadeBase" DECIMAL(14,3);

-- ============================================================
-- 8. Converter VendaItem.quantidade de Int para Decimal (preservando valores)
--    e adicionar colunas de snapshot
-- ============================================================
ALTER TABLE "VendaItem"
    ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3),
    ADD COLUMN "unidadeVenda" TEXT,
    ADD COLUMN "fatorAplicado" DECIMAL(14,6),
    ADD COLUMN "quantidadeBase" DECIMAL(14,3);

-- ============================================================
-- 9. Converter ProducaoKit.quantidade de Int para Decimal (preservando valores)
--    e adicionar colunas de produção
-- ============================================================
ALTER TABLE "ProducaoKit"
    ALTER COLUMN "quantidade" TYPE DECIMAL(14,3) USING "quantidade"::DECIMAL(14,3),
    ADD COLUMN "unidadeProducao" TEXT,
    ADD COLUMN "fatorAplicado" DECIMAL(14,6),
    ADD COLUMN "quantidadeProduzida" DECIMAL(14,3) NOT NULL DEFAULT 0,
    ADD COLUMN "perda" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- ============================================================
-- 9b. Atualizar quantidadeProduzida com o valor de quantidade para linhas existentes
-- ============================================================
UPDATE "ProducaoKit" SET "quantidadeProduzida" = "quantidade" WHERE "quantidadeProduzida" = 0;
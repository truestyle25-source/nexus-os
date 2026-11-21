-- Evolução do módulo Produtos (ERP) — 2026-11-21.
-- ADITIVA: só ADD VALUE em enum, ADD COLUMN (anuláveis ou com padrão), CREATE TABLE/INDEX e FKs novas.
-- Nenhum DROP, nenhuma mudança de tipo, nenhum dado existente alterado.
-- Depois de aplicar: rodar prisma/seguranca/01_rls_policies.sql (RLS nas 4 tabelas novas, que têm empresaId).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoProdutoEnum" ADD VALUE 'MATERIA_PRIMA';
ALTER TYPE "TipoProdutoEnum" ADD VALUE 'PRODUTO_ACABADO';
ALTER TYPE "TipoProdutoEnum" ADD VALUE 'SERVICO';
ALTER TYPE "TipoMovEstoque" ADD VALUE 'PRODUCAO';
ALTER TYPE "TipoMovEstoque" ADD VALUE 'CONSUMO_INSUMO';
ALTER TYPE "TipoMovEstoque" ADD VALUE 'DESCARTE';

-- AlterTable
ALTER TABLE "Categoria" ADD COLUMN     "categoriaPaiId" TEXT,
ADD COLUMN     "nivel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "regimeTributario" TEXT;

-- AlterTable
ALTER TABLE "EstoqueMovimentacao" ADD COLUMN     "custoUnitario" DECIMAL(14,6),
ADD COLUMN     "saldoAnterior" DECIMAL(14,3),
ADD COLUMN     "saldoPosterior" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "centroCustoContabil" TEXT,
ADD COLUMN     "centroCustoVenda" TEXT,
ADD COLUMN     "codigoExterno" TEXT,
ADD COLUMN     "comissaoPercentual" DECIMAL(5,2),
ADD COLUMN     "controlaBalanca" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "controlaEstoque" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "controlaLote" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "controlaValidade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "densidade" DECIMAL(14,6),
ADD COLUMN     "descontoMaximoPercentual" DECIMAL(5,2),
ADD COLUMN     "descricaoResumida" TEXT,
ADD COLUMN     "despesasPercentual" DECIMAL(5,2),
ADD COLUMN     "diasValidade" INTEGER,
ADD COLUMN     "disponivelPdv" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "embalagem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enviaCozinha" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estoqueIdeal" DECIMAL(14,3),
ADD COLUMN     "estoqueSeguranca" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "fabricante" TEXT,
ADD COLUMN     "imprimeFichaExpedicao" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permiteEstoqueNegativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permiteTransferenciaNegativa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pesoEmbalagem" DECIMAL(14,3),
ADD COLUMN     "posicaoPdv" INTEGER,
ADD COLUMN     "precoCompra" DECIMAL(14,6),
ADD COLUMN     "precoTabelaA" DECIMAL(10,2),
ADD COLUMN     "precoTabelaB" DECIMAL(10,2),
ADD COLUMN     "precoTabelaC" DECIMAL(10,2),
ADD COLUMN     "premiacaoFim" TIMESTAMP(3),
ADD COLUMN     "premiacaoInicio" TIMESTAMP(3),
ADD COLUMN     "premiacaoPercentual" DECIMAL(5,2),
ADD COLUMN     "premiacaoRegra" TEXT,
ADD COLUMN     "produtoGlp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quantidadeEmbalagem" DECIMAL(14,3),
ADD COLUMN     "referencia" TEXT,
ADD COLUMN     "ultimoCustoAquisicao" DECIMAL(14,6),
ADD COLUMN     "unidadeCompraId" TEXT,
ADD COLUMN     "unidadeTributavelId" TEXT,
ADD COLUMN     "unidadeVendaId" TEXT,
ADD COLUMN     "vendaFracionada" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProdutoFiscal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "origemMercadoria" INTEGER,
    "cest" TEXT,
    "cfopEntrada" TEXT,
    "cfopSaida" TEXT,
    "cstIcms" TEXT,
    "csosn" TEXT,
    "aliquotaIcms" DECIMAL(7,4),
    "reducaoBaseIcms" DECIMAL(7,4),
    "cstPis" TEXT,
    "aliquotaPis" DECIMAL(7,4),
    "cstCofins" TEXT,
    "aliquotaCofins" DECIMAL(7,4),
    "cstIpi" TEXT,
    "aliquotaIpi" DECIMAL(7,4),
    "codigoEnquadramentoIpi" TEXT,
    "cstIbsCbs" TEXT,
    "classificacaoTributaria" TEXT,
    "aliquotaIbs" DECIMAL(7,4),
    "aliquotaCbs" DECIMAL(7,4),
    "naturezaOperacao" TEXT,
    "informacoesAdicionais" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoCodigoBarras" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProdutoCodigoBarras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoPrecoHistorico" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "filialId" TEXT,
    "campo" TEXT NOT NULL,
    "valorAnterior" DECIMAL(14,6),
    "valorNovo" DECIMAL(14,6),
    "usuarioId" TEXT,
    "justificativa" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProdutoPrecoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoFilial" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "disponivelVenda" BOOLEAN NOT NULL DEFAULT true,
    "precoVenda" DECIMAL(10,2),
    "custo" DECIMAL(14,6),
    "estoqueMinimo" DECIMAL(14,3),
    "estoqueMaximo" DECIMAL(14,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoFilial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoFiscal_produtoId_key" ON "ProdutoFiscal"("produtoId");

-- CreateIndex
CREATE INDEX "ProdutoFiscal_empresaId_idx" ON "ProdutoFiscal"("empresaId");

-- CreateIndex
CREATE INDEX "ProdutoCodigoBarras_empresaId_produtoId_idx" ON "ProdutoCodigoBarras"("empresaId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoCodigoBarras_empresaId_codigo_key" ON "ProdutoCodigoBarras"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "ProdutoPrecoHistorico_empresaId_produtoId_createdAt_idx" ON "ProdutoPrecoHistorico"("empresaId", "produtoId", "createdAt");

-- CreateIndex
CREATE INDEX "ProdutoFilial_empresaId_filialId_idx" ON "ProdutoFilial"("empresaId", "filialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProdutoFilial_produtoId_filialId_key" ON "ProdutoFilial"("produtoId", "filialId");

-- CreateIndex
CREATE INDEX "Produto_empresaId_referencia_idx" ON "Produto"("empresaId", "referencia");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_categoriaPaiId_fkey" FOREIGN KEY ("categoriaPaiId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_unidadeCompraId_fkey" FOREIGN KEY ("unidadeCompraId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_unidadeVendaId_fkey" FOREIGN KEY ("unidadeVendaId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_unidadeTributavelId_fkey" FOREIGN KEY ("unidadeTributavelId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFiscal" ADD CONSTRAINT "ProdutoFiscal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFiscal" ADD CONSTRAINT "ProdutoFiscal_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoCodigoBarras" ADD CONSTRAINT "ProdutoCodigoBarras_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoCodigoBarras" ADD CONSTRAINT "ProdutoCodigoBarras_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoPrecoHistorico" ADD CONSTRAINT "ProdutoPrecoHistorico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoPrecoHistorico" ADD CONSTRAINT "ProdutoPrecoHistorico_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoPrecoHistorico" ADD CONSTRAINT "ProdutoPrecoHistorico_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoPrecoHistorico" ADD CONSTRAINT "ProdutoPrecoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFilial" ADD CONSTRAINT "ProdutoFilial_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFilial" ADD CONSTRAINT "ProdutoFilial_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoFilial" ADD CONSTRAINT "ProdutoFilial_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


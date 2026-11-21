-- Cadastro completo de fornecedores (2026-11-21).
-- 100% aditiva: colunas opcionais/com padrão em "Fornecedor", 5 tabelas novas, índices e FKs.
-- O único dado preenchido é o código sequencial dos fornecedores já existentes (coluna nova).

-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN     "agencia" TEXT,
ADD COLUMN     "atualizadoPorId" TEXT,
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "banco" TEXT,
ADD COLUMN     "centroCusto" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cfopEntrada" TEXT,
ADD COLUMN     "chavePix" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "codigo" INTEGER,
ADD COLUMN     "codigoBanco" TEXT,
ADD COLUMN     "codigoIbge" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "compradorId" TEXT,
ADD COLUMN     "condicoesComerciais" TEXT,
ADD COLUMN     "conta" TEXT,
ADD COLUMN     "contaDigito" TEXT,
ADD COLUMN     "contribuinteIcms" BOOLEAN,
ADD COLUMN     "criadoPorId" TEXT,
ADD COLUMN     "dataAbertura" TIMESTAMP(3),
ADD COLUMN     "dataHomologacao" TIMESTAMP(3),
ADD COLUMN     "emailNfe" TEXT,
ADD COLUMN     "emailPedidos" TEXT,
ADD COLUMN     "enderecoAlternativo" JSONB,
ADD COLUMN     "enderecoCobranca" JSONB,
ADD COLUMN     "filialId" TEXT,
ADD COLUMN     "formaPagamento" TEXT,
ADD COLUMN     "homologado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "homologadoPor" TEXT,
ADD COLUMN     "ieIsento" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "infoComerciais" TEXT,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "inscricaoMunicipal" TEXT,
ADD COLUMN     "limiteCredito" DECIMAL(14,2),
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "modalidadeFrete" TEXT,
ADD COLUMN     "naturezaFinanceira" TEXT,
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "observacoesFiscais" TEXT,
ADD COLUMN     "observacoesLogisticas" TEXT,
ADD COLUMN     "optanteSimples" BOOLEAN,
ADD COLUMN     "orientacoesCompradores" TEXT,
ADD COLUMN     "pais" TEXT NOT NULL DEFAULT 'Brasil',
ADD COLUMN     "pedidoMinimo" DECIMAL(14,2),
ADD COLUMN     "planoContas" TEXT,
ADD COLUMN     "prazoEntregaDias" INTEGER,
ADD COLUMN     "regimeTributario" TEXT,
ADD COLUMN     "restricoesAtendimento" TEXT,
ADD COLUMN     "retemCofins" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retemCsll" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retemInss" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retemIrrf" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retemIss" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retemPis" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "segmento" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "tipoChavePix" TEXT,
ADD COLUMN     "tipoConta" TEXT,
ADD COLUMN     "tipoPessoa" TEXT NOT NULL DEFAULT 'JURIDICA',
ADD COLUMN     "titular" TEXT,
ADD COLUMN     "titularDocumento" TEXT,
ADD COLUMN     "transportadora" TEXT,
ADD COLUMN     "uf" TEXT,
ADD COLUMN     "validadeCndFederal" TIMESTAMP(3),
ADD COLUMN     "validadeCndt" TIMESTAMP(3),
ADD COLUMN     "validadeFgts" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FornecedorContato" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "departamento" TEXT,
    "telefone" TEXT,
    "celular" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FornecedorContato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FornecedorProduto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "referencia" TEXT,
    "codigoFornecedor" TEXT,
    "descricaoComercial" TEXT,
    "preco" DECIMAL(14,6),
    "ultimoPrecoCompra" DECIMAL(14,6),
    "precoAtualizadoEm" TIMESTAMP(3),
    "prazoEntregaDias" INTEGER,
    "pedidoMinimo" DECIMAL(14,3),
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FornecedorProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FornecedorPrecoHistorico" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" DECIMAL(14,6),
    "valorNovo" DECIMAL(14,6),
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "documento" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FornecedorPrecoHistorico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FornecedorDocumento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivoChave" TEXT,
    "arquivoNome" TEXT,
    "contentType" TEXT,
    "tamanhoBytes" INTEGER,
    "validade" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "enviadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FornecedorDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FornecedorAvaliacao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "notaGeral" INTEGER NOT NULL,
    "pontualidade" INTEGER,
    "qualidade" INTEGER,
    "preco" INTEGER,
    "comentario" TEXT,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FornecedorAvaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FornecedorContato_empresaId_fornecedorId_idx" ON "FornecedorContato"("empresaId", "fornecedorId");

-- CreateIndex
CREATE INDEX "FornecedorProduto_empresaId_produtoId_idx" ON "FornecedorProduto"("empresaId", "produtoId");

-- CreateIndex
CREATE INDEX "FornecedorProduto_empresaId_fornecedorId_idx" ON "FornecedorProduto"("empresaId", "fornecedorId");

-- CreateIndex
CREATE UNIQUE INDEX "FornecedorProduto_fornecedorId_produtoId_key" ON "FornecedorProduto"("fornecedorId", "produtoId");

-- CreateIndex
CREATE INDEX "FornecedorPrecoHistorico_empresaId_fornecedorId_produtoId_c_idx" ON "FornecedorPrecoHistorico"("empresaId", "fornecedorId", "produtoId", "createdAt");

-- CreateIndex
CREATE INDEX "FornecedorDocumento_empresaId_fornecedorId_idx" ON "FornecedorDocumento"("empresaId", "fornecedorId");

-- CreateIndex
CREATE INDEX "FornecedorDocumento_empresaId_validade_idx" ON "FornecedorDocumento"("empresaId", "validade");

-- CreateIndex
CREATE INDEX "FornecedorAvaliacao_empresaId_fornecedorId_createdAt_idx" ON "FornecedorAvaliacao"("empresaId", "fornecedorId", "createdAt");

-- CreateIndex
CREATE INDEX "Fornecedor_empresaId_uf_idx" ON "Fornecedor"("empresaId", "uf");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_empresaId_codigo_key" ON "Fornecedor"("empresaId", "codigo");

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_compradorId_fkey" FOREIGN KEY ("compradorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorContato" ADD CONSTRAINT "FornecedorContato_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorContato" ADD CONSTRAINT "FornecedorContato_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorProduto" ADD CONSTRAINT "FornecedorProduto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorProduto" ADD CONSTRAINT "FornecedorProduto_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorProduto" ADD CONSTRAINT "FornecedorProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorPrecoHistorico" ADD CONSTRAINT "FornecedorPrecoHistorico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorPrecoHistorico" ADD CONSTRAINT "FornecedorPrecoHistorico_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorPrecoHistorico" ADD CONSTRAINT "FornecedorPrecoHistorico_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorPrecoHistorico" ADD CONSTRAINT "FornecedorPrecoHistorico_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorDocumento" ADD CONSTRAINT "FornecedorDocumento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorDocumento" ADD CONSTRAINT "FornecedorDocumento_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorDocumento" ADD CONSTRAINT "FornecedorDocumento_enviadoPorId_fkey" FOREIGN KEY ("enviadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorAvaliacao" ADD CONSTRAINT "FornecedorAvaliacao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorAvaliacao" ADD CONSTRAINT "FornecedorAvaliacao_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FornecedorAvaliacao" ADD CONSTRAINT "FornecedorAvaliacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Código sequencial dos fornecedores já cadastrados (por empresa, na ordem de criação).
UPDATE "Fornecedor" f SET "codigo" = x.n
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "empresaId" ORDER BY "createdAt", "id") AS n FROM "Fornecedor") x
WHERE f."id" = x."id" AND f."codigo" IS NULL;

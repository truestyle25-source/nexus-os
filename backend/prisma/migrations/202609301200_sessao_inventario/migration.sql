-- ===========================================================================
-- Ciclo 6 — Sessão de Inventário
-- ===========================================================================
--
-- POR QUE DUAS TABELAS
-- -------------------
-- `SessaoInventario` é a contagem: quem abriu, em qual filial, se foi cega, e
-- se ainda está em andamento. `ContagemInventario` é a folha: uma linha por
-- item contado, com o saldo do sistema CONGELADO na abertura.
--
-- O SALDO CONGELADO É A ESSÊNCIA DO CICLO
-- ---------------------------------------
-- `quantidadeSistema` é gravada no momento em que a sessão abre e nunca muda.
-- Se fosse recalculada a cada leitura, uma venda ou uma compra no meio da
-- contagem faria o inventário apontar desvio onde houve só operação normal, e
-- o número compararia o que existe com um alvo que andou.
--
-- A IDENTIFICAÇÃO DO ITEM É COPIADA
-- --------------------------------
-- produtoNome, unidade e local vão como texto. Um inventário é documento de
-- trabalho e precisa continuar legível depois que o produto foi renomeado ou
-- desativado. `estoqueId` fica só como rastro, com SetNull: produto
-- desativado não pode apagar a contagem que alguém já fez.
--
-- NULL ≠ ZERO
-- ---------
-- `quantidadeContada` NULL significa "ninguém contou". Zero significa "contou
-- e não havia". Os dois parecem zero no papel, e um deles é erro de leitura —
-- por isso a coluna é anulável de verdade.

-- CreateEnum
CREATE TYPE "StatusSessaoInventario" AS ENUM ('ABERTA', 'CONCLUIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "SessaoInventario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "status" "StatusSessaoInventario" NOT NULL DEFAULT 'ABERTA',
    "cegas" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoPorId" TEXT,
    "concluidoEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessaoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContagemInventario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sessaoId" TEXT NOT NULL,
    "estoqueId" TEXT,
    "produtoId" TEXT NOT NULL,
    "produtoNome" TEXT NOT NULL,
    "unidade" TEXT,
    "local" TEXT,
    "quantidadeSistema" INTEGER NOT NULL,
    "quantidadeContada" INTEGER,
    "contadoPorId" TEXT,
    "contadoEm" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContagemInventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessaoInventario_empresaId_status_idx" ON "SessaoInventario"("empresaId", "status");

-- CreateIndex
CREATE INDEX "SessaoInventario_empresaId_filialId_criadoEm_idx" ON "SessaoInventario"("empresaId", "filialId", "criadoEm");

-- CreateIndex
CREATE INDEX "ContagemInventario_empresaId_sessaoId_idx" ON "ContagemInventario"("empresaId", "sessaoId");

-- CreateIndex
-- Um item não entra duas vezes na mesma folha.
CREATE UNIQUE INDEX "ContagemInventario_sessaoId_estoqueId_key" ON "ContagemInventario"("sessaoId", "estoqueId");

-- AddForeignKey
ALTER TABLE "SessaoInventario" ADD CONSTRAINT "SessaoInventario_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SessaoInventario" ADD CONSTRAINT "SessaoInventario_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessaoInventario" ADD CONSTRAINT "SessaoInventario_concluidoPorId_fkey" FOREIGN KEY ("concluidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cascade: apagar a sessão apaga a folha. É o comportamento esperado — a
-- folha existe para ser contada, e uma sessão sem folha não tem sentido.
ALTER TABLE "ContagemInventario" ADD CONSTRAINT "ContagemInventario_sessaoId_fkey" FOREIGN KEY ("sessaoId") REFERENCES "SessaoInventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContagemInventario" ADD CONSTRAINT "ContagemInventario_estoqueId_fkey" FOREIGN KEY ("estoqueId") REFERENCES "Estoque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContagemInventario" ADD CONSTRAINT "ContagemInventario_contadoPorId_fkey" FOREIGN KEY ("contadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

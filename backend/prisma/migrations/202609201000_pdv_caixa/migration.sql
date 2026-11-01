-- Seção 14 PDV — Caixa: turno de operação de balcão (abertura/fechamento,
-- fundo de troco, sangria, suprimento) e vínculo da Venda com o turno que
-- a fechou (Venda.caixaId).
--
-- Escrita à mão pelo mesmo motivo documentado em DEBITO-TECNICO.md
-- (itens 3 e 6): sem banco/rede neste ambiente para gerar via
-- `prisma migrate dev`. Rodar `prisma migrate deploy`/`db push` em um
-- ambiente real antes de usar o PDV.

CREATE TYPE "StatusCaixa" AS ENUM ('ABERTO', 'FECHADO');
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('ABERTURA', 'SANGRIA', 'SUPRIMENTO');

CREATE TABLE "Caixa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "status" "StatusCaixa" NOT NULL DEFAULT 'ABERTO',
    "fundoTroco" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoEm" TIMESTAMP(3),
    "valorContado" DECIMAL(12,2),
    "diferenca" DECIMAL(12,2),
    "observacaoFechamento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Caixa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MovimentacaoCaixa" (
    "id" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tipo" "TipoMovimentoCaixa" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT,
    "usuarioId" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoCaixa_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Venda" ADD COLUMN "caixaId" TEXT;

CREATE INDEX "Caixa_empresaId_filialId_idx" ON "Caixa"("empresaId", "filialId");
CREATE INDEX "Caixa_usuarioId_status_idx" ON "Caixa"("usuarioId", "status");
CREATE INDEX "MovimentacaoCaixa_caixaId_idx" ON "MovimentacaoCaixa"("caixaId");
CREATE INDEX "Venda_caixaId_idx" ON "Venda"("caixaId");

ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_filialId_fkey"
  FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MovimentacaoCaixa" ADD CONSTRAINT "MovimentacaoCaixa_caixaId_fkey"
  FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_caixaId_fkey"
  FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

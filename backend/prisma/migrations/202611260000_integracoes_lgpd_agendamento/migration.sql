-- Pendências da Central: consentimento/descadastro (LGPD) e agendamento WooCommerce. Somente aditiva.
-- AlterTable
ALTER TABLE "IntegracaoExterno" ADD COLUMN     "proximoSyncEm" TIMESTAMP(3),
ADD COLUMN     "syncLeaseExpiraEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WhatsappMensagem" ADD COLUMN     "consentimento" TEXT;

-- CreateTable
CREATE TABLE "WhatsappDescadastro" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappDescadastro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappDescadastro_empresaId_telefone_key" ON "WhatsappDescadastro"("empresaId", "telefone");

-- AddForeignKey
ALTER TABLE "WhatsappDescadastro" ADD CONSTRAINT "WhatsappDescadastro_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


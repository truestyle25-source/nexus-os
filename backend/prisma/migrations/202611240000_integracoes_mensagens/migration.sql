-- Central de Integrações (Fase B): mensagens do WhatsApp e envios de e-mail. Somente aditiva.
-- CreateTable
CREATE TABLE "WhatsappMensagem" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "direcao" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nomeContato" TEXT,
    "tipo" TEXT NOT NULL,
    "conteudo" TEXT,
    "waMessageId" TEXT,
    "status" TEXT NOT NULL,
    "erro" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'CENTRAL',
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailEnvio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "anexos" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "erro" TEXT,
    "messageId" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'CENTRAL',
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEnvio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappMensagem_empresaId_createdAt_idx" ON "WhatsappMensagem"("empresaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMensagem_empresaId_waMessageId_key" ON "WhatsappMensagem"("empresaId", "waMessageId");

-- CreateIndex
CREATE INDEX "EmailEnvio_empresaId_createdAt_idx" ON "EmailEnvio"("empresaId", "createdAt");

-- AddForeignKey
ALTER TABLE "WhatsappMensagem" ADD CONSTRAINT "WhatsappMensagem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEnvio" ADD CONSTRAINT "EmailEnvio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


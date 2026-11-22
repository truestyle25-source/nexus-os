-- Central de Integrações (Fase A): somente aditiva.
ALTER TABLE "IntegracaoExterno" ADD COLUMN "credenciais" TEXT,
ADD COLUMN "config" JSONB,
ADD COLUMN "conectadoEm" TIMESTAMP(3);

CREATE TABLE "IntegracaoEvento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "codigoErro" TEXT,
    "mensagem" TEXT,
    "duracaoMs" INTEGER,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegracaoEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegracaoEvento_empresaId_provedor_createdAt_idx" ON "IntegracaoEvento"("empresaId", "provedor", "createdAt");

ALTER TABLE "IntegracaoEvento" ADD CONSTRAINT "IntegracaoEvento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

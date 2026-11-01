-- ===========================================================================
-- NEXUS OS — integração Mercado Livre: tabela IntegracaoExterno
--
-- A tabela nunca existiu no banco (nenhuma migration anterior a cria; o
-- `migrate status` dizia "up to date" porque só compara migrations
-- conhecidas). Este arquivo cria a tabela exatamente como o schema.prisma
-- declara: credenciais OAuth criptografadas, `state` com expiração
-- (`stateExpiraEm`), status de sincronização e unique por (empresaId, tipo).
--
-- IF NOT EXISTS / DO blocks tornam o passo um no-op onde a tabela já
-- existe — seguro em qualquer ambiente, sem checksum de migrations antigas
-- alteradas. Não há dados a migrar (tabela nova) e MERCAO_LIVRE nunca foi
-- gravado (tabela inexistente), então a correção do identificador é só no
-- default do schema + código, sem UPDATE destrutivo.
-- ===========================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "IntegracaoExterno" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'MERCADO_LIVRE',
    "state" TEXT,
    "stateExpiraEm" TIMESTAMP(3),
    "nome" TEXT NOT NULL,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "redirectUri" TEXT,
    "accountName" TEXT,
    "accountId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NAO_CONFIGURADO',
    "erros" JSONB,
    "ultimoTesteEm" TIMESTAMP(3),
    "ultimoSyncEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegracaoExterno_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntegracaoExterno_empresaId_idx" ON "IntegracaoExterno"("empresaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntegracaoExterno_tipo_idx" ON "IntegracaoExterno"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IntegracaoExterno_state_idx" ON "IntegracaoExterno"("state");

-- CreateUnique (idempotente: só adiciona se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'IntegracaoExterno_empresaId_tipo_key'
  ) THEN
    ALTER TABLE "IntegracaoExterno" ADD CONSTRAINT "IntegracaoExterno_empresaId_tipo_key" UNIQUE ("empresaId", "tipo");
  END IF;
END $$;

-- Persistência específica e aditiva para conexões Shopee multi-loja e state OAuth.
CREATE TABLE "ShopeeConexao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiry" TIMESTAMP(3),
    "refreshLeaseExpiraEm" TIMESTAMP(3),
    "pedidosNextSyncAt" TIMESTAMP(3),
    "pedidosLeaseExpiraEm" TIMESTAMP(3),
    "pedidosSyncTentativas" INTEGER NOT NULL DEFAULT 0,
    "pedidosJanelaDe" TIMESTAMP(3),
    "pedidosJanelaAte" TIMESTAMP(3),
    "pedidosCursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONECTADO',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoTesteEm" TIMESTAMP(3),
    "ultimoSyncEm" TIMESTAMP(3),
    "erros" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopeeConexao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopeeConexao_empresaId_shopId_key"
    ON "ShopeeConexao"("empresaId", "shopId");
CREATE UNIQUE INDEX "ShopeeConexao_id_empresaId_key"
    ON "ShopeeConexao"("id", "empresaId");
CREATE INDEX "ShopeeConexao_empresaId_status_idx"
    ON "ShopeeConexao"("empresaId", "status");
CREATE INDEX "ShopeeConexao_tokenExpiry_idx"
    ON "ShopeeConexao"("tokenExpiry");
CREATE INDEX "ShopeeConexao_refreshLeaseExpiraEm_idx"
    ON "ShopeeConexao"("refreshLeaseExpiraEm");
CREATE INDEX "ShopeeConexao_pedidosNextSyncAt_pedidosLeaseExpiraEm_idx"
    ON "ShopeeConexao"("pedidosNextSyncAt", "pedidosLeaseExpiraEm");
ALTER TABLE "ShopeeConexao"
    ADD CONSTRAINT "ShopeeConexao_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShopeeOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopeeOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopeeOAuthState_stateHash_key"
    ON "ShopeeOAuthState"("stateHash");
CREATE INDEX "ShopeeOAuthState_expiresAt_idx"
    ON "ShopeeOAuthState"("expiresAt");
CREATE INDEX "ShopeeOAuthState_empresaId_usuarioId_idx"
    ON "ShopeeOAuthState"("empresaId", "usuarioId");
ALTER TABLE "ShopeeOAuthState"
    ADD CONSTRAINT "ShopeeOAuthState_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopeeOAuthState"
    ADD CONSTRAINT "ShopeeOAuthState_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ShopeePedido" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "conexaoId" TEXT NOT NULL,
    "orderSn" TEXT NOT NULL,
    "statusExterno" TEXT NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "externalCreatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopeePedido_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopeePedido_conexaoId_orderSn_key"
    ON "ShopeePedido"("conexaoId", "orderSn");
CREATE INDEX "ShopeePedido_empresaId_statusExterno_idx"
    ON "ShopeePedido"("empresaId", "statusExterno");
CREATE INDEX "ShopeePedido_conexaoId_externalUpdatedAt_idx"
    ON "ShopeePedido"("conexaoId", "externalUpdatedAt");
ALTER TABLE "ShopeePedido"
    ADD CONSTRAINT "ShopeePedido_conexaoId_empresaId_fkey"
    FOREIGN KEY ("conexaoId", "empresaId") REFERENCES "ShopeeConexao"("id", "empresaId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

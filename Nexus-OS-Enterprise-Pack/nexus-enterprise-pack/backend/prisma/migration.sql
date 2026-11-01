-- Revise nomes e aplique via Prisma Migrate no schema real.
CREATE TABLE "NexusErpRecord" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'rascunho',
  "data" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "NexusErpRecord_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NexusErpApproval" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "requestedBy" TEXT,
  "decidedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pendente',
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "NexusErpApproval_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "NexusErpAuditLog" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "recordId" TEXT,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NexusErpAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NexusErpRecord_empresaId_module_createdAt_idx" ON "NexusErpRecord"("empresaId","module","createdAt");
CREATE INDEX "NexusErpRecord_empresaId_status_idx" ON "NexusErpRecord"("empresaId","status");
CREATE INDEX "NexusErpRecord_empresaId_title_idx" ON "NexusErpRecord"("empresaId","title");
CREATE INDEX "NexusErpApproval_empresaId_status_createdAt_idx" ON "NexusErpApproval"("empresaId","status","createdAt");
CREATE INDEX "NexusErpApproval_recordId_status_idx" ON "NexusErpApproval"("recordId","status");
CREATE INDEX "NexusErpAuditLog_empresaId_createdAt_idx" ON "NexusErpAuditLog"("empresaId","createdAt");
CREATE INDEX "NexusErpAuditLog_recordId_createdAt_idx" ON "NexusErpAuditLog"("recordId","createdAt");
-- Adicione as FKs para Empresa após confirmar o tipo/nome da PK no schema existente.

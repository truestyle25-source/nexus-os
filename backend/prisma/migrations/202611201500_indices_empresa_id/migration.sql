-- Índices em "empresaId" que faltavam (limpeza técnica 2026-11-20).
-- Toda consulta passa pela policy RLS "empresaId" = app_empresa_id(); sem índice,
-- essas tabelas são lidas por inteiro. Não destrutivo: só cria índices.
CREATE INDEX IF NOT EXISTS "Auditoria_empresaId_idx" ON "Auditoria"("empresaId");
CREATE INDEX IF NOT EXISTS "ConversaIA_empresaId_idx" ON "ConversaIA"("empresaId");
CREATE INDEX IF NOT EXISTS "IntegracaoPonto_empresaId_idx" ON "IntegracaoPonto"("empresaId");
CREATE INDEX IF NOT EXISTS "RegraAutomacao_empresaId_idx" ON "RegraAutomacao"("empresaId");

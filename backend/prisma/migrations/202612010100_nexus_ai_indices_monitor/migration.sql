-- NEXUS AI: índices por data para a varredura do monitor de segurança (somente aditiva).
-- Tabelas pequenas (LoginAttempt tem limpeza periódica); a criação é rápida.
CREATE INDEX "IntegracaoEvento_createdAt_idx" ON "IntegracaoEvento"("createdAt");

CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

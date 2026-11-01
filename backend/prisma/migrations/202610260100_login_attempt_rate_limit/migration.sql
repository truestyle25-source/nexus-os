-- Migration 202610260100_login_attempt_rate_limit
-- Adiciona tabela LoginAttempt para rate limit persistente de tentativas de login.
-- Sobrevive a reinícios do servidor e funciona corretamente atrás de proxies
-- (Vercel etc.) graças ao `trustProxy: true` do Fastify.

CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "email" TEXT,
    "sucesso" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");
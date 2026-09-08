-- ============================================================
-- NEXUS OS — Fase 1: Fundação
-- Schema PostgreSQL: empresas, filiais, usuários, papéis,
-- permissões granulares e auditoria.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- EMPRESAS E FILIAIS ----------

CREATE TABLE companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  cnpj          VARCHAR(14) NOT NULL UNIQUE, -- sempre normalizado (só dígitos)
  status        TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','cancelled')),
  trial_ends_at TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches ( -- filiais
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_main    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sectors ( -- setores
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id  UUID REFERENCES branches(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- PAPÉIS E PERMISSÕES GRANULARES ----------

CREATE TABLE roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL, -- admin, gestor, rh, financeiro, estoque, operador, funcionario, ou custom
  is_system    BOOLEAN NOT NULL DEFAULT false, -- papéis padrão criados na criação da empresa
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- módulo + ação = uma permissão possível (ex: 'vendas' + 'excluir')
CREATE TABLE permissions (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,   -- dashboard, produtos, estoque, vendas, pdv, financeiro, rh, etc.
  action TEXT NOT NULL,   -- visualizar, criar, editar, excluir, exportar
  UNIQUE (module, action)
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------- USUÁRIOS ----------

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sector_id      UUID REFERENCES sectors(id) ON DELETE SET NULL,
  role_id        UUID NOT NULL REFERENCES roles(id),
  name           TEXT NOT NULL,
  email          CITEXT NOT NULL, -- case-insensitive
  password_hash  TEXT NOT NULL,   -- scrypt: salt:hash
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);

-- sessões / refresh tokens (permite logout real e expiração controlada)
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash  TEXT NOT NULL, -- hash do refresh token, nunca o valor puro
  user_agent    TEXT,
  ip            TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- AUDITORIA ----------

CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,     -- create, update, delete, login, login_failed, permission_change...
  entity        TEXT NOT NULL,     -- users, roles, products, ...
  entity_id     UUID,
  old_value     JSONB,
  new_value     JSONB,
  origin        TEXT NOT NULL DEFAULT 'manual', -- manual, importado, api, automatico
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_company_created ON audit_log (company_id, created_at DESC);
CREATE INDEX idx_users_company ON users (company_id);

-- ---------- SEED: permissões padrão (módulo x ação) ----------
INSERT INTO permissions (module, action)
SELECT m, a
FROM unnest(ARRAY['dashboard','produtos','estoque','compras','fornecedores','clientes',
                   'vendas','pdv','financeiro','dre','roi','ticket_medio','metas','rh',
                   'ponto','auditoria','relatorios','alertas','integracoes','ia','configuracoes']) AS m,
     unnest(ARRAY['visualizar','criar','editar','excluir','exportar']) AS a
ON CONFLICT DO NOTHING;

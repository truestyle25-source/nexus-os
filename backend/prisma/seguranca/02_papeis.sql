-- =============================================================================
-- NEXUS OS — Papéis de banco (Fases 2 e 3 do plano de segurança)
--
-- Executar com psql, como o administrador do banco (no Supabase: `postgres`),
-- informando as senhas por variável (nunca grave senhas neste arquivo):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--        -v senha_app="$(openssl rand -base64 32)" \
--        -v senha_migrator="$(openssl rand -base64 32)" \
--        -f 02_papeis.sql
--
-- Idempotente: papéis já existentes são apenas ajustados (a senha é redefinida).
-- Pré-requisito: 01_rls_policies.sql já aplicado.
--
-- nexus_app      : runtime do backend. Só DML, SEM BYPASSRLS, sem DDL.
-- nexus_migrator : migrações (prisma migrate deploy via DIRECT_URL). Dono do
--                  schema após 03_ownership.sql. Sem BYPASSRLS.
-- O administrador (`postgres`) recebe participação em nexus_migrator para
-- continuar administrando as tabelas depois da troca de dono.
-- =============================================================================

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE nexus_app LOGIN PASSWORD %L', :'senha_app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') \gexec
SELECT format('ALTER ROLE nexus_app LOGIN PASSWORD %L', :'senha_app') \gexec

SELECT format('CREATE ROLE nexus_migrator LOGIN PASSWORD %L', :'senha_migrator')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') \gexec
SELECT format('ALTER ROLE nexus_migrator LOGIN PASSWORD %L', :'senha_migrator') \gexec

BEGIN;

-- (SUPERUSER/REPLICATION não são declarados: o admin do Supabase não é superuser
--  e não pode alterá-los; papéis novos já nascem sem eles — conferido no fim.)
ALTER ROLE nexus_app      NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT CONNECTION LIMIT 20;
ALTER ROLE nexus_migrator NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT CONNECTION LIMIT 3;

-- Timeouts do runtime: transação pendurada não pode segurar conexão do pool.
ALTER ROLE nexus_app SET statement_timeout = '15s';
ALTER ROLE nexus_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE nexus_app SET search_path = public;

-- O administrador continua conseguindo administrar o que nexus_migrator possuir.
GRANT nexus_migrator TO CURRENT_USER;

-- Schema
GRANT USAGE ON SCHEMA public TO nexus_app;
GRANT USAGE, CREATE ON SCHEMA public TO nexus_migrator;
REVOKE CREATE ON SCHEMA public FROM nexus_app;

-- Tabelas e sequências existentes
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_app;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM nexus_app;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM nexus_app;
-- NEXUS CLUB: históricos de aceite de termo e de consentimento (LGPD) não se alteram nem se apagam.
REVOKE UPDATE, DELETE ON TABLE public."TermoAceite", public."ConsentimentoEvento" FROM nexus_app;

-- Funções usadas pelas policies
GRANT EXECUTE ON FUNCTION public.app_empresa_id() TO nexus_app, nexus_migrator;
GRANT EXECUTE ON FUNCTION public.app_escopo_sistema() TO nexus_app, nexus_migrator;
GRANT EXECUTE ON FUNCTION public.app_consumidor_id() TO nexus_app, nexus_migrator;

-- Objetos criados no futuro (pelo administrador hoje, pelo nexus_migrator depois)
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexus_app;

-- Garantia: anon/authenticated continuam sem acesso ao schema da aplicação.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;

-- Verificação final: falha (e desfaz tudo) se algum atributo perigoso existir.
DO $$
DECLARE ruim text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO ruim FROM pg_roles
  WHERE rolname IN ('nexus_app', 'nexus_migrator')
    AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication);
  IF ruim IS NOT NULL THEN RAISE EXCEPTION 'Papel com privilégio indevido: %', ruim; END IF;
  IF has_table_privilege('nexus_app', 'public."_prisma_migrations"', 'SELECT') THEN
    RAISE EXCEPTION 'nexus_app não deve ler _prisma_migrations';
  END IF;
END $$;

COMMIT;

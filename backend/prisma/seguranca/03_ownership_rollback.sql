-- =============================================================================
-- NEXUS OS — Rollback de 03_ownership.sql: devolve a posse ao executor (ex.: postgres)
--
-- Explícito por objeto do schema public. NÃO usa `REASSIGN OWNED BY postgres`,
-- que no Supabase moveria objetos internos da plataforma.
-- Pré-requisito: 02_papeis.sql (o executor precisa ser membro de nexus_migrator).
-- Rollback: 03_ownership_rollback.sql
-- =============================================================================
BEGIN;
DO $$
DECLARE r record;
BEGIN
  -- Tabelas (as sequências ligadas a colunas acompanham a tabela)
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO CURRENT_USER', r.relname);
  END LOOP;
  -- Sequências avulsas
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO CURRENT_USER', r.relname);
  END LOOP;
  -- Views
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO CURRENT_USER', r.relname);
  END LOOP;
  -- Tipos (enums do Prisma)
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e'
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO CURRENT_USER', r.typname);
  END LOOP;
END $$;
ALTER FUNCTION public.app_empresa_id() OWNER TO CURRENT_USER;
ALTER FUNCTION public.app_escopo_sistema() OWNER TO CURRENT_USER;
DO $$ BEGIN IF to_regprocedure('public.app_consumidor_id()') IS NOT NULL THEN ALTER FUNCTION public.app_consumidor_id() OWNER TO CURRENT_USER; END IF; END $$;
COMMIT;

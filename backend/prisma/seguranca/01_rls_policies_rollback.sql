-- Rollback de 01_rls_policies.sql: remove policies, desliga RLS e as funções.
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND policyname LIKE 'nexus_%'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.app_empresa_id();
DROP FUNCTION IF EXISTS public.app_escopo_sistema();
DROP FUNCTION IF EXISTS public.app_consumidor_id();
COMMIT;

-- Rollback de 02_papeis.sql. Rode ANTES 03_ownership_rollback.sql se o 03 foi aplicado.
-- Volte a DATABASE_URL da aplicação para o usuário anterior antes de rodar isto.
BEGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM nexus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM nexus_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM nexus_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE nexus_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM nexus_app';
  END IF;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nexus_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM nexus_app;
REVOKE ALL ON SCHEMA public FROM nexus_app, nexus_migrator;
REVOKE EXECUTE ON FUNCTION public.app_empresa_id() FROM nexus_app, nexus_migrator;
REVOKE EXECUTE ON FUNCTION public.app_escopo_sistema() FROM nexus_app, nexus_migrator;
DO $$ BEGIN IF to_regprocedure('public.app_consumidor_id()') IS NOT NULL THEN EXECUTE 'REVOKE EXECUTE ON FUNCTION public.app_consumidor_id() FROM nexus_app, nexus_migrator'; END IF; END $$;
DROP ROLE IF EXISTS nexus_app;
DROP ROLE IF EXISTS nexus_migrator;
COMMIT;

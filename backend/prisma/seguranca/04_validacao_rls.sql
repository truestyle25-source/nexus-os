-- =============================================================================
-- NEXUS OS — Validação de RLS e privilégios (somente staging/teste!)
--
-- Cria 2 empresas de teste, testa o isolamento como nexus_app e DESFAZ tudo
-- (ROLLBACK no final). Cada verificação que falha aborta com EXCEPTION.
-- Executar como o administrador (membro de nexus_app não é necessário: o
-- script usa SET ROLE, então o executor precisa poder assumir nexus_app):
--   GRANT nexus_app TO <admin>;   -- só no staging
-- =============================================================================
BEGIN;

INSERT INTO "Empresa"(id, nome, "updatedAt") VALUES ('rls-emp-a', 'RLS A', now()), ('rls-emp-b', 'RLS B', now());
INSERT INTO "Categoria"(id, "empresaId", nome) VALUES ('rls-cat-a', 'rls-emp-a', 'Cat A'), ('rls-cat-b', 'rls-emp-b', 'Cat B');
INSERT INTO "Usuario"(id, "empresaId", nome, email, "senhaHash", "updatedAt")
  VALUES ('rls-usr-a', 'rls-emp-a', 'A', 'rls-a@teste.local', 'x', now()), ('rls-usr-b', 'rls-emp-b', 'B', 'rls-b@teste.local', 'x', now());
INSERT INTO "Permissao"(id, "usuarioId", modulo, acao) VALUES ('rls-perm-a', 'rls-usr-a', 'vendas', 'visualizar'), ('rls-perm-b', 'rls-usr-b', 'vendas', 'visualizar');

SET LOCAL ROLE nexus_app;

DO $$
DECLARE n int; ok boolean;
BEGIN
  -- T1: sem contexto, nada é visível
  SELECT count(*) INTO n FROM "Categoria" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T1 falhou: sem contexto viu % categorias', n; END IF;
  SELECT count(*) INTO n FROM "Usuario" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T1b falhou: sem contexto viu % usuários', n; END IF;
  RAISE NOTICE 'T1 ok: sem contexto = 0 linhas';

  -- T2: contexto A vê só A (tabela direta, Empresa e tabela filha via EXISTS)
  PERFORM set_config('app.empresa_id', 'rls-emp-a', true);
  PERFORM set_config('app.escopo', 'tenant', true);
  SELECT count(*) INTO n FROM "Categoria" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T2 falhou: contexto A viu % categorias', n; END IF;
  SELECT count(*) INTO n FROM "Empresa" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T2b falhou: contexto A viu % empresas', n; END IF;
  SELECT count(*) INTO n FROM "Permissao" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T2c falhou: contexto A viu % permissões (filha)', n; END IF;
  RAISE NOTICE 'T2 ok: contexto A isolado (direta, Empresa, filha)';

  -- T3: A não altera nem apaga linha de B (0 linhas afetadas)
  UPDATE "Categoria" SET nome = 'invadido' WHERE id = 'rls-cat-b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T3 falhou: A alterou % linhas de B', n; END IF;
  DELETE FROM "Categoria" WHERE id = 'rls-cat-b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T3b falhou: A apagou % linhas de B', n; END IF;
  RAISE NOTICE 'T3 ok: A não altera/apaga dados de B';

  -- T4: WITH CHECK — A não grava com empresaId de B
  ok := false;
  BEGIN
    INSERT INTO "Categoria"(id, "empresaId", nome) VALUES ('rls-cat-x', 'rls-emp-b', 'X');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 falhou: A inseriu categoria na empresa B'; END IF;
  ok := false;
  BEGIN
    UPDATE "Categoria" SET "empresaId" = 'rls-emp-b' WHERE id = 'rls-cat-a';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4b falhou: A moveu categoria para a empresa B'; END IF;
  ok := false;
  BEGIN
    INSERT INTO "Permissao"(id, "usuarioId", modulo, acao) VALUES ('rls-perm-x', 'rls-usr-b', 'rh', 'editar');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4c falhou: A concedeu permissão a usuário de B'; END IF;
  RAISE NOTICE 'T4 ok: WITH CHECK bloqueia escrita em outra empresa';

  -- T5: A grava normalmente na própria empresa
  INSERT INTO "Categoria"(id, "empresaId", nome) VALUES ('rls-cat-a2', 'rls-emp-a', 'A2');
  RAISE NOTICE 'T5 ok: escrita na própria empresa funciona';

  -- T6: escopo sistema enxerga as duas empresas (login, jobs)
  PERFORM set_config('app.empresa_id', '', true);
  PERFORM set_config('app.escopo', 'sistema', true);
  SELECT count(*) INTO n FROM "Usuario" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T6 falhou: escopo sistema viu % usuários', n; END IF;
  RAISE NOTICE 'T6 ok: escopo sistema funciona';

  -- T7: LoginAttempt só em escopo sistema
  PERFORM set_config('app.escopo', 'tenant', true);
  PERFORM set_config('app.empresa_id', 'rls-emp-a', true);
  ok := false;
  BEGIN
    INSERT INTO "LoginAttempt"(id, ip, email, sucesso) VALUES ('rls-la', '1.1.1.1', 'x@x', false);
  EXCEPTION WHEN insufficient_privilege OR not_null_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T7 falhou: tenant gravou em LoginAttempt'; END IF;
  RAISE NOTICE 'T7 ok: LoginAttempt restrito ao escopo sistema';
END $$;

-- T8: nexus_app sem DDL / TRUNCATE / histórico de migrações
DO $$
DECLARE ok boolean;
BEGIN
  ok := false;
  BEGIN EXECUTE 'CREATE TABLE public.rls_invasor(id int)'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8 falhou: nexus_app criou tabela'; END IF;
  ok := false;
  BEGIN EXECUTE 'TRUNCATE "Categoria"'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8b falhou: nexus_app executou TRUNCATE'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM "_prisma_migrations" LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8c falhou: nexus_app leu _prisma_migrations'; END IF;
  ok := false;
  BEGIN EXECUTE 'ALTER TABLE "Categoria" DISABLE ROW LEVEL SECURITY'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T8d falhou: nexus_app desligou RLS'; END IF;
  RAISE NOTICE 'T8 ok: nexus_app sem DDL, TRUNCATE, histórico de migrações ou desligar RLS';
END $$;

RESET ROLE;

-- T9: anon/authenticated sem acesso ao schema
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND has_schema_privilege('anon', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'T9 falhou: anon tem USAGE em public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'T9b falhou: authenticated tem USAGE em public';
  END IF;
  RAISE NOTICE 'T9 ok: anon/authenticated sem acesso a public';
END $$;

-- T10: o administrador continua administrando (app atual como postgres não quebra)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Categoria" WHERE id LIKE 'rls-%';
  IF n < 2 THEN RAISE EXCEPTION 'T10 falhou: admin viu % categorias', n; END IF;
  UPDATE "Categoria" SET nome = nome WHERE id LIKE 'rls-%';
  RAISE NOTICE 'T10 ok: administrador (BYPASSRLS) continua com acesso total';
END $$;

ROLLBACK;

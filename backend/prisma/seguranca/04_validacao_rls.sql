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

-- NEXUS CLUB (Fase 2): duas pessoas, dois clubes. Pessoa 1 participa de A e B; pessoa 2 só de A.
INSERT INTO "Cliente"(id, "empresaId", nome, "updatedAt") VALUES ('rls-cli-a', 'rls-emp-a', 'Cli A', now()), ('rls-cli-b', 'rls-emp-b', 'Cli B', now());
INSERT INTO "ContaConsumidor"(id, email, "cpfHash", "cpfCifrado", nome, "senhaHash", "updatedAt")
  VALUES ('rls-con-1', 'rls-c1@teste.local', 'rls-h1', 'x', 'Pessoa 1', 'x', now()), ('rls-con-2', 'rls-c2@teste.local', 'rls-h2', 'x', 'Pessoa 2', 'x', now());
INSERT INTO "ConsumidorToken"(id, "consumidorId", tipo, "tokenHash", "expiraEm") VALUES ('rls-tok-1', 'rls-con-1', 'VERIFICAR_EMAIL', 'rls-th1', now() + interval '1 day');
INSERT INTO "ClubeConfig"(id, "empresaId", nome, ativo, publico, "updatedAt")
  VALUES ('rls-clube-a', 'rls-emp-a', 'Clube A', true, true, now()), ('rls-clube-b', 'rls-emp-b', 'Clube B', true, false, now());
INSERT INTO "MembroClube"(id, "empresaId", "consumidorId", "clienteId", "updatedAt")
  VALUES ('rls-m1a', 'rls-emp-a', 'rls-con-1', 'rls-cli-a', now()), ('rls-m1b', 'rls-emp-b', 'rls-con-1', NULL, now()), ('rls-m2a', 'rls-emp-a', 'rls-con-2', NULL, now());
INSERT INTO "TermoVersao"(id, "empresaId", tipo, versao, texto)
  VALUES ('rls-termo-p', NULL, 'TERMOS_USO', 900001, 'Termo da plataforma'), ('rls-termo-a', 'rls-emp-a', 'AUTORIZACAO_MARKETING', 1, 'Autorização A');
INSERT INTO "TermoAceite"(id, "consumidorId", "termoVersaoId", "empresaId") VALUES ('rls-ac-1', 'rls-con-1', 'rls-termo-p', NULL);
INSERT INTO "ConsentimentoEvento"(id, "empresaId", "consumidorId", canal, acao, origem, "termoVersaoId")
  VALUES ('rls-ce-1a', 'rls-emp-a', 'rls-con-1', 'WHATSAPP', 'CONCEDIDO', 'APP', 'rls-termo-a');
INSERT INTO "ConsentimentoAtual"(id, "empresaId", "consumidorId", canal, situacao, "eventoId")
  VALUES ('rls-ca-1a', 'rls-emp-a', 'rls-con-1', 'WHATSAPP', 'CONCEDIDO', 'rls-ce-1a');

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

-- T11: NEXUS CLUB (Fase 2) — conta global do consumidor, clubes e consentimentos
DO $$
DECLARE n int; ok boolean;
BEGIN
  -- T11a: sem contexto, nada da conta nem dos clubes (só o termo público da plataforma)
  PERFORM set_config('app.empresa_id', '', true);
  PERFORM set_config('app.escopo', '', true);
  PERFORM set_config('app.consumidor_id', '', true);
  SELECT count(*) INTO n FROM "ContaConsumidor" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11a falhou: sem contexto viu % contas', n; END IF;
  SELECT count(*) INTO n FROM "MembroClube" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11a2 falhou: sem contexto viu % carteirinhas', n; END IF;
  SELECT count(*) INTO n FROM "TermoVersao" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11a3 falhou: sem contexto viu % termos (esperado só o da plataforma)', n; END IF;
  RAISE NOTICE 'T11a ok: sem contexto só o termo público';

  -- T11b: pessoa 1 vê a própria conta e as próprias carteirinhas (A e B), nada da empresa
  PERFORM set_config('app.consumidor_id', 'rls-con-1', true);
  SELECT count(*) INTO n FROM "ContaConsumidor" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11b falhou: pessoa 1 viu % contas', n; END IF;
  SELECT count(*) INTO n FROM "MembroClube" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T11b2 falhou: pessoa 1 viu % carteirinhas', n; END IF;
  SELECT count(*) INTO n FROM "ClubeConfig" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T11b3 falhou: pessoa 1 viu % clubes (A público + B do qual participa)', n; END IF;
  SELECT count(*) INTO n FROM "ConsentimentoEvento" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11b4 falhou: pessoa 1 viu % consentimentos', n; END IF;
  SELECT count(*) INTO n FROM "ConsumidorToken" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11b5 falhou: pessoa 1 viu % tokens (só o sistema vê)', n; END IF;
  SELECT count(*) INTO n FROM "Cliente" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11b6 falhou: consumidor viu % clientes das empresas', n; END IF;
  SELECT count(*) INTO n FROM "Categoria" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11b7 falhou: consumidor viu % categorias das empresas', n; END IF;
  RAISE NOTICE 'T11b ok: pessoa 1 vê só o que é dela e nada do sistema das empresas';

  -- T11c: pessoa 1 não altera a pessoa 2; altera a si mesma
  UPDATE "ContaConsumidor" SET nome = 'invadido' WHERE id = 'rls-con-2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T11c falhou: pessoa 1 alterou % contas da pessoa 2', n; END IF;
  UPDATE "ContaConsumidor" SET celular = '0' WHERE id = 'rls-con-1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'T11c2 falhou: pessoa 1 não alterou a própria conta'; END IF;
  RAISE NOTICE 'T11c ok: só a própria conta';

  -- T11d: sem o contexto da empresa, o consumidor não cria carteirinha nem consentimento
  ok := false;
  BEGIN
    INSERT INTO "MembroClube"(id, "empresaId", "consumidorId", "updatedAt") VALUES ('rls-mx', 'rls-emp-b', 'rls-con-2', now());
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T11d falhou: consumidor criou carteirinha sem contexto da empresa'; END IF;
  ok := false;
  BEGIN
    INSERT INTO "ConsentimentoEvento"(id, "empresaId", "consumidorId", canal, acao, origem) VALUES ('rls-cex', 'rls-emp-b', 'rls-con-1', 'EMAIL', 'CONCEDIDO', 'APP');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T11d2 falhou: consumidor gravou consentimento sem contexto da empresa'; END IF;
  RAISE NOTICE 'T11d ok: escrita do consumidor exige contexto da empresa';

  -- T11e: aceite do termo da plataforma só para si mesmo
  INSERT INTO "TermoAceite"(id, "consumidorId", "termoVersaoId", "empresaId") VALUES ('rls-ac-x', 'rls-con-1', 'rls-termo-p', NULL)
    ON CONFLICT ("consumidorId", "termoVersaoId") DO NOTHING;
  ok := false;
  BEGIN
    INSERT INTO "TermoAceite"(id, "consumidorId", "termoVersaoId", "empresaId") VALUES ('rls-ac-y', 'rls-con-2', 'rls-termo-p', NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T11e falhou: pessoa 1 registrou aceite em nome da pessoa 2'; END IF;
  RAISE NOTICE 'T11e ok: aceite só em nome próprio';

  -- T11f: pessoa 2 vê só o clube público A (não o B, do qual não participa)
  PERFORM set_config('app.consumidor_id', 'rls-con-2', true);
  SELECT count(*) INTO n FROM "ClubeConfig" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11f falhou: pessoa 2 viu % clubes', n; END IF;
  SELECT count(*) INTO n FROM "MembroClube" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11f2 falhou: pessoa 2 viu % carteirinhas', n; END IF;
  RAISE NOTICE 'T11f ok: clube não público só para quem participa';

  -- T11g: empresa A vê só as carteirinhas dela; nunca a conta global nem os dados de B
  PERFORM set_config('app.consumidor_id', '', true);
  PERFORM set_config('app.empresa_id', 'rls-emp-a', true);
  PERFORM set_config('app.escopo', 'tenant', true);
  SELECT count(*) INTO n FROM "MembroClube" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T11g falhou: empresa A viu % carteirinhas', n; END IF;
  SELECT count(*) INTO n FROM "ContaConsumidor" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11g2 falhou: empresa A viu % contas globais', n; END IF;
  SELECT count(*) INTO n FROM "ClubeConfig" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11g3 falhou: empresa A viu % configurações', n; END IF;
  SELECT count(*) INTO n FROM "TermoVersao" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T11g4 falhou: empresa A viu % termos (plataforma + o dela)', n; END IF;
  SELECT count(*) INTO n FROM "TermoAceite" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11g5 falhou: empresa A viu % aceites da plataforma', n; END IF;
  RAISE NOTICE 'T11g ok: empresa A isolada (sem conta global, sem dados de B)';

  -- T11h: empresa A não liga a carteirinha a um cliente de B
  ok := false;
  BEGIN
    UPDATE "MembroClube" SET "clienteId" = 'rls-cli-b' WHERE id = 'rls-m2a';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T11h falhou: carteirinha de A ligada a cliente de B'; END IF;
  RAISE NOTICE 'T11h ok: carteirinha só com cliente da mesma empresa';

  -- T11i: histórico de consentimento: grava, mas não altera nem apaga
  INSERT INTO "ConsentimentoEvento"(id, "empresaId", "consumidorId", canal, acao, origem) VALUES ('rls-ce-2a', 'rls-emp-a', 'rls-con-1', 'WHATSAPP', 'REVOGADO', 'GESTOR');
  ok := false;
  BEGIN UPDATE "ConsentimentoEvento" SET acao = 'CONCEDIDO' WHERE id = 'rls-ce-2a'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T11i falhou: histórico de consentimento alterado'; END IF;
  ok := false;
  BEGIN DELETE FROM "ConsentimentoEvento" WHERE id = 'rls-ce-1a'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T11i2 falhou: histórico de consentimento apagado'; END IF;
  ok := false;
  BEGIN DELETE FROM "TermoAceite" WHERE id = 'rls-ac-1'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'T11i3 falhou: aceite de termo apagado'; END IF;
  RAISE NOTICE 'T11i ok: históricos só crescem';

  -- T11j: empresa B não vê nada de A
  PERFORM set_config('app.empresa_id', 'rls-emp-b', true);
  SELECT count(*) INTO n FROM "ConsentimentoEvento" WHERE id LIKE 'rls-%';
  IF n <> 0 THEN RAISE EXCEPTION 'T11j falhou: empresa B viu % consentimentos de A', n; END IF;
  SELECT count(*) INTO n FROM "MembroClube" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11j2 falhou: empresa B viu % carteirinhas', n; END IF;
  RAISE NOTICE 'T11j ok: empresa B isolada';

  -- T11k: sessão do consumidor pode registrar logout (TokenRevogado)
  PERFORM set_config('app.empresa_id', '', true);
  PERFORM set_config('app.escopo', '', true);
  PERFORM set_config('app.consumidor_id', 'rls-con-1', true);
  INSERT INTO "TokenRevogado"(id, jti, "expiraEm") VALUES ('rls-tr-c', 'rls-jti-consumidor', now() + interval '1 hour');
  RAISE NOTICE 'T11k ok: logout do consumidor gravado';

  -- T11l: o sistema enxerga as duas contas e os tokens (login, verificação de e-mail)
  PERFORM set_config('app.consumidor_id', '', true);
  PERFORM set_config('app.escopo', 'sistema', true);
  SELECT count(*) INTO n FROM "ContaConsumidor" WHERE id LIKE 'rls-%';
  IF n <> 2 THEN RAISE EXCEPTION 'T11l falhou: sistema viu % contas', n; END IF;
  SELECT count(*) INTO n FROM "ConsumidorToken" WHERE id LIKE 'rls-%';
  IF n <> 1 THEN RAISE EXCEPTION 'T11l2 falhou: sistema viu % tokens', n; END IF;
  RAISE NOTICE 'T11l ok: escopo sistema funciona para o NEXUS CLUB';
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

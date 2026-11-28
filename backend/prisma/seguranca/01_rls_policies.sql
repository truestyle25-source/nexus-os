-- =============================================================================
-- NEXUS OS — RLS multi-empresa (Fases 1 e 5 do plano de segurança)
--
-- Idempotente: pode ser executado mais de uma vez.
-- Seguro com o papel `postgres`: ele tem BYPASSRLS, então NADA muda para a
-- aplicação enquanto ela conectar como `postgres`. As policies passam a valer
-- quando a aplicação conectar como `nexus_app` (ver 02_papeis.sql).
--
-- NÃO usa FORCE ROW LEVEL SECURITY (o dono das tabelas — postgres ou
-- nexus_migrator — precisa ler/escrever em migrações e backfills).
--
-- Contexto lido das variáveis definidas pelo backend em cada transação
-- (backend/src/lib/prisma.ts):
--   app.empresa_id  — empresa autenticada (validada no banco pelo backend)
--   app.escopo      — 'tenant' | 'sistema'
-- Sem contexto, as funções retornam NULL/false e as policies negam tudo.
--
-- Rollback: 01_rls_policies_rollback.sql
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.app_empresa_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.empresa_id', true), '') $$;

CREATE OR REPLACE FUNCTION public.app_escopo_sistema() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT coalesce(current_setting('app.escopo', true), '') = 'sistema' $$;

REVOKE ALL ON FUNCTION public.app_empresa_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_escopo_sistema() FROM PUBLIC;

-- NEXUS CLUB: conta do consumidor autenticado nas rotas /club (app.consumidor_id).
CREATE OR REPLACE FUNCTION public.app_consumidor_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.consumidor_id', true), '') $$;
REVOKE ALL ON FUNCTION public.app_consumidor_id() FROM PUBLIC;

-- 1) Todas as tabelas com coluna "empresaId": isolamento direto por empresa.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'empresaId'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS nexus_tenant ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY nexus_tenant ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC
         USING ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())
         WITH CHECK ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())', t);
  END LOOP;
END $$;

-- 2) Empresa: a própria linha da empresa do contexto.
ALTER TABLE public."Empresa" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_tenant ON public."Empresa";
CREATE POLICY nexus_tenant ON public."Empresa" FOR ALL TO PUBLIC
  USING (id = public.app_empresa_id() OR public.app_escopo_sistema())
  WITH CHECK (id = public.app_empresa_id() OR public.app_escopo_sistema());

-- 3) Tabelas filhas sem "empresaId": herdam o isolamento da tabela-mãe.
--    O EXISTS é avaliado com o RLS da mãe, então só enxerga mães da empresa.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('Permissao',             'usuarioId',     'Usuario'),
      ('TokenRecuperacaoSenha', 'usuarioId',     'Usuario'),
      ('CompraItem',            'compraId',      'Compra'),
      ('VendaItem',             'vendaId',       'Venda'),
      ('MovimentacaoCaixa',     'caixaId',       'Caixa'),
      ('Ferias',                'funcionarioId', 'Funcionario'),
      ('Pagamento',             'assinaturaId',  'Assinatura')
    ) AS v(tabela, fk, mae)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tabela);
    EXECUTE format('DROP POLICY IF EXISTS nexus_tenant ON public.%I', r.tabela);
    EXECUTE format(
      'CREATE POLICY nexus_tenant ON public.%1$I FOR ALL TO PUBLIC
         USING (public.app_escopo_sistema() OR EXISTS (SELECT 1 FROM public.%3$I m WHERE m.id = %1$I.%2$I))
         WITH CHECK (public.app_escopo_sistema() OR EXISTS (SELECT 1 FROM public.%3$I m WHERE m.id = %1$I.%2$I))',
      r.tabela, r.fk, r.mae);
  END LOOP;
END $$;

-- 4) Tabelas de segurança sem empresa.
--    LoginAttempt (e-mail/IP de tentativas de login): só em escopo de sistema.
ALTER TABLE public."LoginAttempt" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_sistema ON public."LoginAttempt";
CREATE POLICY nexus_sistema ON public."LoginAttempt" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema()) WITH CHECK (public.app_escopo_sistema());

--    TokenRevogado (só jti + expiração, sem dado pessoal): consultado em toda
--    requisição autenticada e gravado no logout/troca de senha.
ALTER TABLE public."TokenRevogado" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_tenant ON public."TokenRevogado";
--    Desde o NEXUS CLUB também na sessão do consumidor (logout em /club).
CREATE POLICY nexus_tenant ON public."TokenRevogado" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema() OR public.app_empresa_id() IS NOT NULL OR public.app_consumidor_id() IS NOT NULL)
  WITH CHECK (public.app_escopo_sistema() OR public.app_empresa_id() IS NOT NULL OR public.app_consumidor_id() IS NOT NULL);

--    RateLimitJanela (contadores de rate limit por IP/usuário) e TarefaAgendada
--    (trava das tarefas diárias entre instâncias): infraestrutura, só sistema.
ALTER TABLE public."RateLimitJanela" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_sistema ON public."RateLimitJanela";
CREATE POLICY nexus_sistema ON public."RateLimitJanela" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema()) WITH CHECK (public.app_escopo_sistema());

ALTER TABLE public."TarefaAgendada" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_sistema ON public."TarefaAgendada";
CREATE POLICY nexus_sistema ON public."TarefaAgendada" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema()) WITH CHECK (public.app_escopo_sistema());

-- 4b) NEXUS CLUB. As tabelas com empresaId já receberam nexus_tenant no item 1; aqui
--     entram a conta GLOBAL do consumidor e as leituras do próprio consumidor
--     (permissivas: somam-se à regra da empresa). Mesmo texto da migração
--     202701020000_nexus_club_fase2_dados.
ALTER TABLE public."ContaConsumidor" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_consumidor ON public."ContaConsumidor";
CREATE POLICY nexus_consumidor ON public."ContaConsumidor" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema() OR id = public.app_consumidor_id())
  WITH CHECK (public.app_escopo_sistema() OR id = public.app_consumidor_id());

ALTER TABLE public."ConsumidorToken" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_sistema ON public."ConsumidorToken";
CREATE POLICY nexus_sistema ON public."ConsumidorToken" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema()) WITH CHECK (public.app_escopo_sistema());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MembroClube', 'TermoAceite', 'ConsentimentoEvento', 'ConsentimentoAtual']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS nexus_consumidor_leitura ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY nexus_consumidor_leitura ON public.%I AS PERMISSIVE FOR SELECT TO PUBLIC
         USING ("consumidorId" = public.app_consumidor_id())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS nexus_consumidor_aceite ON public."TermoAceite";
CREATE POLICY nexus_consumidor_aceite ON public."TermoAceite" AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ("consumidorId" = public.app_consumidor_id() AND "empresaId" IS NULL);

DROP POLICY IF EXISTS nexus_consumidor_leitura ON public."ClubeConfig";
CREATE POLICY nexus_consumidor_leitura ON public."ClubeConfig" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (public.app_consumidor_id() IS NOT NULL AND "ativo" AND ("publico" OR EXISTS (
    SELECT 1 FROM public."MembroClube" m
    WHERE m."empresaId" = "ClubeConfig"."empresaId" AND m."consumidorId" = public.app_consumidor_id())));

DROP POLICY IF EXISTS nexus_termo_leitura ON public."TermoVersao";
CREATE POLICY nexus_termo_leitura ON public."TermoVersao" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ("empresaId" IS NULL OR public.app_consumidor_id() IS NOT NULL);

-- 5) Controle: nenhuma tabela de public pode ficar sem RLS (exceto o histórico
--    de migrações do Prisma, que só o dono acessa).
DO $$
DECLARE faltando text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO faltando
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations';
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas sem RLS: %', faltando;
  END IF;
END $$;

COMMIT;

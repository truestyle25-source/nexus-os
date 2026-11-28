-- NEXUS CLUB, Fase 2 (plano aprovado em 27/11/2026): conta do consumidor, clubes, termos e
-- consentimentos. SOMENTE ACRÉSCIMOS: tipos, tabelas, índices, chaves, um valor novo no enum
-- Origem e as regras de isolamento (RLS) das tabelas novas. Nada existente é alterado ou apagado,
-- exceto a regra da tabela TokenRevogado, que passa a aceitar também a sessão do consumidor.

-- CreateEnum
CREATE TYPE "StatusContaConsumidor" AS ENUM ('PENDENTE_VERIFICACAO', 'ATIVA', 'BLOQUEADA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "TipoTokenConsumidor" AS ENUM ('VERIFICAR_EMAIL', 'REDEFINIR_SENHA');

-- CreateEnum
CREATE TYPE "StatusMembroClube" AS ENUM ('ATIVO', 'PENDENTE_VINCULO', 'SAIU', 'BLOQUEADO');

-- CreateEnum
CREATE TYPE "TipoTermo" AS ENUM ('TERMOS_USO', 'POLITICA_PRIVACIDADE', 'AUTORIZACAO_MARKETING');

-- CreateEnum
CREATE TYPE "CanalConsentimento" AS ENUM ('WHATSAPP', 'EMAIL', 'APP');

-- CreateEnum
CREATE TYPE "FinalidadeConsentimento" AS ENUM ('MARKETING');

-- CreateEnum
CREATE TYPE "AcaoConsentimento" AS ENUM ('CONCEDIDO', 'REVOGADO');

-- CreateEnum
CREATE TYPE "OrigemConsentimento" AS ENUM ('APP', 'PDV', 'WHATSAPP_SAIR', 'GESTOR', 'SISTEMA');

-- AlterEnum
ALTER TYPE "Origem" ADD VALUE 'NEXUS_CLUB';

-- DropIndex

-- CreateTable
CREATE TABLE "ContaConsumidor" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpfHash" TEXT NOT NULL,
    "cpfCifrado" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "celular" TEXT,
    "whatsapp" TEXT,
    "nascimento" DATE,
    "senhaHash" TEXT NOT NULL,
    "emailVerificadoEm" TIMESTAMP(3),
    "status" "StatusContaConsumidor" NOT NULL DEFAULT 'PENDENTE_VERIFICACAO',
    "sessoesValidasDesde" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaConsumidor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumidorToken" (
    "id" TEXT NOT NULL,
    "consumidorId" TEXT NOT NULL,
    "tipo" "TipoTokenConsumidor" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumidorToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubeConfig" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "logoChave" TEXT,
    "corPrimaria" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "publico" BOOLEAN NOT NULL DEFAULT false,
    "beneficioPercentual" DECIMAL(5,2),
    "limiteBeneficio" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembroClube" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "consumidorId" TEXT NOT NULL,
    "clienteId" TEXT,
    "status" "StatusMembroClube" NOT NULL DEFAULT 'ATIVO',
    "entrouEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saiuEm" TIMESTAMP(3),
    "codigoQr" TEXT,
    "codigoQrGeradoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembroClube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermoVersao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT,
    "tipo" "TipoTermo" NOT NULL,
    "versao" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "publicadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermoVersao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermoAceite" (
    "id" TEXT NOT NULL,
    "consumidorId" TEXT NOT NULL,
    "termoVersaoId" TEXT NOT NULL,
    "empresaId" TEXT,
    "ip" TEXT,
    "aceitoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermoAceite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentimentoEvento" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "consumidorId" TEXT NOT NULL,
    "canal" "CanalConsentimento" NOT NULL,
    "finalidade" "FinalidadeConsentimento" NOT NULL DEFAULT 'MARKETING',
    "acao" "AcaoConsentimento" NOT NULL,
    "termoVersaoId" TEXT,
    "origem" "OrigemConsentimento" NOT NULL,
    "registradoPorId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentimentoEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentimentoAtual" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "consumidorId" TEXT NOT NULL,
    "canal" "CanalConsentimento" NOT NULL,
    "finalidade" "FinalidadeConsentimento" NOT NULL DEFAULT 'MARKETING',
    "situacao" "AcaoConsentimento" NOT NULL,
    "eventoId" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentimentoAtual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContaConsumidor_email_key" ON "ContaConsumidor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ContaConsumidor_cpfHash_key" ON "ContaConsumidor"("cpfHash");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumidorToken_tokenHash_key" ON "ConsumidorToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsumidorToken_consumidorId_tipo_idx" ON "ConsumidorToken"("consumidorId", "tipo");

-- CreateIndex
CREATE INDEX "ConsumidorToken_expiraEm_idx" ON "ConsumidorToken"("expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "ClubeConfig_empresaId_key" ON "ClubeConfig"("empresaId");

-- CreateIndex
CREATE INDEX "MembroClube_consumidorId_idx" ON "MembroClube"("consumidorId");

-- CreateIndex
CREATE INDEX "MembroClube_clienteId_idx" ON "MembroClube"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "MembroClube_empresaId_consumidorId_key" ON "MembroClube"("empresaId", "consumidorId");

-- CreateIndex
CREATE UNIQUE INDEX "MembroClube_empresaId_codigoQr_key" ON "MembroClube"("empresaId", "codigoQr");

-- CreateIndex
CREATE INDEX "TermoVersao_tipo_publicadoEm_idx" ON "TermoVersao"("tipo", "publicadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "TermoVersao_empresaId_tipo_versao_key" ON "TermoVersao"("empresaId", "tipo", "versao");

-- CreateIndex
CREATE INDEX "TermoAceite_empresaId_idx" ON "TermoAceite"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "TermoAceite_consumidorId_termoVersaoId_key" ON "TermoAceite"("consumidorId", "termoVersaoId");

-- CreateIndex
CREATE INDEX "ConsentimentoEvento_empresaId_consumidorId_canal_idx" ON "ConsentimentoEvento"("empresaId", "consumidorId", "canal");

-- CreateIndex
CREATE INDEX "ConsentimentoEvento_consumidorId_idx" ON "ConsentimentoEvento"("consumidorId");

-- CreateIndex
CREATE INDEX "ConsentimentoAtual_consumidorId_idx" ON "ConsentimentoAtual"("consumidorId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentimentoAtual_empresaId_consumidorId_canal_finalidade_key" ON "ConsentimentoAtual"("empresaId", "consumidorId", "canal", "finalidade");

-- AddForeignKey
ALTER TABLE "ConsumidorToken" ADD CONSTRAINT "ConsumidorToken_consumidorId_fkey" FOREIGN KEY ("consumidorId") REFERENCES "ContaConsumidor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubeConfig" ADD CONSTRAINT "ClubeConfig_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembroClube" ADD CONSTRAINT "MembroClube_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembroClube" ADD CONSTRAINT "MembroClube_consumidorId_fkey" FOREIGN KEY ("consumidorId") REFERENCES "ContaConsumidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembroClube" ADD CONSTRAINT "MembroClube_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermoVersao" ADD CONSTRAINT "TermoVersao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermoAceite" ADD CONSTRAINT "TermoAceite_consumidorId_fkey" FOREIGN KEY ("consumidorId") REFERENCES "ContaConsumidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermoAceite" ADD CONSTRAINT "TermoAceite_termoVersaoId_fkey" FOREIGN KEY ("termoVersaoId") REFERENCES "TermoVersao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermoAceite" ADD CONSTRAINT "TermoAceite_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimentoEvento" ADD CONSTRAINT "ConsentimentoEvento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimentoEvento" ADD CONSTRAINT "ConsentimentoEvento_consumidorId_fkey" FOREIGN KEY ("consumidorId") REFERENCES "ContaConsumidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimentoEvento" ADD CONSTRAINT "ConsentimentoEvento_termoVersaoId_fkey" FOREIGN KEY ("termoVersaoId") REFERENCES "TermoVersao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimentoAtual" ADD CONSTRAINT "ConsentimentoAtual_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentimentoAtual" ADD CONSTRAINT "ConsentimentoAtual_consumidorId_fkey" FOREIGN KEY ("consumidorId") REFERENCES "ContaConsumidor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Coerência entre empresas (o banco recusa, mesmo que o código erre)
-- =============================================================================

-- Termo da plataforma (empresaId nulo): versão única por tipo. O índice único do Prisma
-- não cobre a linha com empresaId nulo, porque o Postgres trata nulos como diferentes.
CREATE UNIQUE INDEX "TermoVersao_plataforma_tipo_versao_key" ON "TermoVersao"("tipo", "versao") WHERE "empresaId" IS NULL;

-- A carteirinha só pode apontar para um Cliente da MESMA empresa.
CREATE OR REPLACE FUNCTION public.clube_membro_cliente_mesma_empresa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."clienteId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."Cliente" c WHERE c.id = NEW."clienteId" AND c."empresaId" = NEW."empresaId"
  ) THEN
    RAISE EXCEPTION 'MembroClube: o cliente % não pertence à empresa %', NEW."clienteId", NEW."empresaId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clube_membro_cliente_mesma_empresa ON "MembroClube";
CREATE TRIGGER clube_membro_cliente_mesma_empresa BEFORE INSERT OR UPDATE OF "clienteId", "empresaId" ON "MembroClube"
  FOR EACH ROW EXECUTE FUNCTION public.clube_membro_cliente_mesma_empresa();

-- Aceite e consentimento só podem citar um termo da mesma empresa (ou da plataforma).
CREATE OR REPLACE FUNCTION public.clube_termo_mesma_empresa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."termoVersaoId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."TermoVersao" t
    WHERE t.id = NEW."termoVersaoId"
      AND (t."empresaId" IS NULL OR t."empresaId" = NEW."empresaId")
      AND (TG_TABLE_NAME <> 'TermoAceite' OR t."empresaId" IS NOT DISTINCT FROM NEW."empresaId")
  ) THEN
    RAISE EXCEPTION '%: o termo % não é desta empresa', TG_TABLE_NAME, NEW."termoVersaoId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clube_termo_mesma_empresa ON "TermoAceite";
CREATE TRIGGER clube_termo_mesma_empresa BEFORE INSERT OR UPDATE ON "TermoAceite"
  FOR EACH ROW EXECUTE FUNCTION public.clube_termo_mesma_empresa();
DROP TRIGGER IF EXISTS clube_termo_mesma_empresa ON "ConsentimentoEvento";
CREATE TRIGGER clube_termo_mesma_empresa BEFORE INSERT OR UPDATE ON "ConsentimentoEvento"
  FOR EACH ROW EXECUTE FUNCTION public.clube_termo_mesma_empresa();

-- =============================================================================
-- Isolamento (RLS). Mesmas regras de prisma/seguranca/01_rls_policies.sql (que as
-- recria de forma idempotente); aqui para as tabelas já nascerem protegidas.
-- =============================================================================

-- Funções de contexto: só são criadas se ainda não existirem. Em produção as duas
-- primeiras já existem (01_rls_policies.sql) e podem pertencer a outro papel; recriá-las
-- aqui falharia. Num banco novo (CI), elas nascem com o mesmo texto do 01.
DO $$
BEGIN
  IF to_regprocedure('public.app_empresa_id()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.app_empresa_id() RETURNS text
      LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
      AS $q$ SELECT nullif(current_setting('app.empresa_id', true), '') $q$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.app_empresa_id() FROM PUBLIC';
  END IF;
  IF to_regprocedure('public.app_escopo_sistema()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.app_escopo_sistema() RETURNS boolean
      LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
      AS $q$ SELECT coalesce(current_setting('app.escopo', true), '') = 'sistema' $q$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.app_escopo_sistema() FROM PUBLIC';
  END IF;
  -- Conta do consumidor autenticado (definida pelo servidor nas rotas /club, Fase 3).
  IF to_regprocedure('public.app_consumidor_id()') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.app_consumidor_id() RETURNS text
      LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
      AS $q$ SELECT nullif(current_setting('app.consumidor_id', true), '') $q$ $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.app_consumidor_id() FROM PUBLIC';
  END IF;
END $$;

-- Globais: só o escopo sistema ou a própria conta.
ALTER TABLE "ContaConsumidor" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_consumidor ON "ContaConsumidor";
CREATE POLICY nexus_consumidor ON "ContaConsumidor" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema() OR id = public.app_consumidor_id())
  WITH CHECK (public.app_escopo_sistema() OR id = public.app_consumidor_id());

ALTER TABLE "ConsumidorToken" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nexus_sistema ON "ConsumidorToken";
CREATE POLICY nexus_sistema ON "ConsumidorToken" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema()) WITH CHECK (public.app_escopo_sistema());

-- Por empresa: a regra padrão (empresa do contexto ou sistema).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ClubeConfig', 'MembroClube', 'TermoVersao', 'TermoAceite', 'ConsentimentoEvento', 'ConsentimentoAtual']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS nexus_tenant ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY nexus_tenant ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC
         USING ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())
         WITH CHECK ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())', t);
  END LOOP;
END $$;

-- O consumidor LÊ o que é dele (em qualquer clube); não escreve por estas regras.
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

-- Aceite dos termos da PLATAFORMA (cadastro): o próprio consumidor grava o seu.
DROP POLICY IF EXISTS nexus_consumidor_aceite ON "TermoAceite";
CREATE POLICY nexus_consumidor_aceite ON "TermoAceite" AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ("consumidorId" = public.app_consumidor_id() AND "empresaId" IS NULL);

-- Clube: o consumidor vê os ativos que são públicos ou dos quais participa.
DROP POLICY IF EXISTS nexus_consumidor_leitura ON "ClubeConfig";
CREATE POLICY nexus_consumidor_leitura ON "ClubeConfig" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (public.app_consumidor_id() IS NOT NULL AND "ativo" AND ("publico" OR EXISTS (
    SELECT 1 FROM public."MembroClube" m
    WHERE m."empresaId" = "ClubeConfig"."empresaId" AND m."consumidorId" = public.app_consumidor_id())));

-- Termos: os da plataforma são públicos; os de empresa, visíveis ao consumidor logado.
DROP POLICY IF EXISTS nexus_termo_leitura ON "TermoVersao";
CREATE POLICY nexus_termo_leitura ON "TermoVersao" AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ("empresaId" IS NULL OR public.app_consumidor_id() IS NOT NULL);

-- Revogação de sessão (logout): passa a valer também para a sessão do consumidor.
DROP POLICY IF EXISTS nexus_tenant ON "TokenRevogado";
CREATE POLICY nexus_tenant ON "TokenRevogado" FOR ALL TO PUBLIC
  USING (public.app_escopo_sistema() OR public.app_empresa_id() IS NOT NULL OR public.app_consumidor_id() IS NOT NULL)
  WITH CHECK (public.app_escopo_sistema() OR public.app_empresa_id() IS NOT NULL OR public.app_consumidor_id() IS NOT NULL);

-- Papel da aplicação (onde já existe; no CI ele é criado depois por 02_papeis.sql,
-- que repete estas mesmas linhas): acesso às funções e históricos sem alteração.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_consumidor_id() TO nexus_app;
    REVOKE UPDATE, DELETE ON "TermoAceite", "ConsentimentoEvento" FROM nexus_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_migrator') THEN
    GRANT EXECUTE ON FUNCTION public.app_consumidor_id() TO nexus_migrator;
  END IF;
END $$;

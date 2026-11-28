-- NEXUS CLUB, Fase 7: promoções do clube. SOMENTE ACRÉSCIMOS (2 tipos, 2 tabelas, travas e RLS).
-- Nada existente é alterado. Promoção sempre ligada a um Produto da mesma empresa.

-- CreateEnum
CREATE TYPE "TipoPromocao" AS ENUM ('TODOS', 'MEMBROS');

-- CreateEnum
CREATE TYPE "StatusPromocao" AS ENUM ('RASCUNHO', 'PUBLICADA', 'ENCERRADA', 'CANCELADA');

-- DropIndex

-- CreateTable
CREATE TABLE "Promocao" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" "TipoPromocao" NOT NULL DEFAULT 'MEMBROS',
    "titulo" TEXT,
    "descricao" TEXT,
    "precoPromocional" DECIMAL(12,2) NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "StatusPromocao" NOT NULL DEFAULT 'RASCUNHO',
    "limitePorCliente" INTEGER,
    "todasFiliais" BOOLEAN NOT NULL DEFAULT true,
    "criadoPorId" TEXT NOT NULL,
    "publicadoPorId" TEXT,
    "publicadaEm" TIMESTAMP(3),
    "encerradaEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promocao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromocaoFilial" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "promocaoId" TEXT NOT NULL,
    "filialId" TEXT NOT NULL,

    CONSTRAINT "PromocaoFilial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promocao_empresaId_status_fim_idx" ON "Promocao"("empresaId", "status", "fim");

-- CreateIndex
CREATE INDEX "Promocao_produtoId_idx" ON "Promocao"("produtoId");

-- CreateIndex
CREATE INDEX "PromocaoFilial_empresaId_idx" ON "PromocaoFilial"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "PromocaoFilial_promocaoId_filialId_key" ON "PromocaoFilial"("promocaoId", "filialId");

-- AddForeignKey
ALTER TABLE "Promocao" ADD CONSTRAINT "Promocao_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promocao" ADD CONSTRAINT "Promocao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoFilial" ADD CONSTRAINT "PromocaoFilial_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoFilial" ADD CONSTRAINT "PromocaoFilial_promocaoId_fkey" FOREIGN KEY ("promocaoId") REFERENCES "Promocao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromocaoFilial" ADD CONSTRAINT "PromocaoFilial_filialId_fkey" FOREIGN KEY ("filialId") REFERENCES "Filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Coerência entre empresas: produto e filiais da promoção são da MESMA empresa.
CREATE OR REPLACE FUNCTION public.clube_promocao_mesma_empresa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'Promocao' THEN
    IF NOT EXISTS (SELECT 1 FROM public."Produto" p WHERE p.id = NEW."produtoId" AND p."empresaId" = NEW."empresaId") THEN
      RAISE EXCEPTION 'Promocao: o produto % não pertence à empresa %', NEW."produtoId", NEW."empresaId" USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public."Filial" f WHERE f.id = NEW."filialId" AND f."empresaId" = NEW."empresaId")
       OR NOT EXISTS (SELECT 1 FROM public."Promocao" p WHERE p.id = NEW."promocaoId" AND p."empresaId" = NEW."empresaId") THEN
      RAISE EXCEPTION 'PromocaoFilial: filial ou promoção de outra empresa' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clube_promocao_mesma_empresa ON "Promocao";
CREATE TRIGGER clube_promocao_mesma_empresa BEFORE INSERT OR UPDATE OF "produtoId", "empresaId" ON "Promocao"
  FOR EACH ROW EXECUTE FUNCTION public.clube_promocao_mesma_empresa();
DROP TRIGGER IF EXISTS clube_promocao_mesma_empresa ON "PromocaoFilial";
CREATE TRIGGER clube_promocao_mesma_empresa BEFORE INSERT OR UPDATE ON "PromocaoFilial"
  FOR EACH ROW EXECUTE FUNCTION public.clube_promocao_mesma_empresa();

-- Isolamento (RLS): regra padrão por empresa, já na criação (01_rls_policies.sql recria igual).
-- O consumidor não lê estas tabelas direto: a vitrine é montada pelo servidor depois de conferir a carteirinha.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Promocao', 'PromocaoFilial']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS nexus_tenant ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY nexus_tenant ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC
         USING ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())
         WITH CHECK ("empresaId" = public.app_empresa_id() OR public.app_escopo_sistema())', t);
  END LOOP;
END $$;

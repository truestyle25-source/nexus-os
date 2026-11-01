-- ===========================================================================
-- NEXUS OS — FASE 1 (migrations): paridade final schema.prisma <-> cadeia
--
-- Último elo da cadeia. Alinha o replay das migrations ao schema.prisma
-- (fonte da verdade) nos pontos que a cadeia histórica não cobriu.
-- Todos os passos são idempotentes/protetidos por guards, seguros em:
--   (a) banco novo      → baseline + cadeia + este arquivo (replay completo);
--   (b) banco existente → já em paridade: guards viram no-ops;
--   (c) histórico antigo (cadeia já aplicada, baseline via
--       `migrate resolve`) → cada passo só age do lado que falta.
-- ===========================================================================

-- 1) Valores de enum que a cadeia nunca adicionou ---------------------------
-- A cadeia criou os enums incompletos no pdv_caixa; os valores do PDV Pro
-- (ex.: DIVERGENCIA) só existiam no banco real via `db push`. Sem isto,
-- um banco novo rejeitaria inserts do fluxo de divergência do caixa.
ALTER TYPE "StatusCaixa" ADD VALUE IF NOT EXISTS 'BLOQUEADO';
ALTER TYPE "StatusCaixa" ADD VALUE IF NOT EXISTS 'EM_FECHAMENTO';
ALTER TYPE "StatusCaixa" ADD VALUE IF NOT EXISTS 'DIVERGENCIA';

ALTER TYPE "TipoMovimentoCaixa" ADD VALUE IF NOT EXISTS 'VENDA';
ALTER TYPE "TipoMovimentoCaixa" ADD VALUE IF NOT EXISTS 'ESTORNO';
ALTER TYPE "TipoMovimentoCaixa" ADD VALUE IF NOT EXISTS 'DEVOLUCAO';
ALTER TYPE "TipoMovimentoCaixa" ADD VALUE IF NOT EXISTS 'AJUSTE';
ALTER TYPE "TipoMovimentoCaixa" ADD VALUE IF NOT EXISTS 'FECHAMENTO';

-- 2) FKs de tabelas-base que a cadeia nunca criou ---------------------------
-- O baseline omitiu as FKs de propósito (compatibilidade com bancos
-- históricos); este bloco as cria com guarda de existência. As ações
-- replicam exatamente o que o schema.prisma declara.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('Filial',              'Filial_empresaId_fkey',              'empresaId',      'Empresa',      'RESTRICT'),
      ('Setor',               'Setor_empresaId_fkey',               'empresaId',      'Empresa',      'RESTRICT'),
      ('Setor',               'Setor_filialId_fkey',                'filialId',       'Filial',       'SET NULL'),
      ('Usuario',             'Usuario_empresaId_fkey',             'empresaId',      'Empresa',      'RESTRICT'),
      ('Usuario',             'Usuario_filialId_fkey',              'filialId',       'Filial',       'SET NULL'),
      ('Usuario',             'Usuario_setorId_fkey',               'setorId',        'Setor',        'SET NULL'),
      ('Permissao',           'Permissao_usuarioId_fkey',           'usuarioId',      'Usuario',      'CASCADE'),
      ('Auditoria',           'Auditoria_usuarioId_fkey',           'usuarioId',      'Usuario',      'SET NULL'),
      ('Produto',             'Produto_empresaId_fkey',             'empresaId',      'Empresa',      'RESTRICT'),
      ('Produto',             'Produto_categoriaId_fkey',           'categoriaId',    'Categoria',    'SET NULL'),
      ('Produto',             'Produto_fornecedorId_fkey',          'fornecedorId',   'Fornecedor',   'SET NULL'),
      ('Estoque',             'Estoque_produtoId_fkey',             'produtoId',      'Produto',      'RESTRICT'),
      ('Estoque',             'Estoque_filialId_fkey',              'filialId',       'Filial',       'RESTRICT'),
      ('EstoqueMovimentacao', 'EstoqueMovimentacao_produtoId_fkey', 'produtoId',      'Produto',      'RESTRICT'),
      ('EstoqueMovimentacao', 'EstoqueMovimentacao_usuarioId_fkey', 'usuarioId',      'Usuario',      'SET NULL'),
      ('Fornecedor',          'Fornecedor_empresaId_fkey',          'empresaId',      'Empresa',      'RESTRICT'),
      ('Compra',              'Compra_fornecedorId_fkey',           'fornecedorId',   'Fornecedor',   'RESTRICT'),
      ('CompraItem',          'CompraItem_compraId_fkey',           'compraId',       'Compra',       'CASCADE'),
      ('CompraItem',          'CompraItem_produtoId_fkey',          'produtoId',      'Produto',      'RESTRICT'),
      ('Cliente',             'Cliente_empresaId_fkey',             'empresaId',      'Empresa',      'RESTRICT'),
      ('Venda',               'Venda_clienteId_fkey',               'clienteId',      'Cliente',      'SET NULL'),
      ('VendaItem',           'VendaItem_vendaId_fkey',             'vendaId',        'Venda',        'CASCADE'),
      ('Cargo',               'Cargo_departamentoId_fkey',          'departamentoId', 'Departamento', 'SET NULL'),
      ('Funcionario',         'Funcionario_departamentoId_fkey',    'departamentoId', 'Departamento', 'SET NULL'),
      ('Funcionario',         'Funcionario_cargoId_fkey',           'cargoId',        'Cargo',        'SET NULL'),
      ('Advertencia',         'Advertencia_funcionarioId_fkey',     'funcionarioId',  'Funcionario',  'RESTRICT'),
      ('Ferias',              'Ferias_funcionarioId_fkey',          'funcionarioId',  'Funcionario',  'RESTRICT'),
      ('Ponto',               'Ponto_funcionarioId_fkey',           'funcionarioId',  'Funcionario',  'RESTRICT'),
      ('Assinatura',          'Assinatura_empresaId_fkey',          'empresaId',      'Empresa',      'CASCADE'),
      ('Pagamento',           'Pagamento_assinaturaId_fkey',        'assinaturaId',   'Assinatura',   'CASCADE')
    ) AS t(tbl, con, col, ref, del)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      WHERE c.conname = fk.con
        AND r.relname = fk.tbl
        AND r.relnamespace = 'public'::regnamespace
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I ("id") ON DELETE %s ON UPDATE CASCADE',
        fk.tbl, fk.con, fk.col, fk.ref, fk.del
      );
    END IF;
  END LOOP;
END $$;

-- 2b) FKs com ações divergentes do schema -----------------------------------
-- A cadeia criou com ON DELETE CASCADE; o schema exige RESTRICT.
-- Substitui apenas quando os atributos diferem (no-op se já correto).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AvaliacaoComportamental_funcionarioId_fkey'
      AND conrelid = '"AvaliacaoComportamental"'::regclass
      AND (confdeltype <> 'r' OR confupdtype <> 'c')
  ) THEN
    ALTER TABLE "AvaliacaoComportamental" DROP CONSTRAINT "AvaliacaoComportamental_funcionarioId_fkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AvaliacaoComportamental_funcionarioId_fkey'
      AND conrelid = '"AvaliacaoComportamental"'::regclass
  ) THEN
    ALTER TABLE "AvaliacaoComportamental"
      ADD CONSTRAINT "AvaliacaoComportamental_funcionarioId_fkey"
      FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PesquisaBemEstar_funcionarioId_fkey'
      AND conrelid = '"PesquisaBemEstar"'::regclass
      AND (confdeltype <> 'r' OR confupdtype <> 'c')
  ) THEN
    ALTER TABLE "PesquisaBemEstar" DROP CONSTRAINT "PesquisaBemEstar_funcionarioId_fkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PesquisaBemEstar_funcionarioId_fkey'
      AND conrelid = '"PesquisaBemEstar"'::regclass
  ) THEN
    ALTER TABLE "PesquisaBemEstar"
      ADD CONSTRAINT "PesquisaBemEstar_funcionarioId_fkey"
      FOREIGN KEY ("funcionarioId") REFERENCES "Funcionario"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) FKs criadas pela cadeia sem correspondência no schema ------------------
-- Nem `model Caixa` nem `model ChaveApi` declaram relação com Empresa (só a
-- coluna escalar); o db push também as removeria — alinhamento à fonte da
-- verdade. Guardadas para bancos que já não as tenham.
ALTER TABLE "Caixa" DROP CONSTRAINT IF EXISTS "Caixa_empresaId_fkey";
ALTER TABLE "ChaveApi" DROP CONSTRAINT IF EXISTS "ChaveApi_empresaId_fkey";

-- 4) Índices ----------------------------------------------------------------
-- Criado pela cadeia, ausente no schema.
DROP INDEX IF EXISTS "MovimentacaoCaixa_vendaId_idx";

-- O nome original (64 bytes: ...dataRegistro_idx) foi truncado pelo Postgres
-- para 63 (...dataRegistro_id); o schema espera o nome canônico do Prisma.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM pg_class
        WHERE relkind = 'i'
          AND relname = 'ParticipanteTreinamento_empresaId_funcionarioId_dataRegistro_id'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class
        WHERE relkind = 'i'
          AND relname = 'ParticipanteTreinamento_empresaId_funcionarioId_dataRegistr_idx'
      ) THEN
    ALTER INDEX "ParticipanteTreinamento_empresaId_funcionarioId_dataRegistro_id"
      RENAME TO "ParticipanteTreinamento_empresaId_funcionarioId_dataRegistr_idx";
  END IF;
END $$;

-- 5) Atributos de coluna divergentes ---------------------------------------
-- Empresa.fusoHorario: a cadeia criou a coluna sem DEFAULT (schema tem).
ALTER TABLE "Empresa" ALTER COLUMN "fusoHorario" SET DEFAULT 'America/Sao_Paulo';
-- Filial.fusoHorario: a cadeia criou NOT NULL; o schema permite nulo.
ALTER TABLE "Filial" ALTER COLUMN "fusoHorario" DROP NOT NULL;
-- VendaItem.custoUnitario: a cadeia (integrity_security) setou DEFAULT 0;
-- o schema não declara default (NOT NULL permanece).
ALTER TABLE "VendaItem" ALTER COLUMN "custoUnitario" DROP DEFAULT;

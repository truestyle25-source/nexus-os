-- ============================================================================
-- Correção da sincronização banco <-> schema.
--
-- ERRO DA MIGRAÇÃO ANTERIOR: ela removeu `MovimentacaoCaixa.origem` achando
-- que a coluna era órfã, porque o primeiro `migrate diff` sugeriu o DROP. Era
-- engano do diff naquele momento: o schema DECLARA `origem Origem
-- @default(MANUAL)`. A coluna foi removida e é restaurada aqui, com o mesmo
-- tipo e default, para que a movimentação de caixa volte a registrar a
-- origem da operação. A tabela estava vazia, então nada foi perdido.
--
-- Também falta `Funcionario.dataNascimento`, exigido pelo schema e pela tela
-- de Cadastro do RH.
-- ============================================================================

ALTER TABLE "MovimentacaoCaixa" ADD COLUMN     "origem" "Origem" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "Funcionario" ADD COLUMN     "dataNascimento" TIMESTAMP(3);

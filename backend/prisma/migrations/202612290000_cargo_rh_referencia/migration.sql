-- Cargo do RH aponta para um cargo de referência do sistema (acessos do login).
-- Coluna nova e opcional: não altera nenhum dado existente.
ALTER TABLE "Cargo" ADD COLUMN IF NOT EXISTS "cargoReferencia" TEXT;

-- ===========================================================================
--  Benefícios do funcionário: vale-alimentação e vale-refeição
--
--  Escrita à mão, e não pelo `prisma migrate diff`, para registrar o porquê.
--
--  O que mudou
--  ----------
--  O cadastro não tinha onde registrar benefício nenhum. Em folha de pagamento,
--  um benefício inventado é desconto ou crédito errado na conta de alguém, então
--  a decisão aqui é explícita:
--
--   • `valeAlimentacao` e `valeRefeicao` são INDEPENDENTES. O funcionário pode
--     não receber nenhum, receber só um, ou receber os dois.
--   • Cada um tem o seu próprio valor mensal e o seu próprio toggle. Não existe
--     um "benefícios" único com um valor, porque VA e VR têm naturezas e
--     convenções diferentes e são contratados separadamente.
--   • `DEFAULT false` / `DEFAULT 0` e não `NULL`: "não recebe" é uma resposta
--     válida e precisa ser distinguível de "ainda não informado". Com `NULL` a
--     folha teria de adivinhar, e adivinhar benefício é exatamente o que não
--     se deve fazer.
--
--  Não há valor computado aqui: quem aplica é `lib/folha.ts`, que lê estes
--  campos e gera a rubrica. A coluna guarda a configuração, não o cálculo.
-- ===========================================================================

-- AddColumn
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "valeAlimentacao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "valeRefeicao" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "valorValeAlimentacao" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Funcionario" ADD COLUMN IF NOT EXISTS "valorValeRefeicao" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Seção 14 PDV — Venda.parcelas
--
-- O PDV oferece de 1x a 6x no cartão de crédito e o cupom impresso mostrava
-- "3x", mas esse número não existia em lugar nenhum: o comprovante que ficava
-- com o cliente afirmava um parcelamento que o sistema não conhecia, e não
-- havia como conferir depois o que foi realmente combinado.
--
-- NÃO cria N recebimentos no financeiro: a receita continua sendo UMA linha
-- pelo total. Isto registra a condição de pagamento da venda, não o fluxo de
-- cobrança (que exigiria um modelo de contas a receber — fora do escopo aqui).
--
-- Escrita à mão pelo mesmo motivo documentado em DEBITO-TECNICO.md (itens 3 e 6):
-- sem banco/rede neste ambiente para gerar via `prisma migrate dev`. Rodar
-- `npx prisma migrate diff` contra o schema.prisma antes de aplicar, como nos
-- demais migrations escritos à mão deste projeto.

-- DEFAULT 1 = à vista. Vendas já existentes passam a 1, que é o que uma venda
-- significa quando nenhum parcelamento foi informado.
ALTER TABLE "Venda" ADD COLUMN "parcelas" INTEGER NOT NULL DEFAULT 1;
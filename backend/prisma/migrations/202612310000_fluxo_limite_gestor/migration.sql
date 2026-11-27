-- Fluxo de Caixa: limite (R$) acima do qual a divergência exige o gestor. Padrão = valor que era fixo no código.
ALTER TABLE "Empresa" ADD COLUMN "limiteAprovacaoGestorCaixa" DECIMAL(12,2) NOT NULL DEFAULT 50;

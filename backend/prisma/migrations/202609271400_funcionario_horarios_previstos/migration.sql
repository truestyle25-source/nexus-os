-- Horários previstos da jornada do funcionário, SEPARADOS.
--
-- `Funcionario.jornada` continua existindo como texto livre ("08:00-17:00"): não
-- foi removida, renomeada nem reorganizada. Estes dois campos são a referência
-- que o Ponto e o Espelho conseguem comparar com a batida real.
--
-- TEXT e não TIME: horário não tem fuso, e tipos de data/hora no Postgres já
-- causaram três bugs de deslocamento neste projeto. `HH:MM` é texto puro —
-- ordena, subtrai e não muda ao viajar entre servidor, banco e navegador.
ALTER TABLE "Funcionario" ADD COLUMN     "horarioEntradaPrevisto" TEXT,
ADD COLUMN     "horarioSaidaPrevisto" TEXT;
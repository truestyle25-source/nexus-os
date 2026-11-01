-- ===========================================================================
--  Fuso horário da empresa
--
--  O registro de ponto é carimbado com o instante real, mas o DIA a que a
--  marcação pertence depende do fuso: às 23h30 em Brasília a marcação é do dia
--  27, e no fuso de UTC seria do dia 28. Sem um fuso por empresa, o servidor
--  usaria o fuso da máquina — que em deploy pode ser UTC — e a batida da noite
--  cairia no dia errado.
--
--  `America/Sao_Paulo` como padrão porque é o fuso do Brasil e o caso real do
--  produto. O campo é texto (nome IANA) e não um deslocamento fixo porque o
--  Brasil deixou de usar horário de verão; o nome continua correto.
--
--  A coluna é nullable no banco (ALTER TABLE ... DEFAULT) para não travar uma
--  base já populada; o código trata `null` como o padrão.
-- ===========================================================================

ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "fusoHorario" TEXT;
UPDATE "Empresa" SET "fusoHorario" = 'America/Sao_Paulo' WHERE "fusoHorario" IS NULL;

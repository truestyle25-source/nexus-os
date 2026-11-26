-- Ponto "só o próprio" e Metas "só as suas / da equipe" para quem já tem cargo.
-- Só mexe em usuários com cargo OPERADOR ou SUPERVISOR. Idempotente.
INSERT INTO "Permissao" ("id", "usuarioId", "modulo", "acao", "permitido", "origem", "createdAt")
SELECT gen_random_uuid()::text, u."id", v.modulo, v.acao, true, 'MANUAL', CURRENT_TIMESTAMP
FROM "Usuario" u
JOIN (VALUES
  ('OPERADOR', 'ponto', 'proprio'),
  ('OPERADOR', 'metas', 'proprio'),
  ('SUPERVISOR', 'ponto', 'proprio'),
  ('SUPERVISOR', 'metas', 'equipe')
) AS v(cargo, modulo, acao) ON v.cargo = u."cargo"
ON CONFLICT ("usuarioId", "modulo", "acao") DO NOTHING;

-- Supervisor deixa de ver as metas de TODA a empresa: passa a ver só a equipe.
DELETE FROM "Permissao" p
USING "Usuario" u
WHERE p."usuarioId" = u."id" AND u."cargo" = 'SUPERVISOR' AND p."modulo" = 'metas' AND p."acao" = 'visualizar';

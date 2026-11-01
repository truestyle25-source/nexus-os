BEGIN;
INSERT INTO "Empresa" (id, nome, "createdAt", "updatedAt")
VALUES ('pdv-audit-test-empresa', 'Empresa isolada testes PDV', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Filial" (id, "empresaId", nome, status, "fusoHorario", "createdAt", "updatedAt")
VALUES ('pdv-audit-test-filial', 'pdv-audit-test-empresa', 'Filial isolada testes PDV', 'ATIVO', 'America/Sao_Paulo', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Usuario" (id, "empresaId", "filialId", nome, email, "senhaHash", status, "createdAt", "updatedAt")
VALUES ('pdv-audit-test-operador', 'pdv-audit-test-empresa', 'pdv-audit-test-filial', 'Operador isolado testes PDV', 'pdv-audit-test-operador@nexus.test', 'fixture-isolada-nao-usada', 'ATIVO', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Permissao" (id, "usuarioId", modulo, acao, permitido, "createdAt")
SELECT gen_random_uuid()::text, 'pdv-audit-test-operador', m.modulo, m.acao, true, NOW()
FROM (VALUES ('pdv','visualizar'),('pdv','criar'),('pdv','editar'),('vendas','visualizar'),('vendas','criar')) AS m(modulo, acao)
WHERE NOT EXISTS (
  SELECT 1 FROM "Permissao" p
  WHERE p."usuarioId"='pdv-audit-test-operador' AND p.modulo=m.modulo AND p.acao=m.acao
);

COMMIT;

SELECT (SELECT COUNT(*) FROM "Empresa" WHERE id='pdv-audit-test-empresa') AS empresa,
       (SELECT COUNT(*) FROM "Filial" WHERE id='pdv-audit-test-filial') AS filial,
       (SELECT COUNT(*) FROM "Usuario" WHERE id='pdv-audit-test-operador') AS operador,
       (SELECT COUNT(*) FROM "Permissao" WHERE "usuarioId"='pdv-audit-test-operador') AS permissoes;

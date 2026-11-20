# Drift entre `schema.prisma`, migrações e produção — 2026-11-20

## Diagnóstico (medido, não presumido)
| Comparação | Diferenças | Como foi medido |
|---|---|---|
| Migrações (49) → produção | **0** | `prisma migrate diff --from-migrations … --to-url <cópia da estrutura de produção>` |
| Produção → `schema.prisma` | **17 comandos** | `prisma migrate diff --from-url <cópia> --to-schema-datamodel prisma/schema.prisma` |

Conclusão: a produção está exatamente no estado das migrações; o **`schema.prisma` foi editado sem gerar migração**.
A cópia da produção é estrutural (`pg_dump --schema-only`), feita em 2026-11-20.

## Divergências
| Tipo | Objeto | Divergência | Risco se aplicado com o diff automático |
|---|---|---|---|
| Enum | `DimensaoTipo`, `TipoProdutoEnum` | existem no schema, não no banco | nenhum |
| Coluna | `ConsumoInterno.origem` | banco `text`, schema enum `Origem` | **perda de dados** (DROP + ADD) |
| Coluna | `TipoProduto.codigo` | banco `text`, schema enum `TipoProdutoEnum` | **perda de dados** (DROP + ADD) |
| Tipo | `Estoque.valorTotal`, `EstoqueSnapshotDiario.valorTotal`, `ProducaoKit.custoTotal` | precisão diferente → `DECIMAL(14,2)` | arredondamento para 2 casas |
| Default | `ProducaoKit.quantidadeProduzida` | banco tem default, schema não | nenhum |
| Tabela | `NexusErpRecord` (+3 índices) | só no schema (usada pelo módulo `enterprise-pack`, **não registrado** no servidor) | nenhum; precisa de RLS |
| Índice | `TipoProduto_empresaId_codigo_key` | já existe; o diff o recria só por causa do DROP COLUMN | erro "already exists" |
| **FK** | `Dimensao`, `Unidade`, `TipoProduto`, `FatorConversao` → `Empresa` | **faltam as chaves estrangeiras de `empresaId`** | nenhum; **integridade multiempresa** hoje depende só da aplicação |
| FK | `NexusErpRecord.empresaId` | tabela nova | nenhum |

Linhas afetadas na produção em 2026-11-20 (consulta de leitura): `ConsumoInterno` 0, `TipoProduto` 0, `Estoque` 0, `ProducaoKit` 0.

## Correção preparada (não aplicada)
`backend/prisma/migrations/202611200900_sincroniza_schema_drift/migration.sql`
- converte `text → enum` **no lugar** (`ALTER COLUMN … TYPE … USING`), sem DROP COLUMN;
- `CREATE UNIQUE INDEX IF NOT EXISTS` para o índice já existente;
- adiciona as FKs de `empresaId` que faltavam.

Validação numa cópia nova da estrutura de produção (staging, Postgres 17):
- migração em transação única: **exit 0**;
- `01_rls_policies.sql` em seguida: **exit 0**, RLS em **85 de 86** tabelas (`NexusErpRecord` coberta; só `_prisma_migrations` fora);
- diferenças restantes banco → `schema.prisma`: **0**.

## Procedimento de aplicação (depende de autorização)
1. Backup (`npm run backup` com `DIRECT_URL`).
2. `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy` (papel `nexus_migrator`).
3. `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f backend/prisma/seguranca/01_rls_policies.sql`.
4. Conferir: `prisma migrate status` = "up to date"; RLS 85/86.
Rollback: restaurar o backup (a migração só adiciona/converte; tabelas afetadas estão vazias).

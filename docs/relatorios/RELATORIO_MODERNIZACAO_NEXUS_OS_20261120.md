# Relatório — Modernização e implantação segura do NEXUS OS (2026-11-20)

> Nenhuma operação proibida foi executada: **sem merge, sem deploy, sem alteração de variáveis no provedor,
> sem troca de senha, sem `--aplicar`, sem migração em produção, sem exclusão de backup ou de credenciais.**
> Na produção, só consultas de leitura. Segredos não aparecem neste documento.

## 1. Resumo executivo
- **PR #2 + #3 compatíveis**: nenhum arquivo em comum; a combinação passa em tudo no Node 20.
- **4 bugs reais e pré-existentes** encontrados e corrigidos, 2 deles graves: o recebimento de compra **dobrava o estoque** e, com cliques simultâneos, **duplicava lançamentos financeiros**.
- **Todos os testes antigos que falhavam foram resolvidos** (causa de cada um identificada; nenhuma regra de negócio alterada para "fazer passar").
- **Drift do schema** medido e com migração segura preparada (não aplicada).
- **CI no GitHub** criado e funcionando (PR #5), e ele próprio revelou 2 testes estruturalmente quebrados.
- **Incidente da senha**: a senha de produção está em 14 arquivos de históricos de assistentes de IA → **troca obrigatória**.

## 2. Auditoria
| Área | Achado | Evidência |
|---|---|---|
| Git | Checkout limpo (só uma auditoria `.md` alterada pelo usuário, preservada) | `git status` |
| PRs | #2 e #3 abertos e mesclavéis, ambos a partir de `9329dfb`, 0 arquivos em comum | `gh pr view`, `comm` |
| Produção (leitura) | RLS 84/85 (fora: `_prisma_migrations`), 84 policies, 0 FORCE, dono `nexus_migrator` | consulta em `pg_class`/`pg_policies` |
| Produção (leitura) | `nexus_app`: super=false, bypassrls=false, createrole=false, createdb=false, limite 20, timeouts 15 s/30 s, sem DDL, sem `_prisma_migrations` | `pg_roles`, `has_*_privilege` |
| Produção (leitura) | `anon`/`authenticated` sem USAGE em `public` | `has_schema_privilege` |
| Produção (leitura) | Conexões ativas: só `postgres` (2); nenhuma do `nexus_app` → **proteção ainda inativa** | `pg_stat_activity` |
| Produção (leitura) | 0 credenciais cifradas → **recifragem sem trabalho pendente** | contagem nas 4 tabelas |
| Schema | Produção = 49 migrações (diff 0); `schema.prisma` 17 mudanças à frente; faltam FKs de `empresaId` em 4 tabelas | `prisma migrate diff` |
| Segurança | `X-Forwarded-For` forjado **não** burla o bloqueio de login por conta (limite por e-mail); limite por IP e de cadastro são burláveis (`trustProxy: true`) | teste HTTP real |
| Credenciais | Senha de produção em `backend/.env`, 14 arquivos de histórico (Copilot, Cline, VS Code) e commit `aa0bd44` (refs locais do Cline, 0 no GitHub) | busca pelo valor, só nomes de arquivo |
| Runtime | Node 20 (Dockerfile e CI) está **fora de suporte** desde abr/2026 | — |

## 3. Correções (arquivos alterados e motivo)
| PR | Arquivo | Motivo |
|---|---|---|
| #4 | `backend/src/modules/compras/compras.routes.ts` | (a) saldo lido **depois** de `aplicarMovimento` e somado de novo → estoque **dobrado** e custo médio errado; (b) sem trava, recebimentos simultâneos geravam **N lançamentos financeiros** e N movimentações; duas compras do mesmo produto perdiam atualização. Agora o saldo é lido antes e há `SELECT … FOR UPDATE` |
| #4 | `backend/src/modules/rh/inventario.routes.ts` | `Decimal` comparado como texto (`"9" > "27"`) e nunca `===` → **BATEU nunca aparecia** e SOBROU/FALTOU invertia |
| #4 | `backend/tests/compras-aba.test.ts` | fixture com id de empresa fixo e `dimensaoId: null` |
| #4 | `backend/tests/estoque-aba.test.ts` | comparava `Decimal` com `===`; a checagem de divergência aceitava qualquer valor |
| #4 | `backend/tests/mercadolivre-consulta.test.ts` | forjava `empresaId` no token; agora prova que o forjado é **ignorado** |
| #4 | `backend/tests/clientes-aba.test.ts` | documento derivado colidia com o CNPJ 1 vez em 10 |
| #4 | `backend/tests/concorrencia-operacoes.test.ts` (novo) | concorrência de compras/vendas/caixa; **falha sem as travas** |
| #4 | `backend/prisma/migrations/202611200900_sincroniza_schema_drift/` (novo) | alinha banco ao schema sem `DROP COLUMN`; **não aplicada** |
| #4 | `docs/DRIFT_SCHEMA_PRISMA.md`, `docs/PROJETOS_TECNICOS_SAAS.md` | relatório de drift e projetos das Fases 11–13 |
| #5 | `.github/workflows/ci.yml` (novo) | CI de backend, frontend, RLS e segredos |
| #5 | `frontend/tests/mercadolivre-dados.test.ts`, `backend/tests/folha.test.ts` | `});` fora do lugar aninhava 9 e 7 testes; o Node 20/22 os cancelava |

## 4. Testes (resultados verificáveis)
| Execução | Ambiente | Total | Aprovados | Falhas | Cancelados | Pulados |
|---|---|---|---|---|---|---|
| Linha de base `main` | CI GitHub, Node 20 | 352 | 333 | 9 | 0 | 10 |
| PR #2 sozinho (ontem) | local, `nexus_app` | 393 | 380 | 3 | 0 | 10 |
| **#2+#3+#4+#5 combinados** | local, Node 20, `postgres` | 387 | **376** | **0** | 0 | 11 |
| **#2+#3+#4+#5 combinados** | local, Node 20, `nexus_app` + RLS | 396 | **386** | **0** | 0 | 10 |
| Frontend combinados | local, Node 20 | 64 | **64** | 0 | 0 | 0 |
| Frontend `main` (após #5) | CI GitHub, Node 20 | 64 | 64 | 0 | 0 | 0 |
| E2E servidor real (Fastify 5 + RLS) | local | 25 | **25** | 0 | — | — |
| Concorrência servidor real | local, 5 empresas, 125 vendas simultâneas | 8 | **8** | 0 | — | — |
| `concorrencia-operacoes` sem a correção | local | 4 | 2 | **2** | — | — |
| Builds e `tsc` (backend + frontend) | local, combinados | — | OK | 0 erros | — | — |
| Migração de drift numa cópia da produção | staging Postgres 17 | — | exit 0 | diff restante 0 | — | — |

Falhas observadas e não escondidas: 3 quedas momentâneas do Postgres Docker local ("Can't reach database") em rodadas anteriores (os testes passaram ao repetir) e 1 travamento do `mod07-mutacao` (457 s, passou 3/3 ao repetir). Na rodada final: 0 quedas.

## 5. Segurança — isolamento
- HTTP, A→B e B→A, em produtos, clientes, fornecedores, funcionários, financeiro e metas (ler, listar, editar, excluir, vender com dados da outra): 14/14 nos dois modos.
- Banco: sem contexto = 0 linhas; WITH CHECK bloqueia escrita cruzada; SQL cru respeita o RLS; 10/10 na produção (transação desfeita).
- Pool com 1 conexão: contexto limpo após operação, rollback e entre requisições; A/B intercaladas não se misturam.
- `empresaId` forjado no JWT é ignorado (vale o do banco): teste novo no `mercadolivre-consulta`.
- Usuário sem permissão: 403 e a operação não acontece.

## 6. PR #2
Aberto, mesclável. Pendência: só o merge (sua autorização).

## 7. PR #3
Aberto, mesclável, **compatível com o #2** (comentário com as evidências no PR). Atualizar a branch depois do merge do #2.

## 8. Banco de dados
Produção protegida estruturalmente (RLS, papéis, posse), mas **o backend ainda conecta como `postgres`** (BYPASSRLS).
Migração de drift preparada no #4, não aplicada.

## 9. Produção
Aplicação publicada inalterada. Nenhum deploy feito.

## 10. Vulnerabilidades (`npm audit --omit=dev`)
| | Crítica | Alta | Moderada |
|---|---|---|---|
| Backend antes | 2 | 3 | 4 |
| Backend com #3 | **0** | **0** | 2 (`exceljs`/`uuid`) |
| Frontend antes | 1 | 5 | 0 |
| Frontend com #3 | **1** | 2 | 0 |
As críticas que restam no frontend (`next` 14.2.35) só são corrigidas no **Next 15.5.29+**; várias afetam Image Optimizer e Server Actions.

## 11. Riscos
| Risco | Gravidade | Situação |
|---|---|---|
| Senha do `postgres` em históricos de assistentes de IA (Copilot/Cline/VS Code) | **Alta** | Troca obrigatória (sua) |
| Backend ainda como `postgres` | **Alta** | Depende do deploy + troca da `DATABASE_URL` |
| Next 14 com falhas críticas | Alta | Migração para Next 15.5.29+ (projeto separado) |
| Node 20 fora de suporte (Dockerfile, CI) | Média | Atualizar para Node 22 LTS (testes já passam no 22) |
| Limite por IP/cadastro burlável via `X-Forwarded-For` | Média-baixa | Ajustar `trustProxy` ao número real de proxies (precisa da topologia) |
| FKs de `empresaId` faltando em 4 tabelas | Média | Migração pronta no #4 |
| Agendadores dentro do processo | Média | Duplicam com mais de 1 instância |

## 12. Pendências
Cookie HttpOnly (bloqueado: domínio da API de produção), RLS por filial (decisões de negócio), migração Next 15, Node 22, `trustProxy`, aplicação da migração de drift.

## 13. Autorizações (o que depende de você)
Ordem recomendada: **#2 → #4 → #3 → #5**. Cada item lista o que é, o sistema afetado, o risco, o backup e o rollback.

| # | Ação | Sistema | Risco | Backup | Rollback | Resultado esperado |
|---|---|---|---|---|---|---|
| 1 | Merge do PR #2 | GitHub `main` | baixo (sem efeito até o deploy) | Git | revert do merge | `main` com RLS no código |
| 2 | Merge do PR #4 | GitHub `main` | baixo | Git | revert | bugs de estoque/financeiro corrigidos no código |
| 3 | Atualizar #3 com a `main` → CI verde → merge | GitHub | médio (Fastify 5) | Git | revert | dependências corrigidas |
| 4 | Merge do PR #5 | GitHub | nenhum | Git | revert | CI em todo PR |
| 5 | Deploy do backend + `CREDENTIALS_ENCRYPTION_KEY` (impressão sha256 `2e2856d3`) + `PRISMA_CONNECTION_LIMIT=10` | Render/Vercel | baixo (continua `postgres`) | dump de 2026-11-20 | redeploy anterior | sistema igual, código novo |
| 6 | Trocar `DATABASE_URL` → `nexus_app` e adicionar `DIRECT_URL` | Provedor | médio | dump | voltar a URL (≈1 min) — **desativa a proteção** | **RLS ativo de fato** |
| 7 | Aplicar migração de drift (`migrate deploy` + `01_rls_policies.sql`) | Supabase | baixo (tabelas vazias) | novo backup antes | restaurar backup | diff 0, RLS 85/86 |
| 8 | Trocar a senha do `postgres` e limpar os históricos de IA | Supabase, máquina local | baixo | — | — | incidente encerrado |

## 14. Próxima etapa
**Sua decisão: merge do PR #2.** Assim que ele entrar, eu atualizo o #4 (a base muda para `main`) e o #3, e confirmo os dois no CI.

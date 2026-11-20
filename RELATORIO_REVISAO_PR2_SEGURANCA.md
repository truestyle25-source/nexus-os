# Revisão técnica final — PR #2 (segurança multiempresa) — 2026-11-20

> Nada de risco foi executado: **sem merge, sem deploy, sem troca de variáveis no provedor, sem `--aplicar`,
> sem troca de senha, sem exclusão de backup/credenciais, sem migração**. Na produção, só leituras.

## 1. O que foi auditado
- Relatório (`RELATORIO_EXECUCAO_SEGURANCA_NEXUS_OS.md`) e runbook (`docs/SEGURANCA_RLS_RUNBOOK.md`).
- O diff completo do PR (35 arquivos, 8 commits), incluindo a busca de segredos: **0** senhas, chaves, ref do projeto, backup ou arquivo de credenciais.
- Clientes Prisma: existia um segundo `PrismaClient` sem contexto em `src/config/prisma.ts` (não importado, mas era uma porta aberta). Agora há **um único** cliente na aplicação.
- Todos os usos de escopo `sistema` (18 pontos, cada um com motivo): só rotas públicas, rate limit, API pública, callbacks/webhooks, agendadores, checagens de unicidade global e scripts.
- SQL cru: os 2 `$queryRawUnsafe` e todos os `Prisma.sql` são parametrizados, então não há injeção que permita chamar `set_config` e escapar do RLS.
- Caminhos para escapar do RLS: só papéis com BYPASSRLS (`postgres`, `service_role`) ou o dono das tabelas (`nexus_migrator`). A aplicação passa a usar `nexus_app` (sem BYPASSRLS, sem DDL). `anon`/`authenticated` não têm acesso ao schema `public`.
- As 47 atualizações/exclusões por `id` sem `empresaId` no `where`: seguem o padrão "confere dono → altera" e agora também são barradas pelo RLS (comprovado nos testes HTTP).
- Autenticação/autorização: o `empresaId` vem sempre do banco (nunca do cliente); as permissões continuam no banco; tokens revogados continuam bloqueados.
- Scripts de linha de comando, backup/restauração, agendadores (herança do contexto pelos timers).
- Dependências (`npm audit`), variáveis de ambiente, compatibilidade com o Supabase.

## 2. O que foi corrigido nesta revisão
| # | Problema | Evidência | Correção |
|---|---|---|---|
| 1 | `npm run estoque:snapshot` como `nexus_app` processava **0 empresas, sem erro** | Antes: "0 empresas"; depois: "156 empresas, 98 linhas" | Roda em escopo de sistema |
| 2 | `src/config/prisma.ts` criava um PrismaClient paralelo, sem contexto | `grep new PrismaClient` | Reexporta o cliente único |
| 3 | Backup/restauração usavam `DATABASE_URL`; com `nexus_app` o `pg_dump` falharia (sem acesso a `_prisma_migrations`, linhas escondidas) | Análise dos privilégios | Usam `DIRECT_URL` (dono das tabelas) quando definida |
| 4 | Scripts com `nexus_migrator` podiam esbarrar no limite de 3 conexões do papel | 1 falha transitória observada | Procedimento usa `PRISMA_CONNECTION_LIMIT=2` |

## 3. Testes executados e resultados individuais
| Teste | Modo | Resultado |
|---|---|---|
| `tsc --noEmit` (backend) | — | ✅ 0 erros |
| `npm run build` (backend) | — | ✅ exit 0 |
| `npm run build` (frontend, Next.js) | — | ✅ "Compiled successfully" |
| `prisma validate` | — | ✅ schema válido |
| **Suíte completa do backend** | `nexus_app` + RLS | ✅ **380 aprovados**, 3 falhas pré-existentes, 10 pulados |
| **Suíte completa do backend** | `postgres` (modo atual) | ✅ **369 aprovados**, 4 falhas: as 3 pré-existentes + `mod07-mutacao` (travou 457 s com o banco local indisponível; **3/3 ao repetir**, 12 s cada, nos dois modos) |
| `rls-http-multitenant` (novo, 14 casos) | ambos | ✅ 14/14 + 14/14 |
| `rls-pool-contexto` (novo, 8 casos) | ambos | ✅ 8/8 + 8/8 |
| `rls-isolamento` (10 casos) | `nexus_app` | ✅ 10/10 (pulado como `postgres`, que ignora o RLS) |
| `secrets-v2` (7 casos) | — | ✅ 7/7 |
| Timers dos agendadores herdam o escopo de sistema | — | ✅ 4/4 disparos em `sistema`, nada vaza para fora |
| Recifragem como `nexus_migrator` (staging, mesma posse da produção) | — | ✅ 3/3 rodadas (1 falha transitória anterior, não reproduzida) |
| Credenciais locais (sem exibir valores) | — | ✅ `nexus_app.<ref>`, `connection_limit=10`, `nexus_migrator`, chave de 64 hex, senhas distintas, fora do Git |
| Login do `nexus_migrator` pelo pooler da produção (leitura) | — | ✅ dono das 85 tabelas |

O que os testes novos cobrem (pedido da Fase 2):
- A não acessa B **e** B não acessa A: ler por id, listar, editar e excluir em produtos, clientes, fornecedores, funcionários, financeiro e metas, além de vender com filial/produto da outra empresa.
- Sem contexto = 0 linhas; usuário sem permissão = 403 sem executar a operação; sem token/token adulterado = 401.
- Dentro e fora de transações, em lote e com rollback, o contexto é respeitado.
- **Pool com 1 conexão física**: depois de cada operação a conexão não guarda `app.empresa_id`; A e B intercaladas na mesma conexão nunca se misturam; a requisição seguinte começa sem o tenant da anterior.
- Leitura, inserção, atualização e exclusão respeitam as policies (WITH CHECK incluso).

## 4. Problemas encontrados e resolvidos
Os 4 da seção 2, mais 3 falhas de teste (`integracoes`, `rls-http-multitenant` e `mod07-mutacao`) por **queda momentânea do banco Docker local** ("Can't reach database server"), logo depois da reinicialização do Docker Desktop. Todos passaram ao repetir (16/16 em 2 repetições; `mod07-mutacao` 3/3).

## 5. Pendências
| Pendência | Por quê |
|---|---|
| 3 testes antigos falham (`compras-aba`, `estoque-aba` inventário, `mercadolivre-consulta`) | Já falhavam antes do PR; não envolvem segurança |
| **Vulnerabilidades em dependências** (já existiam antes do PR, que não muda nenhuma) | Backend: `@fastify/jwt`→`fast-jwt` 4.0.5 (críticas; correção exige Fastify 5), `proxy-addr`, `zod`. Frontend: `next` 14.2.5 (crítica de bypass do middleware; correção 14.2.35), `axios`, `postcss`. Recomendado: PR separado |
| Drift entre `schema.prisma` e as migrações/produção | Pré-existente; corrigir exige mudança de estrutura em produção |
| Sem CI no repositório | O PR não tem verificações automáticas; a validação é a desta revisão |

## 6. Riscos
| Risco | Mitigação |
|---|---|
| Perder a `CREDENTIALS_ENCRYPTION_KEY` depois do deploy | Guardar no cofre **antes** do deploy (hoje há 0 credenciais, então o risco só começa com novas integrações) |
| Migração futura criar tabela sem RLS | Rodar `01_rls_policies.sql` após cada migração (o script falha se sobrar tabela sem RLS) |
| `fast-jwt` vulnerável | Os vetores críticos exigem segredo vazio/RSA; o NEXUS usa HS256 com segredo ≥ 32 caracteres, validado no boot. Atualizar mesmo assim |
| Middleware do Next vulnerável | Só redireciona telas; a autorização real é no backend |
| Custo por consulta (+1 `set_config`) | Não medido em produção; monitorar a latência após a troca |

## 7. Situação do PR #2
Aberto, 8 commits, sem CI configurado, **não mesclado**. Tecnicamente pronto para merge.

## 8 e 9. Publicação
Procedimento exato em [`docs/DEPLOY_SEGURANCA_PRODUCAO.md`](docs/DEPLOY_SEGURANCA_PRODUCAO.md).

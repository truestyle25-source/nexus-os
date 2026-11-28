# CI/CD, proteção da main e deploy — NEXUS OS

Atualizado em 2026-11-21.

## 1. Workflows

| Arquivo | Quando | O que garante |
|---|---|---|
| `.github/workflows/ci.yml` | Todo PR e todo push na `main` | Ver tabela abaixo |
| `.github/workflows/backup.yml` | Diário (06:17 UTC) e manual | Backup verificado (ver `BACKUP_E_RECUPERACAO.md`) |
| `.github/workflows/monitor.yml` | A cada 10 min e manual | API viva, API com banco, tarefas diárias em dia, frontend no ar |
| `.github/dependabot.yml` | Semanal (npm) e mensal (Actions, Docker) | PRs de atualização, passando pelo CI |

### Jobs do CI (os nomes são os "status checks" exigidos)
| Job | Etapas |
|---|---|
| **Backend (TypeScript, Prisma, build, testes)** | `npm ci` · `prisma validate` · `prisma generate` · `tsc` · build · migrações num Postgres 17 descartável · **drift: schema = migrações** · testes como `postgres` · RLS + papéis + validação 10/10 · testes como `nexus_app` (RLS ativo) · `npm audit` **bloqueia alta/crítica** |
| **Frontend (TypeScript, testes, build)** | `npm ci` · `tsc` · testes · `next build` · `npm audit` **bloqueia alta/crítica**, com exceção explícita e temporária só para `next`/`postcss` |
| **Imagem Docker do backend (build igual ao Render)** | `docker build` (Node 22) e a imagem precisa subir e responder `/health` |
| **Varredura de segredos (gitleaks)** | Segredos no diff do PR, ou no último commit da `main` |

Mudanças de 21/11: Node 20 (fora de suporte) virou **22 LTS**; entraram a checagem de drift, o job Docker e as auditorias bloqueantes,
que antes eram só aviso (`continue-on-error`).

## 2. Proteção da branch `main` (pendência: sua autorização)
**Hoje a `main` não tem proteção** (a API responde "Branch not protected"): dá para enviar direto, sem PR e sem CI.

Configuração recomendada. Rode na raiz do repositório; o arquivo é lido pelo comando:
```powershell
gh api -X PUT repos/truestyle25-source/nexus-os/branches/main/protection --input docs/protecao-main.json
```
O que `docs/protecao-main.json` define:
- exige Pull Request para entrar na `main`;
- exige os 4 checks do CI aprovados e a branch atualizada;
- conversas resolvidas antes do merge;
- proíbe force-push e exclusão da `main`;
- aplica a regra também ao administrador.

A revisão obrigatória fica com **0 aprovações**, porque o projeto tem um único desenvolvedor: com 1, nenhum PR
poderia ser mesclado. Aumente quando entrar outra pessoa.

## 3. Fluxo de deploy: GitHub → CI → Vercel → Render → Supabase
| Etapa | Situação | O que falta |
|---|---|---|
| Vercel (frontend) | Publica **todo push na main** e gera Preview em cada PR. **Não espera o CI**: em 21/11, publicou às 09:11 com o CI ainda rodando | No painel da Vercel → Settings → Git: ligar o bloqueio por checks do GitHub, se o plano oferecer; senão, a proteção da `main` (seção 2) já impede código sem CI de chegar lá |
| Render (backend) | **Não verificável daqui** (o painel exige login; o Render não informa o GitHub) | Painel → serviço `nexus-os` → Settings → Build & Deploy → **Auto-Deploy: "After CI Checks Pass"** |
| Falha de build | Vercel e Render não publicam build quebrado; mantêm a versão anterior no ar | — |
| Migrações | **Nunca automáticas** (nem no Docker, nem no CI contra a produção) | Procedimento controlado (seção 4) |
| Rollback | Vercel: "Promote" de um deploy anterior (instantâneo). Render: "Rollback" para um deploy anterior. Banco: as migrações deste projeto são aditivas; desfazer = restaurar o backup (`BACKUP_E_RECUPERACAO.md`) | — |

## 4. Migrações em produção (procedimento controlado)
1. Backup novo com restauração testada (`backup.yml` → Run workflow, ou `npm run backup`).
2. `prisma migrate diff` produção × schema, para ver exatamente o que vai mudar. Só migrações aditivas sem autorização extra.
3. `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy` (papel `nexus_migrator`).
4. **Se a migração criou tabela**, rodar de novo `prisma/seguranca/01_rls_policies.sql`: ele recusa terminar se
   alguma tabela ficar sem RLS.
5. Conferir: `migrate status`, diff = 0, RLS 100% (menos `_prisma_migrations`) e `/health/ready`.

**NEXUS AI (migrações 202611270000 a 202612010000, todas aditivas):**
- **Pré-requisito antes do passo 3:** a migração `202611290000_nexus_ai_pgvector` usa a extensão `vector`, que só um
  superusuário cria (testado: o papel `nexus_migrator` recebe *"permission denied to create extension"*). Um
  administrador (SQL Editor do Supabase, papel `postgres`) roda antes, **no schema public**:
  `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;`
  Se a extensão já existir, confira onde está: `SELECT extnamespace::regnamespace FROM pg_extension WHERE extname = 'vector';`
  — precisa ser `public` (o código usa o tipo `vector` e o operador `<=>` sem prefixo de schema). Com a extensão
  criada, a migração roda normalmente pelo `nexus_migrator` (testado: tabela, índice HNSW e operador).
- As migrações criam as tabelas `AIConversa`, `AIMensagem`, `AIExecucao`, `AIExecucaoFerramenta`, `AIConsumo`,
  `AILimite`, `AIMemoria`, `AIDocumento`, `AITrecho`, `AIEvento`, `AIInsight`, `AIAprovacao` e `AIAutomacao`:
  rodar o passo 4 (RLS) depois.
- O drift do passo 5 mostra uma única diferença esperada, `DROP INDEX "AITrecho_embedding_idx"` (índice HNSW que o
  Prisma não representa). Use `node scripts/verificar-drift.cjs`, que tolera só essa linha.

**Migração desta entrega:** `202611211000_pilares_infra` cria a coluna `Usuario.sessoesValidasDesde` e as tabelas
`RateLimitJanela` e `TarefaAgendada`. É aditiva. **Deve ser aplicada antes ou junto do deploy do backend**:
o código novo usa essas tabelas no login e no rate limit.

**NEXUS CLUB, Fase 2 (`202701020000_nexus_club_fase2_dados`, aditiva):** cria as tabelas `ContaConsumidor`,
`ConsumidorToken`, `ClubeConfig`, `MembroClube`, `TermoVersao`, `TermoAceite`, `ConsentimentoEvento` e
`ConsentimentoAtual`, o valor `NEXUS_CLUB` em `Origem`, a função `app_consumidor_id()` e as travas entre empresas.
- As tabelas já nascem com RLS (a própria migração cria as regras); mesmo assim rode o passo 4 depois
  (`01_rls_policies.sql`). Ele roda pelo próprio `nexus_migrator`, dono das tabelas e funções.
- **Não** é preciso reaplicar `02_papeis.sql`: a migração já concede a função nova ao `nexus_app` e tira dele
  UPDATE/DELETE em `TermoAceite`/`ConsentimentoEvento`. Atenção: o 02 **redefine as senhas** dos papéis — rodá-lo
  com senha diferente da que está no Render derruba o acesso do backend.
- **Aplicada em produção em 27/11/2026** (backup verificado antes): 01 reaplicado pelo `nexus_migrator`; conferido
  0 tabelas sem RLS, regras das 8 tabelas, `nexus_app` sem UPDATE/DELETE nos históricos, 3 travas, drift ok.
- Testado num banco igual ao de produção (todas as migrações anteriores + scripts 01–03 da `main`), com a migração
  aplicada pelo `nexus_migrator`: tabelas protegidas antes de reaplicar o 01, e 04 com 22 verificações ok.
- O drift do passo 5 tolera também `DROP INDEX "TermoVersao_plataforma_tipo_versao_key"` (índice único parcial).
- Nenhum código em uso lê estas tabelas ainda (Fase 3 em diante): a migração pode ir antes do deploy.

## 5. Staging
Hoje existe só o ambiente isolado **local** (Docker `nexus_staging_pg` e `nexus_postgres`), usado nos testes de carga, RLS e backup.

Proposta de staging na nuvem, sem tocar a produção:
| Peça | Opção | Custo estimado* |
|---|---|---|
| Banco | Segundo projeto Supabase (Free) só para staging | US$ 0 |
| Backend | Segundo Web Service no Render, branch `staging`, plano Free | US$ 0 (dorme quando ocioso) |
| Frontend | Preview da Vercel apontando para a API de staging (`NEXT_PUBLIC_API_URL` no ambiente Preview) | US$ 0 |
| Dados | Só sintéticos; nunca cópia da produção sem anonimização (LGPD) | — |

\*Valores dos planos gratuitos atuais; confira antes. Criar os projetos é decisão e ação sua, nas contas de cada provedor.

## 6. Dependências
Ver `docs/PLANO_EVOLUCAO_DEPENDENCIAS.md`.

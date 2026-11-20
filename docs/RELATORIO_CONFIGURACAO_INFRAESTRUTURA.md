# Relatório de configuração da infraestrutura — NEXUS OS (2026-11-20)

> Nenhum valor secreto aparece neste documento. Nada foi excluído (projetos, bancos, tabelas, dados, variáveis).
> **Limite operacional:** o assistente não digita senhas, chaves ou tokens em painéis. Os valores secretos
> (DATABASE_URL do `nexus_app`, DIRECT_URL, CREDENTIALS_ENCRYPTION_KEY) precisam ser colados por você.

## Mapa da infraestrutura (verificado)
```
Navegador ──► Vercel  (projeto nexus-os, domínio nexus-os-one-teal.vercel.app, Next.js 14.2.35, Node 22)
                 │  API fixa no código: https://nexus-os-7u4g.onrender.com (NEXT_PUBLIC_API_URL não definida)
                 ▼
              Render  (workspace "NEXUS OS", serviço nexus-os, Docker, plano Free, região Oregon, branch main)
                 │  DATABASE_URL = usuário postgres (BYPASSRLS)  ← proteção RLS ainda INATIVA
                 ▼
              Supabase (Postgres 17.6, pooler aws-0-us-east-1, porta 5432)
```
Observação: há duas contas no Render. A correta é a do workspace **NEXUS OS**; a outra ("My Workspace", login via GitHub) está vazia.

## 1. Vercel
| Item | Valor | Situação |
|---|---|---|
| Projeto | `nexus-os` (único) | ✅ |
| Framework / Root Directory | Next.js / `frontend` | ✅ |
| Node.js | 22.x | ✅ (testes do frontend passam no 22) |
| Domínio de produção | `nexus-os-one-teal.vercel.app` | ✅ configuração válida |
| Deploy de produção | automático na `main` | ✅ publicou os merges #2–#6 com sucesso |
| `NEXT_PUBLIC_API_URL` | não definida | 🟡 funciona pelo valor fixo no código; recomendado definir |

**Variáveis (19)** — o código do frontend usa **apenas** `NEXT_PUBLIC_API_URL` (verificado por busca no código):
| Grupo | Variáveis | Avaliação |
|---|---|---|
| Integração Supabase–Vercel (adicionadas hoje) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_PASSWORD`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_DATABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` | 🔴 segredos que **ignoram o RLS**, sem uso no frontend |
| Antigas (10/set) | `JWT_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY` | 🟠 segredos de backend sem uso no frontend |
| Públicas | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ públicas por natureza; `anon` sem acesso ao schema |
Nenhuma variável secreta tem prefixo `NEXT_PUBLIC_`, portanto **nenhuma vai para o navegador**. Não foram removidas (decisão sua; ver §9).

## 2. Render
| Item | Antes | Depois |
|---|---|---|
| `FRONTEND_URLS` | URL de um deploy antigo (`nexus-58kh4fmqs-…vercel.app`) → **CORS recusava todas as origens** | `https://nexus-os-one-teal.vercel.app` |
| `PRISMA_CONNECTION_LIMIT` | — | `10` |
| Health Check Path | vazio | `/health` |
| Commit publicado | `cc51fd9` | `703dd79` (main atual) |
| Pré-deploy | vazio (migrações não rodam sozinhas) | inalterado ✅ |
| Dockerfile / contexto | `backend/` | inalterado ✅ |
| `DATABASE_URL` | `postgres` (hash `337419ee…` = `backend/.env` local, então o rollback está garantido) | **inalterada** (aguarda você colar a do `nexus_app`) |
| `JWT_SECRET` | — | inalterado |

## 3. Supabase (consultas de leitura)
| Item | Estado |
|---|---|
| Versão | PostgreSQL 17.6 |
| RLS | 84/85 tabelas (fora: `_prisma_migrations`), 84 policies, 0 FORCE |
| Papéis | `nexus_app`: sem superuser/BYPASSRLS/DDL, limite 20, timeouts; `nexus_migrator`: dono das tabelas, limite 3 |
| `anon`/`authenticated` | sem USAGE em `public` |
| Funções | só `app_empresa_id()` e `app_escopo_sistema()` (não SECURITY DEFINER) |
| Triggers | nenhum |
| Extensões | pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp |
| Índices / FKs | 265 / 102; todas as tabelas com PK |
| Storage | bucket `documentos` privado; `storage.objects` com RLS e 0 policies (só o backend acessa) |
| Migrações | 49 aplicadas; 2 tentativas revertidas (ignoradas pelo Prisma); migração de drift **não aplicada** |
| TLS | o pooler **aceita** conexão sem TLS → URLs novas com `sslmode=require` (testado com `nexus_app`) |
| Integridade | 🟠 60 tabelas com `empresaId` sem FK para `Empresa` (o `schema.prisma` não declara as relações) |
| Dados | 1 empresa, 1 usuário, 0 credenciais cifradas |

## 4. Variáveis adicionadas ou modificadas
| Plataforma | Variável | Ação |
|---|---|---|
| Render | `FRONTEND_URLS` | modificada (domínio de produção) |
| Render | `PRISMA_CONNECTION_LIMIT` | adicionada (`10`) |
| Local (fora do Git) | `backend/.env.seguranca.local` | `sslmode=require` nas URLs novas |

## 5. Problemas encontrados
1. 🔴 **CORS recusava todas as origens** (`FRONTEND_URLS` com URL de deploy antigo): o login pela tela de produção não funcionava.
2. 🔴 **CORS bloqueava PUT/PATCH/DELETE**: regressão do `@fastify/cors` 11 (PR #3), cujo padrão passou a ser só GET/HEAD/POST. Editar e excluir pela tela falhariam.
3. 🔴 Segredos com acesso total ao banco (service role, senha do `postgres`) no projeto do frontend na Vercel.
4. 🟠 Backend ainda como `postgres` (RLS sem efeito para a aplicação).
5. 🟠 Health check desligado no Render.
6. 🟠 Backend em Oregon e banco em us-east-1: latência entre costas a cada consulta.
7. 🟠 Plano Free do Render: o serviço hiberna sem uso (primeira requisição pode levar 50 s ou mais).
8. 🟠 Pooler aceita conexões sem TLS.
9. 🟠 60 tabelas sem FK de `empresaId`.

## 6. Problemas corrigidos
| # | Correção | Evidência |
|---|---|---|
| 1 | `FRONTEND_URLS` corrigida | preflight de `nexus-os-one-teal.vercel.app` → `access-control-allow-origin` presente; origem estranha → ausente |
| 2 | PR #7 (`lib/cors.ts`): métodos explícitos e origens normalizadas | teste novo **falha sem / passa com**; CI do PR: backend 380/0 (`postgres`) e 390/0 (`nexus_app`), frontend 64/64 |
| 5 | Health check `/health` | logs: verificação a cada 5 s, 200 |
| 8 | `sslmode=require` nas URLs novas | Prisma conectou como `nexus_app` com TLS obrigatório |

## 7. Testes executados
| Teste | Resultado |
|---|---|
| Frontend de produção `/login` | 200 |
| Backend `/health` | 200 |
| CORS do domínio de produção (preflight e GET) | liberado ✅ |
| CORS de origem estranha | recusado ✅ |
| CORS PUT/PATCH/DELETE em produção | ❌ bloqueado (corrigido no PR #7, ainda não mesclado) |
| Logs do Render após 2 deploys | 0 respostas 5xx, 0 avisos |
| Conexão Prisma `nexus_app` + TLS na produção (leitura) | ✅ 1 usuário visto no contexto da empresa |
| DATABASE_URL do Render × local (hash) | idênticas ✅ |

## 8. Pendências
- Merge do PR #7 (correção de CORS dos métodos).
- Trocar a `DATABASE_URL` do Render para `nexus_app` e adicionar `DIRECT_URL` e `CREDENTIALS_ENCRYPTION_KEY` (valores colados por você).
- Teste integrado com duas empresas de teste após a troca (exige criar 2 empresas sintéticas em produção; ver §9).
- Limpar segredos do projeto da Vercel.
- Mover o backend para a região do banco (Virginia) ou o banco para perto do backend.
- Plano pago no Render (sem hibernação) para operação SaaS.
- Ativar "Enforce SSL" no Supabase (Database → Settings) depois que todas as conexões usarem TLS.
- FKs de `empresaId` (projeto de schema).

## 9. Ações que dependem de você
1. **Autorizar o merge do PR #7.**
2. **No Render → nexus-os → Environment**, colar de `backend/.env.seguranca.local`:
   `DATABASE_URL` (substituir), `DIRECT_URL` (nova), `CREDENTIALS_ENCRYPTION_KEY` (nova, impressão sha256 `2e2856d3`) → **Save, rebuild, and deploy**.
   Rollback: colar de volta a `DATABASE_URL` do `backend/.env` (hash `337419ee…`).
3. **Autorizar a criação de 2 empresas de teste em produção** para o teste de isolamento de ponta a ponta (removíveis depois).
4. **Vercel**: desconectar a integração Supabase deste projeto, ou autorizar a remoção das variáveis secretas sem uso.
5. Trocar a senha do `postgres` no Supabase (incidente de exposição) e atualizar `backend/.env` local.

## 10. Estado final (neste momento)
| Plataforma | Estado |
|---|---|
| Vercel | ✅ no ar, configuração correta; 🔴 segredos sem uso no projeto |
| Render | ✅ no ar com a `main` atual, CORS do domínio corrigido, health check ativo; 🔴 métodos de CORS (PR #7) e 🔴 ainda como `postgres` |
| Supabase | ✅ RLS, papéis e posse prontos; aguardando o backend usar `nexus_app` |


## 11. Ativação do nexus_app em produção (2026-11-20, 19:35 UTC)
Valores secretos colados por você no Render (Environment) e conferidos por hash, sem exibição, antes do deploy:
| Variável | Conferência |
|---|---|
| `DATABASE_URL` | 178 caracteres, usuário **nexus_app**, hash idêntico ao arquivo local |
| `DIRECT_URL` | 163 caracteres, usuário nexus_migrator, hash idêntico |
| `CREDENTIALS_ENCRYPTION_KEY` | 64 caracteres, impressão sha256 `2e2856d3` |
| removidas antes de salvar | `NEXUS_APP_PASSWORD` e `NEXUS_MIGRATOR_PASSWORD` (coladas por engano; desnecessárias) |

Duas tentativas anteriores com erro de cópia (DATABASE_URL renomeada; chave com caractere a mais) foram **canceladas antes de salvar**; a produção não foi afetada.

**Evidências após o deploy (Live):**
| Teste | Resultado |
|---|---|
| Conexões no banco | **nexus_app: 2 (19:36 UTC)**; postgres só a interna `pg_net` |
| `/health` | 200 |
| Login com e-mail inexistente (lê Usuario e grava LoginAttempt em escopo de sistema) | 401 "Credenciais inválidas" ✅ |
| Rotas protegidas sem token / token falso | 401 |
| CORS do domínio de produção | liberado ✅ |
| CORS PUT/PATCH/DELETE | ❌ ainda bloqueado: depende do merge do PR #7 |
| Logs após a troca | 0 erros de permissão, RLS ou conexão; único erro = ZodError do teste com corpo inválido (400 esperado) |

**Estado: a proteção RLS está ATIVA em produção.**
Rollback: voltar a `DATABASE_URL` do Render para o valor do `backend/.env` local (hash `337419ee…`) e salvar.
Recifragem: 0 credenciais cifradas em produção, nada a converter.
Observação: os testes de produção gravaram 1 registro de tentativa de login falha (comportamento normal do sistema).

## 12. Ajustes solicitados em 2026-11-20 ("altere isso")

### Vercel — segredos sem uso
- A integração Supabase–Vercel havia criado um **projeto Supabase novo e separado** (`supabase-amethyst-pendant`, ID `weqljnwpzhhywpmrvbps`, plano Free, criado hoje) e copiado 16 variáveis dele para o `nexus-os`. **Esse banco não é o do NEXUS** e não foi excluído (regra: não excluir bancos).
- **Removida a conexão** do projeto `nexus-os` com esse banco: as 16 variáveis da integração saíram (reversível: "Connect to Project").
- **Removidas** as 9 entradas antigas de `OPENAI_API_KEY`, `JWT_SECRET` e `DATABASE_URL` (Production/Preview/Development), sem uso no frontend. Os valores continuam onde são usados (backend no Render, painel da OpenAI). A Vercel avisa que a exclusão não invalida os segredos: **se algum deles for de produção, trocá-lo**.
- **Adicionada** `NEXT_PUBLIC_API_URL = https://nexus-os-7u4g.onrender.com` (tipo Config, Production). Vale a partir da próxima publicação; é o mesmo valor que o código já usa como padrão.
- Resultado: o projeto do frontend tem **1 variável**, pública.

### Supabase — chaves estrangeiras de `empresaId`
- Backup novo antes (`backend/backups/prod-antes-fk-20261120.dump`, restauração testada).
- Aplicadas em produção, com `nexus_migrator`: `202611200900_sincroniza_schema_drift` e `202611201200_fk_empresa_id` (PR #8).
- Resultado: **75/75 FKs para `Empresa` válidas** (antes 14), `RESTRICT` exceto `Auditoria` (`SET NULL`); `01_rls_policies.sql` reaplicado: **RLS 85/86** (inclui `NexusErpRecord`), 85 policies; 51 migrações; dados intactos (1 empresa, 1 usuário).
- Backend depois: `/health` 200, login 401 (correto), conectado como `nexus_app`.

### Render — região e plano (não alterável pelo assistente)
- **Região**: o Render não muda a região de um serviço existente. Para Virginia (mesma região do banco): criar um Web Service novo em **Virginia (US East)** com as mesmas configurações e variáveis, validar, apontar `NEXT_PUBLIC_API_URL` (Vercel) para a URL nova e então suspender o antigo. Exige você colar os segredos de novo.
- **Plano**: sair do Free (hibernação) é uma compra no painel do Render (Upgrade → Starter ou superior). Decisão e pagamento são seus.

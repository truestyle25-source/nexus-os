# Relatório de Execução — Plano de Segurança do NEXUS OS

> Data: 2026-11-19 · Branch: `security/rls-multitenant` (5 commits sobre `main`, **não enviados ao GitHub**)
> Ciclo aplicado em cada etapa: executar → testar → identificar erros → corrigir → testar de novo → validar.

## 1. Resumo executivo

| Item | Resultado |
|---|---|
| Código de segurança implementado | ✅ contexto de empresa por transação, RLS, papéis dedicados, cifragem v2 |
| Funcionalidades preservadas | ✅ nenhuma rota, tela, fluxo ou layout removido ou alterado no comportamento |
| Suíte de testes — modo atual (`postgres`) | **346 aprovados, 3 falhas** (antes das mudanças: 333 aprovados, 9 falhas) |
| Suíte de testes — modo futuro (`nexus_app` + RLS) | **356 aprovados, 3 falhas** (as mesmas 3 falhas antigas; ver §6) |
| Testes novos de isolamento no banco | **10/10** (`tests/rls-isolamento.test.ts`) |
| Testes novos de cifragem v2 | **7/7** (`tests/secrets-v2.test.ts`) |
| Validação SQL no staging (estrutura idêntica à produção) | **10/10** (`04_validacao_rls.sql`) |
| E2E com o servidor real via HTTP | **25/25** como `nexus_app` e **25/25** como `postgres` |
| Ciclo aplicar → reverter → reaplicar dos scripts SQL | ✅ validado no staging |
| Bugs encontrados e corrigidos no caminho | **9** (ver §5), 1 deles pré-existente e grave |
| **Banco de produção (Supabase)** | **Não alterado.** Só consultas de leitura e cópia da estrutura (sem dados) |

**Por que a produção não foi alterada:** o próprio plano exige staging antes de produção, e a troca
efetiva depende de dois passos que só você pode fazer: (1) publicar o backend novo no provedor
(Render/Vercel) e (2) trocar a `DATABASE_URL` e criar a `CREDENTIALS_ENCRYPTION_KEY` nas variáveis do
provedor. Aplicar os scripts no Supabase antes do deploy não traria proteção nenhuma (a aplicação
continua como `postgres`, que ignora o RLS) e quebraria a sua regra de não comprometer o banco. O
passo a passo seguro está em [`docs/SEGURANCA_RLS_RUNBOOK.md`](docs/SEGURANCA_RLS_RUNBOOK.md).

## 2. Ambiente de validação usado

| Ambiente | O que é | Uso |
|---|---|---|
| `nexus_staging_pg` (Docker, porta 5433, **Postgres 17**) | Criado nesta execução. Estrutura **copiada da produção** (`pg_dump --schema-only`, sem dados) | Ensaio dos scripts SQL simulando o Supabase: admin `supa_postgres` **sem superuser**, com CREATEROLE e BYPASSRLS, como o `postgres` do Supabase |
| `nexus_os_test` (Docker `nexus_postgres`, porta 5432) | Banco de testes que o projeto já usava (os testes exigem esse nome) | Suíte completa como `postgres` e como `nexus_app`; servidor real nos dois modos |
| Produção (Supabase) | — | Só leitura: 1 empresa, 1 usuário, 0 produtos, 0 vendas |

Alterações locais fora do Git: os papéis `nexus_app`/`nexus_migrator` foram criados no cluster Docker
local de desenvolvimento (com senhas de teste) e o RLS foi aplicado **só** no banco `nexus_os_test`.
O banco `nexus_os` de desenvolvimento não foi tocado.

## 3. O que foi feito, por fase

### Fase 0 — Higiene de segredos ✅
- Varredura em arquivos versionados, logs locais e **todo** o histórico do Git.
- Achado 1: `backend/audit_query.js` (fora do Git) tinha a **URL de produção com a senha** escrita no código. A senha foi trocada por `process.env.DATABASE_URL`.
- Achado 2: a mesma senha está num checkpoint local da extensão Cline (`refs/cline/checkpoints/...`, commit `aa0bd44`). Ela **não está no GitHub** (`git ls-remote` só mostra `main` e `nexusOS`).
- Achado 3: os arquivos de auditoria versionados (`AUDITORIA-IA-NEXUS/*.txt`) listam só **nomes** de variáveis (`SUPABASE_SERVICE_ROLE_KEY True`), sem valores. Não há vazamento.
- `.gitignore`: passou a ignorar `backend/audit_query.js` e `.env.*` (mantendo `.env.example`).
- **Pendente (só você pode fazer):** trocar a senha do `postgres` no painel do Supabase, porque ela esteve em texto puro em arquivos locais e em checkpoints de ferramentas.

### Fase 7 (antecipada) — Chave própria para credenciais ✅
- `backend/src/lib/secrets.ts`: formato **v2** (`v2.iv.tag.dados`) com `CREDENTIALS_ENCRYPTION_KEY`, independente do `JWT_SECRET`. O formato v1 continua legível, e sem a chave nova o comportamento é idêntico ao antigo (compatível com a produção atual).
- `backend/src/scripts/recifrar-credenciais.ts`: converte v1 → v2 (simulação por padrão, `--aplicar` para gravar), idempotente, e confere cada valor antes de gravar.
- Validado com dados reais de teste: 5 credenciais v1 (Mercado Livre + PIX) → v2, valores idênticos, e **depois de trocar o `JWT_SECRET` as credenciais continuaram legíveis**.

### Fases 1–3 — RLS, papéis e posse do schema ✅ (scripts prontos e ensaiados)
Em `backend/prisma/seguranca/`:
- `01_rls_policies.sql`: RLS + policy em **84 tabelas** (todas menos `_prisma_migrations`). Isolamento por `empresaId`; tabelas filhas sem `empresaId` (VendaItem, CompraItem, MovimentacaoCaixa, Ferias, Permissao, Pagamento, TokenRecuperacaoSenha) herdam da tabela-mãe; `LoginAttempt` só em escopo de sistema. Sem `FORCE` (correção R1 da revisão). Falha sozinho se alguma tabela ficar sem RLS.
- `02_papeis.sql`: `nexus_app` (só DML, sem BYPASSRLS, sem DDL, limite de 20 conexões, timeouts de 15 s/30 s) e `nexus_migrator`. Senhas só por variável do psql, nunca no arquivo. Verifica no final que nenhum papel ficou com privilégio indevido.
- `03_ownership.sql`: posse explícita por objeto (sem `REASSIGN OWNED`, correção 12.2-3); o administrador continua membro do `nexus_migrator`.
- `04_validacao_rls.sql`: 10 verificações automáticas (executa tudo e desfaz com ROLLBACK).
- Rollback para cada script, todos ensaiados.

### Fase 4 — Contexto de empresa no backend ✅
- `backend/src/lib/tenant-context.ts`: contexto por requisição (AsyncLocalStorage), com os escopos `nenhum` / `tenant` / `sistema`.
- `backend/src/lib/prisma.ts`: cada operação vai junto com `set_config('app.empresa_id', …, true)` na mesma transação (local à transação, sem vazar pelo pooler). As 38 transações interativas e os 5 lotes existentes funcionam **sem precisar mudar nenhuma rota** (correção R3). O `prisma` global usado dentro de uma transação é redirecionado para ela. Não há transação por requisição (correção R4).
- `middlewares/auth.ts`: a empresa do contexto é **sempre** a revalidada no banco, nunca a enviada pelo cliente (12.2-6).
- Escopo de sistema explícito, com motivo registrado, em: login, cadastro de empresa, recuperar/redefinir senha, rate limit de login, validação de chave da API pública, callbacks OAuth do Mercado Livre e da Shopee, webhook do Mercado Livre, agendadores e checagens de unicidade global (e-mail, CNPJ).

### Fase 5 — Policies por empresa ✅ (aplicadas e testadas no staging e no banco de testes)
- As policies são a versão final (por `empresaId`). A etapa "USING (true)" do plano não foi necessária, porque o contexto já estava completo e testado.

### Fase 6 — Filial — ⏸ não implementada (opcional no plano)
A filial continua controlada pelas permissões do sistema, como recomendado na revisão (12.3).

## 4. Validação real (além do build)

**E2E contra o `server.ts` real via HTTP**, com o RLS ativo e conectando como `nexus_app`:
cadastro de 2 empresas, login, `/auth/me`, filial, criar produto, entrada de estoque, **venda**
(itens + caixa + financeiro + baixa de estoque), **abertura de caixa no PDV** (transação interativa
com advisory lock), financeiro, cadastro de funcionário (RH), dashboard. Isolamento: B não vê o
produto de A, não lê a venda de A (404), não edita o produto de A, não vende usando filial/produto
de A; sem token = 401; token adulterado = 401; logout revoga o token. **25/25**, com **0** erros de
permissão, RLS ou conexões no log do servidor. O mesmo roteiro como `postgres` (o modo atual de
produção): **25/25**.

**Prova de que o banco bloqueia sozinho** (`tests/rls-isolamento.test.ts`, consultas **sem** filtro
`empresaId` de propósito): sem contexto = 0 linhas; A só vê A; A não lê, altera nem apaga B pelo id;
A não grava com o `empresaId` de B; transação interativa e prisma global dentro dela; lote;
rollback; **40 requisições concorrentes de empresas diferentes sem misturar contexto**; SQL cru.

## 5. Erros encontrados e corrigidos

| # | Erro | Como apareceu | Correção |
|---|---|---|---|
| 1 | **Pré-existente e grave:** uma empresa nova (sem cadastro em `Unidade`) **não conseguia registrar nenhuma venda** ("Unidade UN não encontrada"). A produção tem 0 unidades, então a primeira venda real falharia | 6 testes já falhavam antes de qualquer mudança | Atalho para unidade igual (UN → UN) em `conversao.service.ts`; corrigiu os 6 testes |
| 2 | Senha de produção escrita em `audit_query.js` | Varredura da Fase 0 | Troca para variável de ambiente + `.gitignore` |
| 3 | `NOSUPERUSER`/`NOREPLICATION` no script de papéis falha no Supabase (o admin não é superuser) | Ensaio no staging como `supa_postgres` | Removidos; verificação final dos atributos |
| 4 | Troca de dono falhava em cascata | Ensaio no staging | Consequência do 3; resolvido |
| 5 | `comoSistema(() => prisma.x())` rodava a consulta **fora** do contexto (a PrismaPromise é preguiçosa): o login validava, mas toda requisição autenticada dava 401 | Suíte como `nexus_app` (27 falhas) | `comoSistema`/`comTenant`/`executarComContexto` aguardam dentro do contexto |
| 6 | Checagem "e-mail/CNPJ já usado por outra empresa" deixou de enxergar outras empresas (500 em vez de 409) | Suíte como `nexus_app` (`configuracoes`) | Essas 3 checagens rodam em escopo de sistema, lendo só o `id` |
| 7 | Pool padrão do Prisma (núcleos × 2 + 1) passava do limite de conexões, gerando "too many connections" sob carga | Teste novo de concorrência | `connection_limit` padrão 10 (`PRISMA_CONNECTION_LIMIT`) |
| 8 | Teste "sem contexto" via `executarComContexto` | Teste novo | Mesmo ajuste do item 5 |
| 9 | SQL cru no `prisma` global dentro de uma transação perderia o contexto | Revisão de código | Agora roda com o contexto da empresa |

## 6. Falhas de teste que **não** são deste trabalho

Existiam antes da primeira mudança e não envolvem segurança (mesma falha nos dois modos):
- `compras-aba.test.ts`: `PrismaClientValidationError` no próprio teste (`id: undefined`).
- `estoque-aba.test.ts`: 3 asserções do inventário (saldo no instante da abertura, contagem gravada).
- `mercadolivre-consulta.test.ts`: espera 400 para conta não conectada e recebe 200.
- `clientes-aba.test.ts`: **instável** (gera o CNPJ a partir do relógio); passou em 3/3 execuções isoladas e em outras rodadas completas.

## 7. Mudanças de código (arquivos)

| Arquivo | Mudança |
|---|---|
| `backend/src/lib/tenant-context.ts` | **novo**: contexto de empresa |
| `backend/src/lib/prisma.ts` | cliente com contexto por transação + limite de pool |
| `backend/src/lib/secrets.ts` | cifragem v2 compatível com v1 |
| `backend/src/scripts/recifrar-credenciais.ts` | **novo** |
| `backend/src/middlewares/auth.ts`, `apiKeyAuth.ts`, `rateLimiter.ts` | definem o contexto |
| `backend/src/modules/auth/auth.routes.ts`, `empresa`, `usuarios`, `integracoes`, `shopee` | escopo de sistema em rotas públicas e checagens globais (1–5 linhas cada) |
| `backend/src/server.ts` | agendadores em escopo de sistema |
| `backend/src/modules/estoque/conversao.service.ts` | correção do bug de unidade |
| `backend/prisma/seguranca/*.sql` | **novos**: 4 scripts + 3 rollbacks |
| `backend/tests/rls-isolamento.test.ts`, `secrets-v2.test.ts` | **novos** |
| `backend/.env.example`, `.gitignore`, `docs/SEGURANCA_RLS_RUNBOOK.md` | documentação e proteção |

TypeScript do backend: **0 erros** (`tsc --noEmit`). Nenhum arquivo do frontend foi alterado.

## 8. O que falta e depende de você (produção)

Seguir [`docs/SEGURANCA_RLS_RUNBOOK.md`](docs/SEGURANCA_RLS_RUNBOOK.md), na ordem:
1. Revisar a branch, fazer o merge e publicar o backend (continua como `postgres`, sem mudança de comportamento).
2. Criar `CREDENTIALS_ENCRYPTION_KEY` e `PRISMA_CONNECTION_LIMIT=10` no provedor; rodar a recifragem.
3. No Supabase: rodar `01`, `02` (senhas geradas na hora) e `03`.
4. **Testar se o pooler aceita o papel `nexus_app.<ref>`** (é a única prova que não dá para fazer fora do Supabase) e trocar a `DATABASE_URL`.
5. Trocar a senha do `postgres` no painel.

## 9. Riscos remanescentes

| Risco | Situação |
|---|---|
| Supavisor aceitar papel customizado | **NÃO VERIFICADO** (só dá para testar no Supabase); se não aceitar, o rollback é voltar a `DATABASE_URL` |
| Escopo `sistema` é uma liberação controlada pelo backend | Mitigado: só código do servidor define, sempre com motivo; `nexus_app` continua sem DDL/TRUNCATE |
| Tabelas criadas em migrações futuras | Recebem privilégios automaticamente; **é preciso rodar `01` de novo** (o script falha se alguma ficar sem RLS) |
| Custo por consulta | +1 instrução (`set_config`) por operação; não medido em produção |
| Drift pré-existente entre `schema.prisma` e produção/migrações | Registrado, não corrigido (exige mudança de estrutura em produção) |

## 10. Limpeza opcional
- Staging: `docker rm -f nexus_staging_pg`
- Papéis de teste no Docker local: `backend/prisma/seguranca/02_papeis_rollback.sql` no banco `nexus_os_test`.

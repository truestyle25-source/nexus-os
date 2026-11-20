# Runbook — RLS multi-empresa e papéis de banco (NEXUS OS)

Procedimento para levar a proteção de banco à produção (Supabase). Cada passo é
independente e tem rollback. **Ordem obrigatória.** Faça backup antes de cada passo.

Arquivos: `backend/prisma/seguranca/`

| Script | O que faz | Rollback |
|---|---|---|
| `01_rls_policies.sql` | Funções `app_empresa_id()`/`app_escopo_sistema()`, RLS + policies em 84 tabelas | `01_rls_policies_rollback.sql` |
| `02_papeis.sql` | Cria `nexus_app` (runtime) e `nexus_migrator` (migrações), privilégios, timeouts | `02_papeis_rollback.sql` |
| `03_ownership.sql` | Passa a posse de tabelas/enums/funções de `public` para `nexus_migrator` | `03_ownership_rollback.sql` |
| `04_validacao_rls.sql` | 10 verificações de isolamento e privilégio (só staging; faz ROLLBACK) | — |

## Passo 1 — Deploy do backend novo (ainda como `postgres`)
O código novo envia `set_config('app.empresa_id', …, true)` em cada transação.
Com `postgres` (BYPASSRLS) isso **não muda resultado nenhum**.
- Definir `CREDENTIALS_ENCRYPTION_KEY` (32 bytes) e `PRISMA_CONNECTION_LIMIT=10` no provedor.
- Deploy. Validar login, venda, estoque, RH.
- Rodar `npx tsx src/scripts/recifrar-credenciais.ts` (simulação) e depois `--aplicar`.
- Rollback: deploy anterior (valores v2 já gravados exigem manter a chave configurada).

## Passo 2 — RLS (inerte para a aplicação atual)
```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f backend/prisma/seguranca/01_rls_policies.sql
```
Nada muda para o backend (ainda `postgres`). Protege contra GRANT acidental a `anon`.

## Passo 3 — Papéis
```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
  -v senha_app="$(openssl rand -hex 24)" -v senha_migrator="$(openssl rand -hex 24)" \
  -f backend/prisma/seguranca/02_papeis.sql
```
Guarde as senhas no cofre do provedor (nunca no Git). Os papéis ficam inertes até o passo 5.

## Passo 4 — Posse do schema
```bash
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -f backend/prisma/seguranca/03_ownership.sql
```
`postgres` continua membro de `nexus_migrator`, então o backend atual segue funcionando.

## Passo 5 — Trocar o backend para `nexus_app`
No Supabase, o usuário do pooler é `nexus_app.<project-ref>`:
```
DATABASE_URL=postgresql://nexus_app.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres?connection_limit=10
DIRECT_URL=postgresql://nexus_migrator.<ref>:<senha>@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```
- **Antes**: provar que o pooler aceita o papel customizado:
  `psql "$DATABASE_URL" -c "select current_user"` deve retornar `nexus_app`.
- Reiniciar o backend e validar os fluxos.
- Monitorar respostas vazias inesperadas e erros `42501` (permissão) nos logs.
- **Rollback imediato**: voltar `DATABASE_URL` para o usuário anterior e reiniciar.

## Passo 6 — Migrações com `nexus_migrator`
Rodar `prisma migrate deploy` com `DATABASE_URL=$DIRECT_URL` (papel `nexus_migrator`).
Tabelas novas recebem privilégios para `nexus_app` automaticamente (default privileges),
**mas precisam de RLS**: rode `01_rls_policies.sql` de novo depois de cada migração
que crie tabela. O próprio script falha se alguma tabela ficar sem RLS.

## Passo 7 — Rotação de segredos
Depois do passo 5 estável: trocar a senha do `postgres` no painel do Supabase
(a senha antiga esteve em arquivos locais e em checkpoints de ferramentas).

## Regras para desenvolvedores
- Rotas autenticadas: nada a fazer — o contexto é definido pelo middleware.
- Rotas públicas (login, webhooks, callbacks): `definirSistemaDaRequisicao('motivo')` no início.
- Jobs/scripts: `comTenant(empresaId, fn)` ou `comoSistema('motivo', fn)`.
- Checagem de unicidade global (e-mail, CNPJ): `comoSistema(...)` lendo só o `id`.
- Dentro de `prisma.$transaction(async tx => …)` prefira `tx`; o `prisma` global também funciona (é redirecionado para a mesma transação).
- `$queryRaw` no `prisma` global **dentro** de uma transação roda fora dela (comportamento original), com o contexto da empresa — prefira `tx.$queryRaw`.
- Testes de isolamento: `tests/rls-isolamento.test.ts` (rodar como `nexus_app`).

# Procedimento de publicação — Segurança multiempresa (PR #2)

> Estado do banco de produção em 2026-11-20: RLS, papéis e posse **já aplicados e validados**.
> O backend no ar ainda conecta como `postgres` (BYPASSRLS), então a proteção **ainda não está ativa**.
> Os valores secretos ficam em `backend/.env.seguranca.local` (fora do Git). Nunca cole esses valores em chat, issue, PR ou log.

## 0. Pré-checagem (5 min)
- [ ] O PR #2 tem CI verde/revisão feita.
- [ ] Backup recente existe: `backend/backups/prod-antes-seguranca-20261120.dump` (restauração já testada).
- [ ] Você tem acesso ao painel do provedor do backend e ao painel do Supabase.
- [ ] Janela de baixo movimento (a troca reinicia o backend; ~1 min de indisponibilidade).

## 1. Merge e deploy do código (backend ainda como `postgres`)
1. Faça o merge do PR #2 na `main`.
2. Antes do deploy, adicione **só** estas variáveis no provedor do backend (copie de `backend/.env.seguranca.local`):
   - `CREDENTIALS_ENCRYPTION_KEY` (64 caracteres hex)
   - `PRISMA_CONNECTION_LIMIT` = `10`
   **Não troque a `DATABASE_URL` ainda.**
3. Faça o deploy (o build roda `prisma generate` e `tsc`; nenhuma migração é executada automaticamente).
4. Valide no ar (como `postgres`, nada deve mudar):
   - `GET /health` → `{"status":"ok"}`
   - login no frontend, abrir Produtos, Vendas, Financeiro, RH.
5. **Rollback:** redeploy do commit anterior. A `CREDENTIALS_ENCRYPTION_KEY` pode ficar (o código antigo a ignora).

> ⚠️ A partir do momento em que `CREDENTIALS_ENCRYPTION_KEY` estiver no ar, credenciais novas são gravadas em v2.
> **Nunca perca essa chave**: sem ela, tokens do Mercado Livre/Shopee/PIX gravados em v2 não podem ser lidos
> (as integrações teriam de ser reconectadas). Guarde-a no cofre de senhas antes do deploy.

## 2. Recifragem das credenciais (simulação → aplicar)
Hoje a produção tem **0** credenciais cifradas (IntegracaoExterno, ShopeeConexao, PixSettings, IntegracaoPonto),
então a recifragem não tem o que converter. Rode mesmo assim para confirmar:

```bash
cd backend
# variáveis vindas do arquivo local (não imprime nada)
set -a; . ./.env.seguranca.local; set +a
export JWT_SECRET="<o mesmo JWT_SECRET de produção>"     # necessário para ler valores v1
DATABASE_URL="$DIRECT_URL" PRISMA_CONNECTION_LIMIT=2 npx tsx src/scripts/recifrar-credenciais.ts            # SIMULAÇÃO
DATABASE_URL="$DIRECT_URL" PRISMA_CONNECTION_LIMIT=2 npx tsx src/scripts/recifrar-credenciais.ts --aplicar  # só após conferir a simulação
DATABASE_URL="$DIRECT_URL" PRISMA_CONNECTION_LIMIT=2 npx tsx src/scripts/recifrar-credenciais.ts            # deve mostrar 0 a recifrar
```
Cuidados:
- `JWT_SECRET` precisa ser **exatamente** o de produção (senão valores v1 não decifram; o script aborta o registro e informa a falha, sem gravar).
- `CREDENTIALS_ENCRYPTION_KEY` precisa ser **exatamente** a configurada no provedor.
- O script valida cada valor (decifra o novo e compara) antes de gravar e é idempotente.
- Use `DIRECT_URL` (`nexus_migrator`, dono das tabelas) com `PRISMA_CONNECTION_LIMIT=2` (o papel aceita no máximo 3 conexões).

## 3. Troca para `nexus_app` (ativa o RLS de fato)
1. No provedor, troque `DATABASE_URL` pelo valor de `DATABASE_URL` em `backend/.env.seguranca.local`
   (usuário `nexus_app.<ref>`, já com `?connection_limit=10`). Adicione também `DIRECT_URL` (para backups/migrações).
2. Reinicie o backend.
3. Valide no ar, nesta ordem:
   - `GET /health`
   - login → `/auth/me` → listar produtos → abrir uma venda/caixa no PDV → financeiro → RH
   - cadastro de nova empresa (rota pública, escopo sistema)
   - logs do backend: **nenhum** `permission denied`, `42501`, `row-level security` ou `too many connections`
4. **Rollback imediato:** voltar `DATABASE_URL` para o valor anterior (usuário `postgres`) e reiniciar. Não exige mudança no banco.

## 4. Depois de 24–48 h estável
1. Trocar a senha do `postgres` no painel do Supabase (Project Settings → Database → Reset password).
   Atualize o `backend/.env` local de desenvolvimento se ele ainda apontar para produção (recomendado: apontar para o Docker local).
2. Guardar `NEXUS_APP_PASSWORD`, `NEXUS_MIGRATOR_PASSWORD`, `CREDENTIALS_ENCRYPTION_KEY` no cofre de senhas e só então apagar `backend/.env.seguranca.local`.

## 5. Operação contínua
- Migrações: `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy`, depois `psql "$DIRECT_URL" -f backend/prisma/seguranca/01_rls_policies.sql` (aplica RLS em tabelas novas; o script falha se alguma ficar sem RLS).
- Backup/restauração: `npm run backup` / `npm run backup:restaurar` usam `DIRECT_URL` automaticamente quando definida.
- Script de snapshot manual (`npm run estoque:snapshot`): roda em escopo de sistema; funciona com qualquer um dos dois papéis.

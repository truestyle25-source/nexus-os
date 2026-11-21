# NEXUS OS — produção

## Backend

Configure:

- `DATABASE_URL` com o papel `nexus_app` (sem BYPASSRLS; ver `docs/SEGURANCA_RLS_RUNBOOK.md`)
- `DIRECT_URL` com o papel `nexus_migrator` (dono das tabelas: migrações, backup e restauração)
- `PRISMA_CONNECTION_LIMIT` (padrão 10; abaixo do limite de 20 conexões do `nexus_app`)
- `CREDENTIALS_ENCRYPTION_KEY` (cifra as credenciais de integração; guarde-a em local seguro)
- `JWT_SECRET` com pelo menos 32 caracteres
- `FRONTEND_URLS` com **todos** os domínios do frontend, separados por vírgula
- `GEMINI_API_KEY` e `GEMINI_MODEL` (Google Gemini) quando a NEXUS AI estiver habilitada
- `RESEND_API_KEY` e `EMAIL_FROM` para e-mails transacionais
- `INFINITEPAY_CHECKOUT_URL`, `TRIAL_DAYS` e `SUBSCRIPTION_PRICE` quando o checkout estiver configurado
- `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` para documentos

A lista completa e comentada está em `backend/.env.example`.

Depois:

```bash
cd backend
npm install
npm run prisma:generate
DATABASE_URL="$DIRECT_URL" npm run db:migrate   # migrações com o dono das tabelas
npm run build
npm start
```

O primeiro cadastro deve ser feito por `/auth/register-company`. O seed não cria dados fictícios.

## Frontend

Configure `NEXT_PUBLIC_API_URL` apontando para o backend público e execute:

```bash
cd frontend
npm install
npm run build
npm start
```

Navegação e visual: o menu do Dashboard antes só liberava 3 de 13 itens, e a maioria das telas de módulo (Estoque, Vendas, PDV, Financeiro, DRE, RH, IA, Importação, Ponto, Alertas, Pesquisa, Informação cruzada) usava só `style={{padding:20}}`, sem CSS e sem checar login. Isso foi corrigido:

1. **CSS padronizado**: `app/globals.css` agora define de fato as classes que Dashboard/Products/Admin já usavam (antes sem CSS correspondente). Todas as telas de módulo foram padronizadas com variáveis `--nx-*` em vez de cores hexadecimais fixas.

2. **Autenticação em todas as telas**: Todas as rotas de módulo agora possuem guarda de autenticação consistente via `app.authenticate` (type-safe, sem `as any`).

3. **Estados de carregamento/erro**: Todos os componentes agora exibem estados de loading e erro adequados.

4. **Menu ligado às rotas reais**: O menu agora reflete as rotas disponíveis — o "Fluxo" usa `GET /fluxo-caixa` (ver seção Fluxo de caixa).

5. **Remoção de duplicatas**: `/produtos`, `/usuários` e `/auditoria` eram duplicatas de `/products`/`/admin` e agora redirecionam para a versão canônica.

6. **Novas telas frontend**: As telas de Metas, Clientes, Fornecedores e Compras foram criadas do zero — os quatro já tinham backend completo (inclusive o fluxo Compra→Estoque→Custo→Financeiro), mas nenhum tinha frontend. Agora todas têm interfaces padronizadas.

## Novas funcionalidades de segurança e arquitetura

- **Rate limiting**: APIs públicas agora têm limite de 100 requests/minuto via `createRateLimiter` (`api-publica.routes.ts`).
- **Autenticação por rota**: cada rota privada declara `authenticate` (e a permissão do módulo) no `preHandler`.
- **Cálculo monetário e alçadas de desconto**: ficam em `backend/src/modules/vendas/vendas.routes.ts`.
- **Limpeza de 2026-11-20**: cópias `.bak`, saídas de build/teste e scripts avulsos foram removidos do repositório (continuam no histórico do Git).
- **Design system CSS**: Migração de cores fixas para variáveis `--nx-*` no `globals.css` (95% concluída).

## Control iD / iDClass

A integração de ponto usa somente a API oficial documentada pelo fabricante. O NEXUS executa login, leitura de `access_logs` e logout no equipamento. A senha da integração é armazenada criptografada no banco e nunca é retornada pela API.

O vínculo dos logs usa `user_id` do equipamento contra `Funcionario.idExternoPonto`. Os registros são agrupados por funcionário/data e as batidas são vinculadas, em ordem cronológica, aos quatro campos de ponto existentes no schema.

## PDV

O NEXUS não inventa integração de PDV. Sem um fornecedor, API/SDK/webhook ou banco oficialmente autorizado fornecido pelo proprietário, a integração permanece `NAO_CONFIGURADO` e a sincronização não simula dados.

## Recuperação de senha

`POST /auth/recuperar-senha` gera um token (hash SHA-256, validade de 1h, auditado), envia o link por e-mail via API HTTP da Resend (`backend/src/lib/email.ts`) e `POST /auth/redefinir-senha` consome esse token. O frontend tem as telas `/esqueci-senha` e `/redefinir-senha?token=...`. Para funcionar de verdade, configure `RESEND_API_KEY` e `EMAIL_FROM` no `.env` do backend (conta em resend.com, com domínio remetente verificado). Sem essa chave, o servidor loga um aviso e não envia nada — nunca finge sucesso.

## Snapshot diário de estoque (giro real)

O backend agenda sozinho a captura diária (`SNAPSHOT_AUTO_ENABLED=true` por padrão, horário em `SNAPSHOT_HOUR_UTC`) — não depende mais de cron externo, desde que o processo do backend fique rodando continuamente. Em hospedagem serverless, defina `SNAPSHOT_AUTO_ENABLED=false` e aponte um cron externo do provedor para `POST /estoque/snapshot/gerar` ou `npm run estoque:snapshot`.

## Empresa suspensa

`Empresa.status` (StatusGeral) controla o acesso de toda a empresa. Se `status != ATIVO`, o login e todo endpoint autenticado retornam 403, mesmo com um token ainda válido. Hoje nada altera esse campo automaticamente — é um gancho pronto para a Fase 3 (Assinatura/inadimplência) usar, não uma cobrança automática já ligada.

## Fluxo de caixa

`GET /fluxo-caixa` calcula entradas/saídas realizadas (lançamentos PAGO) e projeção de 30 dias (PENDENTES com vencimento no período) — nada fictício, tudo a partir do `Financeiro` real. Tela em `/fluxo`.

## Central de integrações

`GET /integracoes` reúne PDV, controle de ponto, IA (Google Gemini) e e-mail (Resend) num só lugar — status de IA/e-mail reflete se a credencial está configurada no `.env`, não se ela é válida (testar de verdade a cada carregamento gastaria uma chamada de API à toa). Tela em `/central-integracoes`, que também concentra a gestão de chaves da API pública.

## LGPD

`backend/src/modules/lgpd/lgpd.routes.ts` expõe exportação (`GET /lgpd/clientes/:id/exportar`, `/lgpd/funcionarios/:id/exportar`, `/lgpd/minha-conta/exportar`) e anonimização (`POST /lgpd/clientes/:id/anonimizar`, `/lgpd/funcionarios/:id/anonimizar`) de dados pessoais. É anonimização, não exclusão física — vendas e registros de ponto/férias continuam existindo (exigência fiscal/trabalhista), só os campos pessoais são apagados. Funcionário só pode ser anonimizado se já estiver desligado. Sem tela de frontend ainda — só os endpoints.

## API pública NEXUS

Chaves de API (`ChaveApi`, migração `202609131300_api_publica_chaves`) autenticam sistemas externos via `Authorization: Bearer <chave>`, separado do JWT de usuário. Gestão de chaves em `/api-publica/chaves*` (tela em `/central-integracoes`); 4 endpoints somente-leitura em `/api/v1/produtos`, `/estoque`, `/vendas`, `/clientes`, cada um isolado por empresa. É a fundação pedida pelo prompt ("preparar arquitetura para futuramente oferecer uma API própria"), não uma API pública madura — sem escrita, sem rate limit dedicado, sem webhooks de saída.

## Backup

`npm run backup` roda `pg_dump -F c` contra `DIRECT_URL` (ou `DATABASE_URL`, se ela não existir), salva em `BACKUP_DIR` (padrão `./backups`, já no `.gitignore`) e aplica retenção (`BACKUP_RETENCAO_DIAS`, padrão 30 dias). `npm run backup:restaurar -- <arquivo>` roda `pg_restore --clean --if-exists`. Não testado contra um Postgres real neste ambiente (sem banco/rede aqui) — rode uma vez em homologação antes de confiar em produção. Sem agendamento automático — decida a frequência e rode via cron do seu provedor.

## Atualização de 2026-11-21 (pilares de infraestrutura)

Antes ou junto do deploy do backend desta versão:

```bash
cd backend
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy        # migração 202611211000_pilares_infra (aditiva)
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/seguranca/01_rls_policies.sql   # RLS nas 2 tabelas novas
```

Documentação nova: `docs/BACKUP_E_RECUPERACAO.md`, `docs/CI_CD_E_DEPLOY.md`, `docs/OBSERVABILIDADE.md`,
`docs/ESCALABILIDADE_E_CARGA.md`, `docs/SEGURANCA_SESSOES_E_CREDENCIAIS.md` e `docs/PLANO_EVOLUCAO_DEPENDENCIAS.md`.

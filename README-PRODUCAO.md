# NEXUS OS — produção

## Backend

Configure:

- `DATABASE_URL`
- `JWT_SECRET` com pelo menos 32 caracteres
- `FRONTEND_URLS`
- `GEMINI_API_KEY` (Google Gemini) quando a NEXUS AI estiver habilitada
- `INFINITEPAY_CHECKOUT_URL` quando o checkout estiver configurado

Depois:

```bash
cd backend
npm install
npm run prisma:generate
npm run db:migrate
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

Navegação e visual: o menu do Dashboard antes só liberava 3 de 13 itens, e a maioria das telas de módulo (Estoque, Vendas, PDV, Financeiro, DRE, RH, IA, Importação, Ponto, Alertas, Pesquisa, Informação cruzada) usava só `style={{padding:20}}`, sem CSS e sem checar login. Isso foi corrigido: `app/globals.css` agora define de fato as classes que Dashboard/Products/Admin já usavam (antes sem CSS correspondente), todas as telas de módulo foram padronizadas com guarda de autenticação e estados de carregamento/erro, e o menu foi ligado às rotas reais — só "Fluxo" segue desabilitado, pois não existe endpoint de fluxo de caixa no backend ainda. `/produtos`, `/usuarios` e `/auditoria` eram duplicatas de `/products`/`/admin` e agora redirecionam para a versão canônica. As telas de Metas, Clientes, Fornecedores e Compras foram criadas do zero — os quatro já tinham backend completo (inclusive o fluxo Compra→Estoque→Custo→Financeiro), mas nenhum tinha frontend.

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

`npm run backup` roda `pg_dump -F c` contra `DATABASE_URL`, salva em `BACKUP_DIR` (padrão `./backups`, já no `.gitignore`) e aplica retenção (`BACKUP_RETENCAO_DIAS`, padrão 30 dias). `npm run backup:restaurar -- <arquivo>` roda `pg_restore --clean --if-exists`. Não testado contra um Postgres real neste ambiente (sem banco/rede aqui) — rode uma vez em homologação antes de confiar em produção. Sem agendamento automático — decida a frequência e rode via cron do seu provedor.

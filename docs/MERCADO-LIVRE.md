# Mercado Livre — Integração OAuth 2.0 (Central de Integrações)

Estado atual: **infraestrutura completa e testada; ativação pendente das
credenciais oficiais do aplicativo no Mercado Livre.**

Enquanto as 3 variáveis obrigatórias não estiverem no `.env` do backend, o
NEXUS OS **recusa** iniciar o fluxo (não fabrica URL de autorização, não marca
conta como conectada e a Central mostra o card como “aguardando credenciais no
servidor”). Isto é intencional: ausência de credenciais nunca pode aparecer
como conexão bem-sucedida.

## O que já existe e é coberto por testes

- `POST /integracoes/mercadolivre/conectar` — inicia o OAuth: grava `state`
  (nonce aleatório de 24 bytes/192 bits em base64url, validade de 10 minutos,
  consumo atômico de uso único) e devolve a authUrl oficial
  (`auth.mercadolivre.com.br/authorization`, `response_type=code`, escopo
  `offline_access read write`).
- `GET /integracoes/mercadolivre/callback` — rota PÚBLICA (o browser volta do
  ML sem sessão NEXUS): valida o `state`, troca o `code` por tokens no endpoint
  oficial, confere a conta em `/users/me` e só então grava `CONECTADO`.
  **Sempre redireciona** para a Central (`?ml=conectado|erro&motivo=...`) —
  nunca devolve JSON de erro com detalhe interno, mesmo com query malformada.
- `POST /integracoes/mercadolivre/testar` — valida o token gravado contra
  `/users/me` (sem rede externa não há sucesso).
- `DELETE /integracoes/mercadolivre` — apaga os tokens e audita a operação.
- `GET /integracoes/mercadolivre` — estado da conta + `configuradoAmbiente`
  (booleano: o servidor tem as 3 variáveis?). A resposta nunca carrega token,
  segredo nem valor de credencial.
- `GET /integracoes` (Central) — item `MERCADO_LIVRE` com `status`,
  `configurado` e `configuradoAmbiente`, para a UI distinguir “aguardando
  credenciais no servidor” de “desconectado”.
- Renovação de token com trava de concorrência (uma única chamada ao
  `/oauth/token` mesmo com requisições simultâneas) e `invalid_grant`
  mapeado para `REAUTENTICAR` — nunca para sucesso mascarado.
- Tokens e credenciais gravados cifrados em repouso (AES-256-GCM, chave
  derivada do `JWT_SECRET`); logs do Fastify redigem `code`/`state`; a
  mensagem de erro exibida na tela também redige esses parâmetros.
- Três rotas de sincronização manual (produtos, estoque, pedidos) e um
  webhook público de notificações validadas por consulta autenticada —
  ver seção própria abaixo.

## Sincronização (Etapas 2–4) e webhook — IMPLEMENTADA E TESTADA

Estado: **implementada e coberta por testes automatizados** com servidor da
API simulado localmente (override `MERCADOLIVRE_API_URL`); a validação com uma
conta real do ML segue pendente das credenciais oficiais do aplicativo.

Rotas (sessão + permissão `integracoes:editar`, exceto o webhook):

| Rota | O que faz |
| --- | --- |
| `POST /integracoes/mercadolivre/sync/produtos` | ETAPA 2: espelha o catálogo da conta (`GET /users/{id}/items/search` + `GET /items/{id}`) em produtos `ML-*` (`origem=INTEGRACAO`, custo **nunca** vem do ML). Anúncio que some da listagem **não apaga** produto interno. Body opcional `{ limiteAnuncios }` (padrão 100, teto 1000). |
| `POST /integracoes/mercadolivre/sync/estoque` | ETAPA 3: envia saldo da filial do NEXUS para anúncios `ML-*`. Antes de publicar, bloqueia a tarefa se a última importação de pedidos tiver falhas, para não repor no ML um saldo possivelmente desatualizado. Anúncios pausados, com variações ou sem saldo aplicável são ignorados. |
| `POST /integracoes/mercadolivre/sync/pedidos` | ETAPA 4: importa pedidos como vendas `origem=INTEGRACAO` com idempotência em duas camadas. Pedidos ativos debitam estoque na mesma transação; cancelamento devolve o saldo uma vez. Valores diferentes de BRL são recusados. Caixa e financeiro ainda não são conciliados. Body: `{ filialId, limite? }` (padrão 50, teto 500). |
| `POST /integracoes/mercadolivre/webhook` | Público. O Mercado Livre não envia assinatura HMAC nesse webhook tradicional; não configure `MERCADOLIVRE_WEBHOOK_SECRET`. A aplicação confere `application_id` quando fornecido, resolve a conta por `user_id`, persiste o evento numa fila durável e responde HTTP 200. O consumidor automático reconsulta o recurso com o token próprio, deduplica por ID (`id`/`_id`), aplica retry com backoff e recupera leases após reinício. Pedidos, pagamentos (`/collections/{id}`) e anúncios são aceitos. |

Garantias comuns:

- Todo caminho externo passa por `chamarML`: retentativa com backoff (429 com
  `Retry-After`, 5xx, falha de rede → 502), renovação de token **uma única**
  vez em 401, HTTP 206 tratado como sucesso (corpo incompleto nunca vira dado
  inventado — é registrado para retentativa).
- Cada sincronização grava `Importacao` (com `origem=INTEGRACAO`), auditoria
  `SINCRONIZAR` e atualiza `ultimoSyncEm`/`erros` do cadastro na Central.
- Execuções simultâneas da mesma operação na mesma empresa compartilham uma
  única execução (trava em processo) — duas telas não disparam dois syncs.
- Convenções do webhook (o `IntegracaoExterno` não guarda filial/usuário):
  destino = filial **ATIVA mais antiga** da empresa; operador de referência =
  usuário **ATIVO mais antigo** (necessário para a FK obrigatória de
  `Importacao.usuarioId`).

## Agendador automático persistente — IMPLEMENTADO E TESTADO

Os webhooks usam a tabela `NotificacaoMercadoLivre` como fila durável. A rota
retorna após persistir o evento; o agendador consome até 20 eventos por ciclo,
com lease de 15 minutos e backoff crescente (até 30 minutos). Antes de ativar
esta versão em produção, aplique a migration
`202610181000_fila_webhook_mercadolivre` com `npm run db:migrate` e gere o
cliente Prisma com `npm run prisma:generate` durante o build/deploy.

O sync manual continua disponível; em paralelo, um **agendador interno**
executa as mesmas Etapas 2–4 automaticamente para toda conta `CONECTADO`,
sem clique e sem cron externo.

- **Estado no banco, não em memória**: tabela `SincronizacaoTarefa`
  (migração `202610130900_criar_sincronizacao_tarefa`), uma linha por
  `(empresaId, tipo)` — `MERCADO_LIVRE_PRODUTOS`, `MERCADO_LIVRE_ESTOQUE`,
  `MERCADO_LIVRE_PEDIDOS`. A máquina de estados é
  `AGUARDANDO → EXECUTANDO → AGUARDANDO` (ou `PAUSADA` para conta
  desconectada/erro permanente). **Restart não perde nada**: a agenda inteira
  (`proximaExecucaoEm`, `tentativas`, `ultimoErro`) vive no Postgres.
- **Despertador é só o alarme**: loop recursivo de `setTimeout` (sem
  `setInterval` — um erro de tick nunca mata o ciclo) com jitter de ±20% para
  não sincronizar instâncias; cada ciclo chama `executarTickML()`, que
  (1) desengata órfãs (`EXECUTANDO` com `leaseExpiraEm` vencido = processo
  caiu → volta `AGUARDANDO` com execução **imediata** e incrementa
  `recuperadas`), (2) pega até 10 vencidas na fila e (3) executa cada uma.
- **Trava atômica multi-instância**: a tomada é um `updateMany`
  (`status=AGUARDANDO AND proximaExecucaoEm<=agora` → `EXECUTANDO` +
  `leaseExpiraEm` + `instanciaId`) e só executa quem receber **count = 1** —
  duas réplicas processando o mesmo ciclo nunca duplicam chamada à API nem
  venda. Lease padrão 15 min (`ML_SYNC_LEASE_MIN`). Em cima disso, a trava
  em processo do sync manual (`executarComTravaDeSync`) impede colisão entre
  agendador e um disparo manual da mesma operação.
- **Períodos** (minutos, ajustáveis por env): produtos 360
  (`ML_SYNC_PRODUTOS_MIN`), estoque 15 (`ML_SYNC_ESTOQUE_MIN`), pedidos 5
  (`ML_SYNC_PEDIDOS_MIN`); ciclo base do timer 30 s (`ML_SYNC_TICK_MS`,
  mínimo 1000 ms). **Kill-switch**: `ML_SYNC_AUTO=false` desliga o
  agendador sem mudar código.
- **Retentativas com backoff exponencial** na própria tarefa:
  `2^(tentativa-1) × ML_SYNC_BACKOFF_BASE_S` (padrão 30 s), teto
  `ML_SYNC_BACKOFF_MAX_MIN` (padrão 60 min). Erros **permanentes**
  (400/401/403/404) → `PAUSADA` sem consumir tentativa; **429** respeita
  `Retry-After` (absorvido pelo cliente, sem contar falha); 5xx/rede →
  backoff. Sucesso zera `tentativas` e limpa `ultimoErro`.
- **Integração com o restante**: no boot (`server.ts`) o agendador
  provisiona as contas já conectadas; ao concluir OAuth, o callback de
  conexão provisiona/reativa as 3 tarefas da empresa. Toda execução grava
  `Importacao` + auditoria como o sync manual — os serviços são os mesmos.
  Conta desconectada pausa as tarefas (nenhuma chamada à API) e a reconexão
  as devolve a `AGUARDANDO`.
- **Observabilidade**: `GET /integracoes/mercadolivre/sync/agendamento`
  (sessão + permissão `integracoes:visualizar`, escopo da própria empresa)
  retorna `ativo`, `instancia`, períodos, resumo (`pendentes`, `executando`,
  `pausadas`, `comFalha`, `recuperadas`) e as tarefas com status, próxima
  execução, último sucesso, processados/falhas da última, tentativas e
  `ultimoErro` **redigido** (motivo + data, sem token/secret).
- **Relação com o webhook**: mecanismos complementares e idempotentes —
  webhook entrega eventos quase em tempo real; o periódico cobre eventos
  perdidos e divergências antigas. O dedupe é garantido pelas chaves de
  idempotência (`ml:order:{id}`, `ml:notificacao:{topic}:{resource}`), não
  pelo agendador.



1. Em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br),
   crie/abra seu aplicativo (tipo OAuth) e anote **Client ID** e
   **Client Secret**.
2. Cadastre a **Redirect URI** exatamente igual à variável de ambiente:
   - desenvolvimento: `http://localhost:3333/integracoes/mercadolivre/callback`
   - produção: `https://<seu-backend>/integracoes/mercadolivre/callback`
3. Preencha no `backend/.env` (os valores NUNCA são exibidos na interface):

   ```dotenv
   MERCADOLIVRE_CLIENT_ID=<client_id_do_app>
   MERCADOLIVRE_CLIENT_SECRET=<client_secret_do_app>
   MERCADOLIVRE_REDIRECT_URI=http://localhost:3333/integracoes/mercadolivre/callback
   ```

4. Reinicie o backend. O card Mercado Livre na Central de Integrações deve
   mostrar “pronto para autorizar” (o botão “Conectar” deixa de ficar
   desabilitado).
5. Clique em **Conectar**, autorize a aplicação na tela do Mercado Livre e
   espere o retorno para a Central (`?ml=conectado`).
6. Confirme com **Testar** (chamada real a `/users/me`).


## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `MERCADOLIVRE_CLIENT_ID` | Sim | Client ID do aplicativo no ML Developers |
| `MERCADOLIVRE_CLIENT_SECRET` | Sim | Client Secret do aplicativo |
| `MERCADOLIVRE_REDIRECT_URI` | Sim | Deve bater **exatamente** com a URI cadastrada no app |
| `MERCADOLIVRE_AUTH_URL` | Não | Override do endpoint de autorização (padrão: `https://auth.mercadolivre.com.br/authorization`) |
| `MERCADOLIVRE_TOKEN_URL` | Não | Override do endpoint de troca de token (padrão: `https://api.mercadolibre.com/oauth/token`) — usado pelos testes com servidor local simulado |
| `MERCADOLIVRE_USER_URL` | Não | Override do endpoint de conta (padrão: `https://api.mercadolibre.com/users/me`) |
| `MERCADOLIVRE_API_URL` | Não | Host da API para as chamadas autenticadas (padrão: `https://api.mercadolivre.com`) — usado **apenas** pelos testes com servidor local simulado |
| `ML_SYNC_BACKOFF_MS` | Não | Backoff inicial entre retentativas do `chamarML` (padrão: `250`) — testes usam `5` |

## Fluxo por conta (IntegracaoExterno.status)

| Status | Significado |
| --- | --- |
| `CONECTANDO` | Cadastro criado; aguardando autorização/callback no ML |
| `CONECTADO` | Tokens validados em `/users/me` e gravados |
| `EXPIRADO` | Callback com `state` vencido ou sem renovação possível |
| `REAUTENTICAR` | Renovação falhou com `invalid_grant` — usuário precisa reconectar |
| `ERRO` | Falha reportada durante a operação |
| `REVOGADO` | Conta desvinculada pela Central (tokens apagados) |

Na Central, `CONECTADO` vira “CONECTADO”; `EXPIRADO`/`REAUTENTICAR`/`ERRO`
viram “ERRO”; o restante vira “NÃO CONFIGURADO” (nunca “conectado”).

## O que ainda depende de uma conta real

- Autorizar de verdade a tela do ML e receber o `code` no callback.
- Troca `code → tokens` contra o endpoint oficial.
- Validação da conta em `/users/me` e gravação do `accountId`/`accountName`.
- Renovação real do `refresh_token` (expiração de ~6h; verificado com servidor
  local simulado, não com o ML de produção).
- Sincronização de anúncios, produtos, estoque e pedidos: **código completo e
  testado com servidor simulado** — falta apenas rodar uma vez contra uma
  conta real (pendente das credenciais oficiais).
- Confirmar o recebimento do webhook em produção (URL pública HTTPS
  cadastrada no app do ML) e o formato exato dos `topic` notificados pela
  conta real.

## Limitações conhecidas

- A trava de renovação concorrente é por processo (`Map` em memória): com
  múltiplas instâncias do backend, cada instância pode disparar uma renovação.
- A trava anti-corrida das sincronizações também é por processo; o **dedupe**
  de webhook e de importação de pedidos usa `IdempotencyKey`/`Venda` no banco,
  então vale entre instâncias.
- As rotas manuais continuam disponíveis para administração, mas produtos, estoque e pedidos também são executados automaticamente pelo agendador persistente descrito acima.
- Estoque: anúncio **com variações** tem a quantidade por variação fora do
  escopo (o sync não envia nada e registra o motivo no relatório).
- Pedidos: moeda diferente de BRL continua sem conversão. Pedidos ativos debitam o estoque interno com movimento idempotente; cancelamentos retornam o saldo uma vez. Caixa e financeiro ainda não recebem conciliação automática.
- Webhook: a fila é durável e recuperável, mas compartilha a disponibilidade
  do PostgreSQL e do processo do agendador. Uma indisponibilidade do banco na
  entrada retorna HTTP 503 para o Mercado Livre reenviar; falha de API após o
  aceite recebe retry interno com backoff.
- Sem as 3 variáveis obrigatórias, o botão “Conectar” fica desabilitado e o
  card avisa “aguardando credenciais no servidor” — é o estado esperado, não
  uma falha.

## Testes

- Backend: `backend/tests/integracoes.test.ts` (OAuth, state, callback,
  criptografia em repouso, redação de logs, isolamento por tenant, renovação
  concorrente, `invalid_grant`, sem-credenciais-nunca-conecta). Os mocks
  (env simulada, servidor local de token) existem **apenas** nos testes.
- Backend: `backend/tests/mercadolivre-sync.test.ts` (55 asserções contra um
  servidor simulado da API via `MERCADOLIVRE_API_URL` + `ML_SYNC_BACKOFF_MS=5`):
  permissões/validação das rotas sync; ETAPA 2 (espelhagem, Importacao,
  Auditoria, idempotência, retentativa de 500); ETAPA 3 (PUT com saldo NEXUS,
  baixa de pedidos idempotente, pula manual/sem linha, segunda execução sem PUT novo);
  ETAPA 4 (venda única idempotente em duas camadas, USD recusado, desfecho
  `CONFIRMADA`); webhook (re-consulta com token próprio, dedupe, tenant por
  `user_id`, pedido novo importado por notificação); rede fora do ar → 502 com
  Importacao `ERRO`.
- Backend: `backend/tests/mercadolivre-agendador.test.ts` (68 asserções em 16
  seções contra o servidor simulado): autostart e provisionamento idempotente;
  processamento automático (produtos espelhados, pedidos BRL→venda e USD
  recusado, estoque empurrado e movimentos de venda idempotentes); recuperação de execução
  órfã (`leaseExpiraEm` vencido) com `recuperadas` e sem duplicar; agenda
  preservada em restart; duas instâncias concorrentes → exatamente UMA
  execução; webhook repetido deduplicado; backoff de tarefa após 500;
  429 com `Retry-After` aguardado; conta desconectada → `PAUSADA` sem
  chamadas à API e reativação na reconexão; isolamento entre empresas;
  idempotência cruzada webhook × periódico × manual; pendências sobrevivendo
  a restart; loop recursivo executando sozinho; rota de observabilidade
  (401/403/escopo/sem segredos).
- Frontend: `frontend/tests/central-integracoes-erros.test.ts` (mensagens de
  erro seguras e redação de `code`/`state` antes de exibir).

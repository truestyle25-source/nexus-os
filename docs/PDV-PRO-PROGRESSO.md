# NEXUS OS — PDV PRO · Progresso de Implementação

> Roadmap faseado. Cada fase só avança após: implementar → testar no PostgreSQL real → revisar. Layout visual preservado (nenhuma tela redesenhada).

## Status

| Fase | Escopo | Estado |
|------|--------|--------|
| FASE 1 | Banco + núcleo transacional | ✅ CONCLUÍDA (aplicada no PostgreSQL real) |
| FASE 2 | Backend: idempotência, pagamento misto, alçadas | ✅ CONCLUÍDA (teste real passando) |
| FASE 3 | Persistência local (Dexie, catálogo, Sync Queue) | ✅ CONCLUÍDA (testes locais + PostgreSQL real; typecheck/build aprovados) |
| FASE 4 | Sincronização e reconciliação | ✅ CONCLUÍDA (retry idempotente validado; WebSocket avaliado e não necessário no fluxo síncrono atual) |
| FASE 5 | Infra assíncrona (Redis/BullMQ somente se necessária) | ✅ CONCLUÍDA (auditoria: não há job assíncrono de PDV que justifique fila no servidor) |
| FASE 6 | Hardware Bridge (impressão, gaveta, leitor, balança) | 🔄 PARCIAL (cupom e leitor teclado cobertos; ponte física depende do hardware real) |
| FASE 7 | Fiscal/TEF (somente integrações reais) | 🔄 PARCIAL (mock PIX removido e operação bloqueada sem provider oficial; Fiscal/TEF dependem de fornecedor homologado) |
| FASE 8 | Bateria completa de testes | ✅ CONCLUÍDA (frontend, PostgreSQL e dependências diretas) |
| FASE 9 | Segunda auditoria independente | ✅ CONCLUÍDA (código, endpoints, estados, permissões e integrações revisados) |

---

## FASE 1 — Banco + núcleo transacional ✅

**Migration:** `202610070900_pdv_pro_fase1_nucleo` — **aplicada** no PostgreSQL (confirmação via `prisma migrate status`).

Adições incrementais ao schema (nada removido, nada existente quebrado):

- `Filial.timezone` + `Filial.dataOperacional` — data operacional por fuso da filial.
- `Caixa.numero` — caixa numerado para multi-caixa (até 10 simultâneos).
- `MovimentacaoCaixa.vendaId` — liga movimentação à venda (rastreio de estorno).
- `Venda.idempotencyKey`, `Venda.dataOperacional`, `Venda.descontoAutorizadoPor`, `Venda.motivoDesconto`.
- **Novos modelos:**
  - `IdempotencyKey` — `@@unique([empresaId, key])`, status PROCESSANDO/CONFIRMADA/REJEITADA, guarda `responseBody`.
  - `VendaPagamento` — pagamento misto (várias formas por venda).
  - `EstoqueReserva` — reserva de estoque com expiração (base para offline/concorrência).
  - `DivergenciaCaixa` — divergências de fechamento (esperado vs informado), ABERTA/JUSTIFICADA/RESOLVIDA.

**Helpers criados:** `backend/src/lib/fuso.ts` (data operacional por timezone), `backend/src/lib/idempotencia.ts`.

---

## FASE 2 — Backend transacional ✅

**Arquivo alterado:** `backend/src/modules/vendas/vendas.routes.ts` (rota `POST /vendas`).
**Helpers usados:** `idempotencia.ts` (adquirir/concluir).

Três pilares, todos validados no backend (nunca confiando só no frontend):

1. **Idempotência** — `X-Idempotency-Key` (ou `idempotencyKey` no body). Mesma chave = mesma venda.
   - Chave adquirida fora da transação; corrida tratada via P2002 (unique violation) → devolve desfecho original.
   - Sucesso grava `CONFIRMADA` + `responseBody`; falha grava `REJEITADA`. Retry com a mesma chave NUNCA cria segunda venda.

2. **Pagamento misto** — array opcional `pagamentos: [{forma, valor, referencia}]`.
   - A soma precisa bater **exatamente** com o total (tolerância 0,001), senão 422.
   - Cada parcela gravada em `VendaPagamento`. Só o valor em **DINHEIRO** credita a gaveta do caixa (antes creditava `total` inteiro).

3. **Alçada de desconto** — `ALCADAS_DESCONTO` no backend (fonte única, não no frontend):
   - 0–10% operador · 10–30% supervisor · 30–100% gerente.
   - Desconto acima da faixa do usuário → 403. Validado **dentro** da transação.

**Compatibilidade:** sem `pagamentos` e sem header de idempotência, a rota se comporta exatamente como antes (aba Vendas e PDV atual seguem funcionando).

### Evidência de teste (PostgreSQL real)

`backend/tests/pdv-fase2-venda.test.ts` (gate: `RUN_PDV_DB_TEST=1`):

```
✔ PDV PRO FASE 2: idempotência, pagamento misto e alçada de desconto no PostgreSQL real
  pass 1 · fail 0   (repetível: 2ª execução também pass 1/fail 0)
```

- Cria produto+estoque temporários, executa os 3 cenários, limpa tudo no `finally`.
- Idempotência: `POST /vendas` + retry mesma chave → mesmo `venda.id`, 1 venda só.
- Pagamento misto: 30 dinheiro + 70 PIX = 100 → 2 linhas `VendaPagamento`.
- Alçada: desconto 40% com permissões de desconto desabilitadas → 403, 0 vendas gravadas.
- **Regressão:** `vendas-filtros.test.ts` + `pix.test.ts` → **18 pass, 0 fail**.
- `tsc --noEmit` limpo.

### Utilitário de limpeza (uso manual/excepcional)

`backend/limpar-residuos-pdv.ts` — remove vendas/produtos de teste (`PDV-FASE2-*`) e IdempotencyKeys órfãs. **Não faz parte do app**; existe para restaurar estado limpo do banco de dev.

---

## Regras respeitadas

## FASE 4 — Retry e reconciliação

- O backend expõe `GET /vendas/idempotencia/:key`, limitado à empresa e ao operador autenticado. Retorna somente status, ID da venda, status HTTP original e atualização; não expõe o corpo armazenado da venda.
- A fila consulta o registro após timeout, conflito ou resposta de sucesso sem ID. `CONFIRMADA` confirma localmente, `PROCESSANDO` permanece pendente de retry, `REJEITADA` exige revisão, e chave ausente permite repetir usando a mesma chave.
- Retry transitório tem backoff exponencial até 60 segundos; não repete imediatamente em cada evento `online`/retorno à aba.
- Testes: 14 testes frontend passaram; os testes PostgreSQL reais da Fase 2 (venda/idempotência) e Fase 4 (status e isolamento) passaram.
- **WebSocket:** não foi conectado. O fluxo de venda é síncrono e não há trabalho assíncrono do servidor que precise emitir eventos; adicionar um canal sem consumidor/necessidade real aumentaria a superfície sem resolver um fluxo existente. A sincronização continua acionada por reconexão e retorno à aba.

## FASE 5 — Auditoria de infraestrutura assíncrona

- O fluxo de venda do PDV é síncrono: `POST /vendas` valida, grava no PostgreSQL e devolve o resultado na mesma requisição. Não há worker/job de PDV no backend.
- A Sync Queue existente fica no IndexedDB do navegador e envia por HTTP quando há conexão; retry, chave estável e reconciliação foram cobertos na Fase 4.
- A rota de integração do PDV responde explicitamente que não há fornecedor oficial configurado e não simula sincronização.
- O único scheduler do backend encontrado executa snapshots de estoque e fechamento de expediente; não pertence ao PDV e não foi alterado.
- Redis/BullMQ não foram adicionados: não existe trabalho assíncrono real do PDV para consumir a fila. Não houve alteração de schema ou persistência nesta fase.
- **Revisão:** busca no backend inteiro por Redis, BullMQ, workers, jobs e temporizadores; conferência das rotas de venda/integração e da fila local. Resultado: arquitetura coerente com processamento síncrono, sem endpoint falso nem novo serviço a configurar.

## FASE 6 — Auditoria de hardware

- **Impressão:** `window.print()` usa o diálogo padrão do navegador; não existe SDK ESC/POS, serviço de impressão local ou seleção programática de impressora. Corrigido o atalho do menu: agora reabre o cupom da última venda finalizada persistida no turno. O botão do modal imprime apenas a área do cupom não fiscal.
- **Leitor:** leitores em modo teclado funcionam pelo campo focado e Enter; a consulta busca primeiro código de barras/SKU no catálogo local e então usa a sincronização existente. Não há integração WebUSB/WebHID/WebSerial.
- **Gaveta física e balança:** não há comando/protocolo implementado. Os valores de gaveta existentes são apenas o registro contábil do caixa. Não foi acionado hardware.
- **TEF/SAT:** continuam indisponíveis sem SDK/API oficial configurada; o fluxo de cartão permanece bloqueado.
- **Validação:** 16 testes frontend passaram, incluindo reconstrução de cupom a partir da venda persistida; build Next.js e typecheck passaram. Não há dispositivo físico/modelo informado para validar impressão térmica, corte, gaveta ou balança.
- **Status:** fase ainda parcial. Para concluir a ponte física, é necessário o modelo/fabricante de cada dispositivo e o ambiente/protocolo oficial de integração. Layout original preservado.

## Rodada auditoria independente — correções aplicadas (FASE 1)

**Arquivos alterados:**
- `backend/src/modules/vendas/vendas.routes.ts` — replay de chave duplicada reproduz o status HTTP original; criação responde **201**; chave CONFIRMADA persiste `responseStatus: 201`; extração de status de erro usa `e.status ?? e.statusCode ?? 500`.
- `backend/src/lib/idempotencia.ts` — reconciliação de chave `PROCESSANDO` presa (TTL 15 min + verificação da venda vinculada; nunca apaga chave nem duplica venda), aplicada nos dois caminhos de aquisição (leitura rápida e corrida P2002).
- `frontend/lib/pdv/enviarOperacao.ts` — HTTP 401 não é mais definitivo (sessão expirada retenta com a mesma chave após novo login).
- `frontend/lib/pdv/syncQueue.ts` — removida comparação redundante de tipo (typecheck).
- `backend/tests/pdv-fase2-venda.test.ts` — asserções apertadas para 201 estrito na criação e no replay.
- `frontend/tests/pdv-reconciliacao.test.ts` — novo teste: 401 não é definitivo, mantém a mesma chave.

**Testes executados:**
- Frontend `tests/pdv-reconciliacao.test.ts` + fila: **17/17 passando**.
- Backend `tsc --noEmit`: limpo. Frontend `tsc --noEmit`: limpo.
- Backend `pdv-fase2-venda.test.ts` (PostgreSQL real): **passando** (criação 201, replay 201, pagamento misto, alçada 403).
- Backend `pdv-fase4-reconciliacao.test.ts` + `pdv-fase3-catalogo.test.ts`: **2/2 passando**.
- `pdv-fluxo-caixa.test.ts` / `pdv-concorrencia.test.ts`: **não executáveis** neste banco — dependem de fixtures `pdv-audit-test-*` inexistentes (pré-existente, não causado por estas mudanças).

**Pendências desta rodada:** FASE 2 (política offline explícita no código) em diante.

## Rodada auditoria independente — FASE 2 (operação offline)

**Arquivos criados/alterados:**
- `frontend/lib/pdv/politicaOffline.ts` (novo) — fonte única da política: só `DINHEIRO` pode ser enfileirado offline; `PIX`/`CARTAO_*`/`BOLETO`/outros são bloqueados com motivo explícito. `avaliarVendaOffline` cobre pagamento misto (`pagamentos[]`) e forma única.
- `frontend/lib/pdv/index.ts` — exporta o módulo.
- `frontend/app/(dashboard)/pdv/page.tsx` — barreira offline ANTES de enfileirar (usa `estaOnline()` + `backendAlcancavel()`, que a página já usava): sem backend, PIX/cartão mostram o motivo e nem entram na fila. Sem mudança de layout — só a mensagem de erro existente.
- `frontend/tests/pdv-politica-offline.test.ts` (novo) — 3 testes da política.

**Decisão arquitetural registrada:** tentei primeiro a barreira dentro de `enviarOperacaoPdv`, mas ela refazia checagem de rede que o chamador já fez e quebrava a testabilidade (health real fora do mock). Revertida — a barreira vive só na página, que detém o contexto online/offline real. Comportamento restante: PIX/cartão com backend ONLINE seguem para o 503 definitivo do backend (sem provider); dinheiro offline sincroniza ao voltar com a mesma chave.

**Testes executados:** frontend `npm test` completo — **20/20 passando** (16 anteriores + 3 política + 1 do 401 da FASE 1). `tsc --noEmit` frontend limpo.

**Pendências desta rodada:** FASE 3 (concorrência entre caixas) em diante.

## Rodada auditoria independente — FASE 3 (concorrência entre caixas)

**Arquivos criados:** `backend/tests/pdv-fase3-concorrencia.test.ts` (novo) — 10 `POST /vendas` simultâneos (`Promise.all`) disputando 1 unidade, cada um com sua chave idempotente. Fixtures próprias + cleanup no finally (padrão FASE 2). Sem `caixaId`: isola a concorrência de ESTOQUE.

**Resultado executado (3/3 estável):** exatamente 1 sucesso (201) + 9 rejeitados (400/409/422, nunca 500); estoque final 0 (nunca negativo); 1 venda, 1 financeiro PAGO, 1 baixa de estoque. Barreira real: `aplicarMovimento` (`updateMany` condicional) + pré-checagem 422 da venda. O TOCTOU da pré-checagem é benigno — o `updateMany` é a fonte normativa.

**Regressão:** fase2 + fase3-catálogo + fase4 — 3/3 passando. `tsc --noEmit` backend limpo. Nenhum código de produção alterado nesta fase (só teste novo).

**Pendências desta rodada:** FASE 4 (fuso horário) em diante.

## FASE 7 — Fiscal, PIX e TEF

- O backend usava `MockPixProvider`, que sempre respondia `PENDENTE`. Removido o mock: sem PSP/banco oficial configurado, consultar ou gerar cobrança retorna HTTP 503 explícito.
- A configuração agora reporta `providerConfigured: false`, nunca apresenta PIX como ativo, bloqueia ativação sem provider e mantém a chave criptografada sem habilitar cobrança.
- A tela de PIX não promete recebimento/baixa automática e oferece saída clara quando a cobrança está indisponível. O teste PostgreSQL comprovou que tentativas de gerar/consultar sem provider retornam 503 e não criam `PixCobranca`.
- **TEF/cartão:** o PDV já bloqueia cartão sem integração oficial; nenhuma venda é gravada. **Fiscal:** o cupom do PDV continua identificado como não fiscal; não há emissor/SEFAZ/SDK fiscal no backend. O módulo Fiscal Brasil separado contém dados de demonstração e não foi alterado nesta fase do PDV.
- **Validação:** teste de integração no PostgreSQL: `plataforma.test.ts` — 21 asserções passaram, incluindo isolamento e ausência de gravação; `configuracoes.test.ts` — 47 passaram; `pix.test.ts` — 5 passaram. TypeScript/build do backend e typecheck do frontend passaram; build Next.js executado nesta fase.
- **Status:** fase ainda parcial até existir/configurar fornecedor PIX oficial e integração fiscal/TEF autorizada. Não foram inventadas credenciais, endpoints ou respostas de pagamento.

## FASE 8 — Bateria completa de testes ✅

- Frontend PDV: **16 testes passaram** (fila offline/idempotente, hardware/cupom, persistência local e reconciliação).
- PostgreSQL real: venda/idempotência (**1 teste**), catálogo (**1**), reconciliação (**1**), integrações/PIX sem provider (**21 asserções**) e configuração/persistência/permissões (**47 asserções**) passaram.
- Regressões e dependências diretas: PIX (**5 testes**), filtros de vendas (**13**), catálogo de permissões (**5**), estoque/inventário (**59 asserções**) e fluxo de caixa (**24 asserções**) passaram.
- Os testes de banco foram executados sequencialmente. Cenários de configuração verificaram gravação e releitura no PostgreSQL; cenário PIX comprovou resposta 503 e ausência de cobrança gravada sem provider.
- Build TypeScript do backend, build de produção Next.js e `tsc --noEmit` do frontend passaram. O Next.js mostrou aviso não fatal de cache webpack ao resolver dependências; a compilação e geração das 37 páginas terminaram com sucesso.

## FASE 9 — Segunda auditoria independente ✅

- Revisados novamente os formulários e ações do PDV, fila/local DB, envio e reconciliação, endpoints de venda, catálogo, caixa, integração e PIX, autenticação/permissões, validação e respostas de erro.
- Confirmado que `/health` está registrado, que as chamadas de catálogo e caixa correspondem a rotas existentes e que a sincronização externa responde explicitamente com bloqueio quando não há fornecedor oficial.
- A fila offline persiste antes do envio, preserva a chave idempotente e só marca venda confirmada após resposta/reconciliação do backend. Não foram encontrados mocks ativos na operação PDV auditada.
- Não foi necessário alterar código durante as Fases 8 e 9; portanto não houve mudança de layout nem nova alteração de dados de negócio.
- **Limites remanescentes:** PIX/TEF/fiscal dependem de fornecedores e credenciais oficiais; impressão física, gaveta e balança dependem dos modelos/protocolos informados. Esses limites já estão documentados nas Fases 6 e 7.

## Regras respeitadas

- **Layout visual intacto** — nenhuma tela redesenhada, nenhum botão removido.
- **PostgreSQL é a fonte da verdade** — venda confirmada só existe após COMMIT.
- **Nada removido** — todas as mudanças são aditivas/incrementais.
- **Concorrência** — baixa de estoque segue via `aplicarMovimento` (updateMany condicional, nunca negativo).

## Próximo passo

**Dependências para concluir as Fases 6 e 7:** modelos/protocolos do hardware e contratos/credenciais de provedores PIX, fiscal e TEF homologados. As Fases 8 e 9 estão concluídas.

## Auditoria geral complementar — 08/10/2026

Esta revisão complementar corrige a avaliação anterior: os testes de API e banco não equivalem a uma validação visual ponta a ponta, e a aba PDV não deve ser considerada integralmente concluída enquanto as dependências abaixo estiverem abertas.

- **Problemas corrigidos nesta rodada:** persistência de `Venda.dataOperacional` conforme fuso da filial; filtros de vendas por data operacional; confirmação de idempotência dentro da mesma transação da venda; bloqueio no backend de PIX/cartão sem provider; identificação da origem PDV; cálculo de pagamentos mistos no resumo e devolução da parcela em dinheiro ao cancelar.
- **Fluxo validado:** abrir caixa → registrar venda com pagamento misto → consultar venda/pagamentos/resumo persistidos → cancelar → conferir estorno financeiro, devolução de estoque e devolução apenas da parcela em dinheiro → fechar caixa. O cenário foi executado contra PostgreSQL isolado e limpo ao final.
- **Testes executados:** testes de integração PostgreSQL de venda, catálogo, reconciliação, concorrência (duas tentativas para última unidade e chave idempotente repetida) e fluxo de caixa; testes direcionados de fuso, pagamentos, permissões, filtros, estoque, PIX, plataforma e configurações; 16 testes frontend de lógica/fila local. Os testes de frontend usam IndexedDB/rede simulados e não são prova de integração visual.
- **Build/typecheck:** `backend npm run build` passou; `frontend npm run build` passou (aviso webpack não fatal); `npx tsc --noEmit` passou em backend e frontend. Um primeiro typecheck frontend foi iniciado em paralelo à limpeza de `.next` pelo build e falhou por arquivos temporários ausentes; executado novamente depois dos builds, passou.
- **Persistência:** gravação e releitura confirmadas no PostgreSQL isolado; a base `nexus_os_pdv_test` foi removida após os testes. Nenhum dado de cliente/produção ou a base `nexus_os` foi usado para os cenários de venda.
- **Bloqueio de instalação:** `prisma migrate deploy` falhou ao aplicar a primeira migration em banco vazio porque ela referencia `VendaItem` antes da criação dessa tabela. A cadeia preexistente não foi reescrita por risco de incompatibilidade com ambientes já implantados. Isso deve ser corrigido/versionado antes de considerar instalação limpa reproduzível.
- **Validação de navegador pendente:** não há Playwright/Puppeteer nem ferramenta de navegador disponível neste ambiente. Build e testes de API não verificam clique real, modal, loading e erro na tela autenticada; portanto, essa etapa segue pendente.
- **Integrações/dependências:** PIX e cartão continuam bloqueados sem provider/TEF oficial; emissão fiscal depende de integração homologada no módulo Fiscal Brasil; impressão física, gaveta e balança dependem de hardware/protocolo. Não foi possível comprovar essas integrações neste fluxo, e o módulo Fiscal Brasil não foi alterado nesta auditoria do PDV.
- **Segunda auditoria:** código de venda/cancelamento, persistência, idempotência, filtros, caixa, permissões, pagamentos e respostas de indisponibilidade foram revistos após as correções. O fluxo de backend passou nos testes descritos. A tela real e as integrações externas continuam sem validação, e a falha de migrations permanece registrada.

**Conclusão:** fluxo de venda/caixa no backend e persistência em PostgreSQL isolado passaram nos cenários executados. A aba completa ainda não atende ao critério de conclusão integral devido à migration de instalação limpa, validação de navegador e integrações oficiais ausentes.

---

## Módulo 10 — Auditoria final, integração e regressão (10/12/2026)

### Estado inicial

- Prisma **5.22.0** (mantido; nenhuma alteração de versão ou migração criada neste módulo).
- Bancos: `nexus_os` (dev, container Docker `nexus_postgres`/postgres:15, volume `backend_postgres_data`); bancos descartáveis criados e removidos (`nexus_os_m10_tmp`, `nexus_os_m10_v2`, `nexus_os_m10_shadow`).
- PostgreSQL estava parado no início da sessão (Docker Desktop fechado); religado pelo agente — container reabriu com o volume intacto (71 tabelas confirmadas em `nexus_os`).

### Correções aplicadas (defeitos comprovados)

1. **Idempotência de sangria e suprimento (pendência crítica do M06/M04) — CORRIGIDO.**
   - Defeito: `POST /pdv/caixa/movimentacoes` não tinha proteção idempotente; clique duplo, retry após timeout ou reconexão geravam DUAS movimentações e alteravam o saldo duas vezes.
   - Causa: a rota não usava o modelo `IdempotencyKey` já existente (usado apenas nas vendas).
   - Solução: `backend/src/modules/pdv/pdv.routes.ts` passou a aceitar `X-Idempotency-Key` e a reusar `IdempotencyKey` (único por `[empresaId, key]`) — mesmas primitivas das vendas, **sem migração de schema**. Validações rejeitadas gravam `REJEITADA`; sucesso grava `CONFIRMADA` + resposta original. Repetição com a mesma chave devolve o resultado original sem reaplicar; chave nova = nova operação legítima.
   - Frontend: `frontend/app/(dashboard)/pdv/page.tsx` envia `x-idempotency-key` estável por submissão (`novaIdempotencyKey('sangria'|'suprimento')`); o bloqueio de clique duplo continua no `movimentandoRef`.
   - Teste novo: `backend/tests/pdv-idempotencia-movimentacao.test.ts` (operação normal, repetição com mesma chave = mesma movimentação e saldo intacto, chave nova legítima cria segunda movimentação, isolamento com operador dedicado por execução).
   - Ressalva: uma re-submissão **manual** do operador após erro gera nova chave = nova operação (design consistente com "nova sangria legítima deve continuar funcionando"); a proteção cobre repetições da mesma submissão (clique duplo, retry/reconexão).

2. **Teste E1 vacuoso (M07) — CORRIGIDO.** `backend/tests/cross-tenant-isolamento.test.ts`: o `ok('...', true)` passou a asserção real — o operador A, com permissão intacta, deve registrar OUTRA venda (201). Falha se a permissão estiver ausente.

3. **Pureza dos atualizadores React (M08) — CORRIGIDO.** `setError` deixou de ser chamado dentro do updater de `setCarrinho` em `frontend/app/(dashboard)/pdv/page.tsx` (cálculo puro fora, `setError(r.erro)` depois). Mensagens e comportamento do carrinho preservados; 0 efeitos colaterais dentro de updaters confirmados por varredura.

4. **Higiene do teste de idempotência (defeito do teste, não do produto).** A primeira versão reusava o fixture comum `pdv-audit-test-operador` e colidia com `pdv-fluxo-caixa.test.ts` (caixas compartilhados em execução paralela). Reescrito com **operador + permissões dedicados por execução** (criados e removidos no próprio teste) — nenhuma asserção enfraquecida.

### Pendências investigadas com desfecho

- **Instalação em banco vazio — RESOLVIDA (por cadeia preexistente).** `prisma migrate deploy` contra banco descartável vazio aplicou as **37 migrations com sucesso** ("All migrations have been successfully applied"); banco final com **71 tabelas**, `VendaItem` presente; `prisma migrate diff --from-migrations --to-schema-datamodel` → **"No difference detected"**. A correção veio da baseline preexistente `202609110000_baseline_schema_base` (guards `IF NOT EXISTS`, gerada por `gen_baseline.ps1`) — não reescrita neste módulo. Bancos descartáveis removidos ao final.
- **M02 — motor de regressão:** `tmp/mod2/motor.test.ts` **não existe** no repositório (busca recursiva sem resultados) — BLOQUEADO por arquivo ausente; cenários equivalentes cobertos pelos testes de vendas/concorrência/caixa reexecutados abaixo.
- **M03 — concorrência de estoque:** `pdv-concorrencia.test.ts` e `pdv-fase3-concorrencia.test.ts` **reexecutados com `RUN_PDV_DB_TEST=1` e PASSARAM** (fixtures `pdv-audit-test-*` presentes no banco de dev). Sem estoque negativo, sem baixa duplicada.
- **Campo de peso / balança — NÃO EXISTE.** Nenhum campo, indicador, estado ou protocolo de peso em `frontend/app/(dashboard)/pdv/page.tsx` nem em `frontend/lib/pdv/`. A única menção é texto informativo (~linha 866: "⚖️ Balança … integração somente via API/SDK oficial do fabricante"). Não há digitação de peso, leitura de equipamento ou conversão de unidade. Implementação exigiria decisão de produto (SKU pesável), elemento visual (AUTORIZADO), protocolo do equipamento-alvo e homologação física — **não implementado**.
- **Isolamento entre filiais — DECISÃO DE NEGÓCIO PENDENTE** (M07; nenhum comportamento alterado). Filiais da mesma empresa compartilham vendas/produtos (tenant = empresa); caixas são isolados por operador.
- **Testes de navegador — NÃO EXECUTADOS:** Playwright/Puppeteer indisponíveis no ambiente.

### Regressões executadas (resultados reais)

| Suíte | Comando | Resultado |
|---|---|---|
| PDV backend (idempotência de movimentação, venda, reconciliação, concorrência ×2, fluxo de caixa) | `RUN_PDV_DB_TEST=1 npx tsx --test tests/pdv-idempotencia-movimentacao.test.ts tests/pdv-fase2-venda.test.ts tests/pdv-fase4-reconciliacao.test.ts tests/pdv-concorrencia.test.ts tests/pdv-fase3-concorrencia.test.ts tests/pdv-fluxo-caixa.test.ts` | **6/6 PASS** |
| Segurança/isolamento/permissões | `npx tsx --test tests/cross-tenant-isolamento.test.ts tests/mod07-seguranca.test.ts tests/mod07-mutacao.test.ts tests/permissoes.test.ts tests/jwt.test.ts tests/vendas-filtros.test.ts` | **27/27 PASS** |
| Frontend PDV completo (carrinho, cupom, fila, troca de usuário, logout, persistência, política offline, reconciliação, hardware) | `npx tsx --test tests/pdv-*.test.ts` | **48/48 PASS** |
| TypeScript backend | `node_modules/.bin/tsc --noEmit -p tsconfig.json` | **0 erros** |
| TypeScript frontend | `node_modules/.bin/tsc --noEmit -p tsconfig.json` | **0 erros** |
| Instalação limpa | `prisma migrate deploy` em banco descartável + `prisma migrate diff` | **37/37 OK; drift: none** |

### Integridade

- Layout do PDV **preservado** (nenhuma alteração de JSX/CSS neste módulo; `PixQrCodeModal` intacto). `nexus_os` (dev) recebeu apenas dados de teste isolados, removidos no `finally`. Prisma 5.22.0. Nenhum commit, nenhum `git reset`, nenhum teste destrutivo.

### Pendências remanescentes

1. Homologação em navegador real (clique, modal, loading, erro na tela autenticada).
2. Hardware físico: impressoras térmicas, scanners, gavetas e balanças.
3. Provedores oficiais: PIX, cartão, TEF e Fiscal Brasil (bloqueio seguro mantido).
4. Decisão de negócio: isolamento entre filiais da mesma empresa.
5. M02: localizar ou recriar o motor de regressão (`tmp/mod2/motor.test.ts` ausente).
6. Campo de peso/balança: requer decisão de produto, elemento visual autorizado e protocolo real.
7. Ressalva: re-submissão manual de movimentação após erro = nova operação (documentado acima).

# Escalabilidade e testes de carga — NEXUS OS

Atualizado em 2026-11-21. **Todos os números abaixo vêm de um ambiente ISOLADO (local), nunca da produção.**

## 1. Ambiente do teste
- Backend: a imagem Docker de produção (Node 22), **limitada a 1 vCPU e 512 MB**, `NODE_ENV=production`,
  conectada como **`nexus_app` com RLS ativo** e pool de **10** conexões (igual à produção).
- Banco: Postgres local (Docker) com as 52 migrações e as policies RLS.
- Carga: todas as empresas ao mesmo tempo, em rajada, em cada fase: login · dashboard (3 chamadas) · cadastro de
  3 produtos · 3 movimentações de estoque · **10 vendas simultâneas por empresa** · abrir e fechar caixa ·
  compra (fornecedor → pedido → confirmar → receber) · financeiro (3) · DRE e fluxo de caixa.
- Roteiro reproduzível: `carga.mjs` (scratchpad desta entrega; ver o relatório).

## 2. Resultados (depois das correções)
| Empresas | Requisições | Erros | p95 das vendas | p95 dos demais cenários | CPU (pico) | Memória (pico) | Conexões |
|---|---|---|---|---|---|---|---|
| 10 | 310 | **0%** | 10,2 s | ≤ 2,7 s | 100% | 90 MB | 10 |
| 25 | 775 | 2,5% (só nas vendas) | 21,2 s | ≤ 4,7 s | 103% | 102 MB | 10 |
| 50 | 1.550 | 11,6% (só nas vendas, todos 503) | 34,8 s | ≤ 9,4 s | 102% | 117 MB | 10 |
| 100 | 3.100 | 22,4% (só nas vendas, todos 503) | 38,3 s | ≤ 14,2 s | 104% | 153 MB | 10 |

**Fora das vendas simultâneas, nenhum cenário teve erro em nenhum nível**: login, dashboard, produtos, estoque,
caixa, compras, financeiro e relatórios ficaram com 0 erros de 25 a 100 empresas.

### Antes das correções (10 empresas)
24% das vendas falhavam com **500** (`Unable to start a transaction in the given time`): o Prisma desiste de
esperar conexão em 2 s e a venda era perdida com erro genérico.

### O que foi corrigido
1. **Tempo das transações** (`src/lib/prisma.ts`): espera de até 10 s por conexão (era 2 s) e duração de até
   15 s (era 5 s). Configurável por `PRISMA_TX_MAX_WAIT_MS` e `PRISMA_TX_TIMEOUT_MS`. **Efeito: 24% → 0% de erro com 10 empresas.**
2. **Sobrecarga vira 503 com `Retry-After`** (não 500), com o evento `capacidade_excedida` no log. O PDV
   offline já guarda a venda na fila (Dexie) e reenvia.
3. **Agregações no banco** no lugar de carregar o histórico na memória: LTV do dashboard (`count(DISTINCT)`)
   e recálculo do cliente ao cancelar uma venda (`aggregate`).

## 3. Leitura dos resultados
- **O gargalo é a CPU**: 100% já com 10 empresas em rajada. A memória sobra (153 MB de 512 MB).
  A conexão (10) é o segundo limite.
- A rajada testada é **extrema**: 1.000 vendas no mesmo instante (100 empresas × 10). Uma operação real
  distribui as vendas ao longo do dia.
- **Projeção, não comprovada:** com 1 vCPU, o backend processou cerca de 25 a 30 vendas por segundo. O
  **Render Free tem cerca de 0,1 vCPU**, então um desempenho cerca de 10 vezes menor é esperado.

## 4. Banco e conexões
- `max_connections` do Supabase: 60. Papel `nexus_app`: limite de 20. Pool por instância: 10.
- **Até 2 instâncias** com pool 10 cabem no limite do `nexus_app`. Para mais: reduzir o
  `PRISMA_CONNECTION_LIMIT` (por exemplo, 6 por instância) ou usar o Supavisor em modo transação (porta 6543, `pgbouncer=true`).
  O contexto RLS usa `set_config(..., true)`, que vale só dentro da transação e funciona nesse modo, mas
  **precisa ser testado** antes.
- Índices em `empresaId`: completos desde 21/11 (migração `202611201500`).

## 5. Várias instâncias
| Componente | Situação |
|---|---|
| Rate limit | **Pronto**: contador no banco (`RateLimitJanela`), atômico e compartilhado; testado com 2 "instâncias" |
| Tarefas diárias (snapshot de estoque, fechamento de expediente) | **Pronto**: trava no banco (`TarefaAgendada`); com 10 instâncias disputando, só 1 executa (testado). Também retoma a execução perdida se o processo estava parado no horário |
| Agendador do Mercado Livre | Já tinha trava de posse (lease) por instância |
| Agendador da Shopee | `running` só em memória: com várias instâncias, pode sincronizar em duplicidade (a sincronização é idempotente por pedido). Pendente: aplicar a mesma trava |
| Sessão | JWT sem estado: qualquer instância atende |

## 6. Paginação
Das 234 chamadas `findMany`, 48 são de tabelas que crescem e não têm `take`. A análise mostrou:
- as **listagens das telas** já são limitadas ou paginadas (por exemplo, Financeiro: "os N lançamentos mais recentes");
- a maioria das demais é **limitada por período** (DRE, fluxo, gestão) ou **por caixa ou cliente** (PDV);
- o risco real eram **somas e contagens sobre o histórico inteiro**, feitas em memória. Os dois casos de maior impacto
  foram corrigidos (seção 2). Pendentes de mesma natureza: `fornecedores.service.ts` (todas as compras, para KPIs
  mensais) e `ia.routes.ts` (compras paradas). Ambos devem virar `groupBy`/`aggregate`.

## 7. Infraestrutura: recomendação técnica e financeira
Preços aproximados, que devem ser conferidos antes. Contratar é decisão sua.

| Fase | Backend | Banco | Custo/mês (aprox.) |
|---|---|---|---|
| Piloto (1 a 3 empresas) | Render **Starter** (0,5 vCPU, 512 MB, sem hibernar) | Supabase Free, com o backup diário desta entrega | ~US$ 7 |
| Até ~10 empresas | Render Starter, **na região Virgínia** (mesma do banco, `us-east-1`) | **Supabase Pro** (backup diário gerenciado e mais conexões) | ~US$ 32 |
| 25 a 50 empresas | Render **Standard** (1 vCPU, 2 GB) ou 2 × Starter | Supabase Pro (+ PITR, se o RPO de 24 h não bastar) | ~US$ 50 a 125 |
| 100 empresas | 2 × Standard + Supavisor em modo transação; agendadores num worker separado | Supabase Pro com compute maior | a dimensionar por novo teste de carga |

- **Região:** o backend em Oregon e o banco na Virgínia somam ~70 ms em **cada** consulta. O Render não muda a
  região de um serviço existente: é preciso criar um serviço novo na Virgínia, copiar as variáveis e trocar o domínio da API.
- **Render Free:** hiberna após 15 min sem tráfego. O `monitor.yml` chama a API a cada 10 min, o que a mantém
  acordada e garante as tarefas diárias. Mesmo assim, 0,1 vCPU não serve para operação comercial.

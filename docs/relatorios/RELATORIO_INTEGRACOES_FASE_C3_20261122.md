# Integrações — Fase C3: pedidos do WooCommerce em Vendas

Data: 22/11/2026 · Branch: `feat/integracoes-fase-c3` · **Sem migração**

## O que mudou
- Janela do WooCommerce, aba **Sincronização**: botão **Importar pedidos** (filial do estoque + quantidade, até 200) e relatório pedido a pedido.
- `POST /integracoes/central/woocommerce/pedidos/importar` (permissão `integracoes.editar`, limite por empresa) → `GET <loja>/wp-json/wc/v3/orders` (Basic Auth, paginação por `X-WP-TotalPages`), URL validada contra SSRF.
- Mesmo modelo do Mercado Livre:
  - itens casados pelo **SKU** do produto no NEXUS (mesma empresa); sem SKU ou SKU inexistente → pedido não importado, motivo no relatório;
  - **idempotência em duas camadas** (`Venda.idempotencyKey` + tabela `IdempotencyKey`), chave `woo:order:<loja>:<id>`;
  - status: pago/concluído → FINALIZADA (com pagamento registrado); pendente/em espera → ABERTA; cancelado/reembolsado → CANCELADA; `failed` ignorado; moeda ≠ BRL recusada;
  - **estoque** baixado na mesma transação da venda, só para pedidos posteriores à conexão; cancelamento devolve uma única vez;
  - não cria financeiro nem caixa (igual ao Mercado Livre).
- Importação concorrente do mesmo pedido: a segunda execução vira "já existia" em vez de interromper o lote.

## Testes
| Verificação | Resultado |
|---|---|
| Backend completo (`postgres`) | 508 passaram, 0 falharam |
| Backend completo (`nexus_app`) | 518 passaram, 0 falharam |
| Testes novos da C3 | 10/10 |
| Frontend | 85/85; tsc, next build e imagem Docker OK |
| Revisão visual (desktop e celular) | sem erros, sem rolagem horizontal |

Comprovado: pedido pago → venda e estoque 10→8; reimportar não duplica; cancelamento devolve 8→10 uma vez; SKU inexistente/sem SKU/failed/USD não viram venda; pedido anterior à conexão não baixa estoque; **4 importações simultâneas → 1 venda e 1 baixa**; SKU de outra empresa nunca casa; filial de outra empresa recusada; loja real sem WooCommerce → "HTTP 404 ao listar pedidos".

**Não validado**: importação de uma loja WooCommerce real (sem loja de teste com chaves). Campos de resposta do pedido (`date_created_gmt`, `date_paid_gmt`, `total`) não constam no trecho da documentação lido; o código os trata como opcionais.

**Pendente**: importação automática agendada (hoje é manual).

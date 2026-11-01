# NEXUS OS - PARTE 3 - VENDAS E PDV - 100% fiel ao PROMPT MESTRE

## Fluxo 13 passos Seção 2 IMPLEMENTADO:
Quando venda realizada:
1. Registrar venda
2. Atualizar PDV
3. Baixar estoque
4. Atualizar faturamento
5. Atualizar quantidade vendas
6. Recalcular ticket médio
7. Atualizar metas
8. Atualizar financeiro
9. Alimentar DRE
10. Atualizar ROI
11. Atualizar dashboard
12. Registrar auditoria
13. Disponibilizar dados para IA NEXUS

## Seções entregues:
- Seção 13 Vendas: produto, qtd, preço, desconto, total, cliente, funcionário, setor, filial, forma pagamento, data/hora, origem, status + venda, cancelamento, devolução, estorno
- Seção 14 PDV: só métodos oficiais, central com Conectado/Atenção/Erro/Não configurado, última sync, próxima sync, qtd registros, erros, histórico
- Seção 15 Financeiro: receita de venda automática
- Seção 18 Ticket Médio: ticket = faturamento / num vendas - por período, setor, funcionário, filial
- Seção 19 Metas: Empresa, Filial, Setor, Funcionário - meta, realizado, percentual, diferença, projeção, prazo, status + ranking

## Aba Vendas (gestão) atualizada fiel ao layout de referência

### Contrato da API (ampliado, sempre retrocompatível)

- `GET /vendas` — filtros: `filialId`, `clienteId`, `funcionarioId`, `status`,
  `formaPagamento`, `busca` (ID da venda ou nome do cliente), `de`/`ate`
  (`YYYY-MM-DD`, inclusivos), `take` (máx. 200), `skip`. Cada venda passa a
  devolver **`vendedorNome`** — o nome do usuário que vendeu, porque
  `funcionarioId` sozinho não é legível na tela.
- `GET /vendas/:id` — mesmo enriquecimento, para o drawer de detalhe.
- `GET /vendas/dashboard?dias=1|7|30` (padrão 30) — mantém `faturamento`,
  `qtdVendas`, `ticketMedio`, `indicadores`, `crescimento` e `meta` como
  estavam, e adiciona `faturamentoHoje`, `faturamentoPeriodo`,
  `qtdVendasPeriodo`, `ticketMedioPeriodo`, `faturamentoAnterior`,
  `ticketMedioAnterior`, `crescimentoPeriodo`, `crescimentoTicketMedio`,
  `porStatus`, `porStatusAnterior`, `canceladasEstornos` e
  `crescimentoCanceladas`. Os deltas dos KPIs usam a janela anterior de
  mesmo tamanho como base real (sem base, o rótulo diz "sem base anterior").
- `POST /vendas/:id/cancelar` — corpo opcional
  `{ motivo?, estornarEstoque? = true, estornarFinanceiro? = true }`. Corpo
  vazio continua idêntico ao comportamento anterior (é o que o PDV envia).
  `estornarEstoque: false` pula a devolução de estoque;
  `estornarFinanceiro: false` pula financeiro, indicadores do dia, metas,
  agregados do cliente e a gaveta do turno. O motivo vai para a movimentação
  de estoque e para o contexto da auditoria (antes era texto fixo). Venda já
  cancelada responde 409 com mensagem clara.
- Regra de filtro isolada em `src/modules/vendas/vendas.filtros.ts` (pura,
  sem Prisma em runtime) e coberta por `tests/vendas-filtros.test.ts`.

### Tela (`frontend/app/(dashboard)/vendas/page.tsx`)

- 4 KPIs: Vendas Hoje, Ticket Médio, Vendas em Aberto e Canceladas /
  Estornos — todos com dado real do dashboard.
- Barra de filtros: período (Hoje / 7 dias / 30 dias), status, forma de
  pagamento, vendedor, filial e busca livre, mais exportação CSV (8 colunas,
  incluindo Vendedor) e Excel (`.xls` via planilha HTML, sem dependência
  nova).
- Tabela no padrão do Layout Mestre com ID Venda, Data/Hora, Cliente, Itens,
  Total, Pagamento, Status (badge por tom), Vendedor e Ações (ver, imprimir,
  NF-e desabilitada e estornar); a linha inteira abre o detalhe e a paginação
  é server-side (20 por página).
- Drawer lateral de detalhe da venda (itens com nome de produto,
  subtotal/desconto/total, histórico derivado de dado real) e modal de
  estorno com motivo obrigatório e escolha do que estornar. A impressão
  (`window.print`) sai só com o detalhe.
- O que não tem backend (NF-e, troco, observação, histórico auditado,
  `.xlsx` binário e o status `ABERTA` sem fluxo) está registrado como débito
  explícito em `DEBITO-TECNICO.md` item 23 — nada foi simulado na tela.


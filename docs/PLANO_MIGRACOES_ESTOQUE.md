# PLANO CONCRETO DE MIGRAÇÕES — ESTOQUE/UNIDADES

## Estado atual do banco (confirmado)

- 45 migrations existentes em `backend/prisma/migrations`
- 4 migrations **pendentes** (não aplicadas ao banco):
  1. `202610181200_shopee_connections` — **NÃO APLICAR** (integração externa pausada)
  2. `202610241000_produto_codigo_barras_unico` — aplicar (aditiva, segura)
  3. `202610241100_produto_kits_producao` — aplicar (aditiva, segura)
  4. `202610251000_estoque_quantidades_fracionarias` — aplicar (altera tipos Int→Decimal, preserva valores)

## Ordem planejada de execução

```
Passo 1:  202610241000_produto_codigo_barras_unico        (aplicar)
Passo 2:  202610241100_produto_kits_producao              (aplicar)
Passo 3:  202610251000_estoque_quantidades_fracionarias   (aplicar)
Passo 4:  [NOVA] 202610260000_unidades_tipos_produtos     (criar e aplicar — aditiva)
Passo 5:  [NOVA] 202610260100_conversao_int_para_decimal  (criar e aplicar — VendaItem/ProducaoKit Int→Decimal)
```

- Shopee (`202610181200_shopee_connections`) permanece **não aplicada**.
- Nenhuma migration será marcada como aplicada artificialmente.
- Cada migration será inspecionada antes de aplicar.
- Backup verificável antes de qualquer alteração destrutiva.

## Conteúdo da migration nova 1: `202610260000_unidades_tipos_produtos`

Tabelas novas (aditivas, sem alterar existentes):

1. `Dimensao` (id, empresaId, nome, codigo, createdAt)
2. `Unidade` (id, empresaId, dimensaoId, nome, simbolo, fatorCanonico, ativo, createdAt)
3. `TipoProduto` (id, empresaId, nome, codigo, descricao, ativo, createdAt) — códigos: MERCADORIA, INSUMO, FABRICADO, USO_INTERNO
4. `FatorConversao` (id, empresaId, produtoId, unidadeOrigemId, unidadeDestinoId, fator, fornecedorId?, vigenciaDe, vigenciaAte, createdAt)

Alterações em `Produto`:
- `tipoProdutoId` String? (FK para TipoProduto)
- `unidadeBaseId` String? (FK para Unidade)
- `politicaCusto` String? @default("MEDIO_PONDERADO") — ULTIMO_CUSTO | MEDIO_PONDERADO | PADRAO
- `ehKit` mantido (já existe)
- Manter `unidade` String legado para compatibilidade de leitura antiga

## Conteúdo da migration nova 2: `202610260100_conversao_int_para_decimal`

Alterações de coluna (preservando valores exatamente):

- `VendaItem.quantidade`: Int → Decimal(14,3)
- `ProducaoKit.quantidade`: Int → Decimal(14,3)

Novos campos de snapshot em `CompraItem`:
- `unidadeCompra` String?
- `fatorAplicado` Decimal(14,6)?
- `quantidadeBase` Decimal(14,3)?

Novos campos de snapshot em `VendaItem`:
- `unidadeVenda` String?
- `fatorAplicado` Decimal(14,6)?
- `quantidadeBase` Decimal(14,3)?

Novos campos em `ProducaoKit`:
- `quantidade` Int → Decimal(14,3)
- `unidadeProducao` String?
- `fatorAplicado` Decimal(14,6)?

## Rollback

Cada migration tem rollback correspondente documentado. Rollback da migration 1 remove as tabelas novas e campos adicionados. Rollback da migration 2 reverte Decimal para Int (após verificar que não há dados fracionários que seriam perdidos).

## Evidências exigidas

- `prisma migrate status` antes e depois
- Backup do banco antes da migration destrutiva
- Reconciliação de saldos antes/depois por empresa/filial

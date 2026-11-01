# DECISÕES DE NEGÓCIO — ETAPA 0 (APROVADAS)

Este documento registra as decisões de negócio aprovadas para o plano de estoque, insumos, kits e unidades de medida. Elas orientam toda a implementação das Etapas 1 a 10.

---

## 1. Tipos de produto — OPÇÃO A com arquitetura extensível

| Tipo | Comportamento |
|------|---------------|
| Mercadoria para revenda | Vendido diretamente; saldo em unidade base |
| Insumo / matéria-prima | Consumido em produções e uso interno; saldo em unidade base |
| Produto fabricado | Produzido para estoque e vendido depois como acabado; ingredientes não baixados na venda |
| Material de uso interno | Baixa por consumo interno com motivo e responsável |

- Não implementar tipo intermediário agora, mas evitar arquitetura que impeça inclusão futura.
- Até revisão manual, classificação padrão aprovada não altera comportamento de venda.

## 2. Kits comerciais — AJUSTAR OPÇÃO A (ambos os cenários)

| Cenário | Regra |
|---------|-------|
| Kit comercial virtual | Componentes baixados do estoque na venda, em transação, com relação venda↔componente registrada |
| Kit pré-montado | Componentes consumidos na montagem (fluxo de produção); produto acabado tem estoque próprio |

- Ficha técnica de fabricação separada do kit comercial.
- Não confundir kit comercial com produto fabricado.

## 3. Produção — OPÇÃO B

- Rendimento configurável por produção.
- Registro de perdas e quantidades efetivamente produzidas.
- Suporte a quantidades fracionárias quando compatíveis com a unidade de medida.
- Preservar histórico da composição e dos custos na produção (snapshot).
- Não descartar nem devolver sobras automaticamente sem regra de negócio validada.

## 4. Custos — OPÇÃO B (custo médio ponderado)

- Política desejada: custo médio ponderado.
- Auditar valorização atual e planejar transição antes de implementar.
- Preservar custos e snapshots históricos; não recalcular registros históricos silenciosamente.
- Corrigir divergência entre custo do produto e valor total do estoque.
- Demonstrar com testes como compras, produção, perdas, devoluções e transferências afetam o custo médio.

## 5. Precisão decimal — OPÇÃO A com validação técnica

| Domínio | Precisão |
|---------|----------|
| Quantidades | até 6 casas decimais |
| Fatores de conversão | até 6 casas ou mais se a regra exigir |
| Custos unitários | precisão suficiente para valores < R$ 0,01 por unidade-base |

- Usar Decimal no banco e nos cálculos; nunca Float.
- Regras explícitas de arredondamento.
- Não alterar tipos de campos de forma incompatível sem analisar consumidores existentes.

## 6. Unidades — OPÇÃO A ampliada

| Dimensão | Unidades |
|----------|----------|
| Massa | kg, g, mg |
| Volume | L, mL |
| Contagem | unidade, dúzia, centena, milheiro |
| Comprimento | m, cm, mm |
| Embalagens | caixa, pacote, saco, fardo (configuráveis por produto/fornecedor) |

- Cada produto tem uma unidade-base.
- Unidades específicas para compra, consumo/produção e venda.
- Fatores de conversão por produto e, quando necessário, por fornecedor.
- Não converter massa em volume sem fator específico validado.
- Registrar snapshots das conversões utilizadas em operações históricas.
- Não presumir quantidade fixa para embalagens (caixa/pacote/saco/fardo variam por produto).

## 7. Consumo interno — AJUSTAR OPÇÃO A

- Permissão específica para consumo interno.
- Obrigatório: motivo, responsável, data, empresa/filial, quantidade e custo.
- Aprovação quando exigida por política configurável.
- Não inventar limites de aprovação: identificar requisitos existentes e documentar decisões pendentes.
- Bloquear operações não autorizadas e garantir rastreabilidade.

## 8. Estorno de produção — OPÇÃO A com salvaguardas

- Estorno formal, idempotente e auditável.
- Movimentos compensatórios, sem apagar histórico.
- Validar estado atual dos estoques antes de estornar.
- Se produto acabado já vendido/consumido/movimentado de forma insegura: bloquear estorno automático e informar motivo.
- Não permitir saldo negativo nem duplicar movimentações.

---

## Regras obrigatórias (C, D, E do plano)

- Preservar implementações existentes; não sobrescrever trabalho anterior.
- NÃO aplicar migrations da Shopee.
- Não executar `prisma migrate deploy` indiscriminadamente.
- Backup verificável e reconciliação antes de alterações destrutivas.
- Priorizar banco de testes/homologação.
- Preservar layout atual, componentes, cores e navegação.
- NÃO modificar PDV PRO sem autorização expressa.
- Não iniciar integrações externas agora.
- Não usar localStorage/mocks como substitutos de persistência real.

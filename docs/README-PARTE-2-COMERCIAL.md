# NEXUS OS - PARTE 2 - COMERCIAL (Seções 1 a 12) - REVISADO
## Fluxo Seção 2 e 10 implementado:
PRODUTO -> ESTOQUE -> COMPRA -> ESTOQUE -> FINANCEIRO -> CUSTO -> INDICADORES

### Novidades PARTE 2:
- Seção 8 Produtos: SKU, código barras, categoria, fornecedor, custo, preço, margem calculada, estoque min/max, validade, origem, botão + NOVO PRODUTO real
- Seção 9 Estoque: ENTRADA, SAIDA, AJUSTE, INVENTARIO, PERDA, AVARIA, TRANSFERENCIA, DEVOLUCAO, VENDA, COMPRA - com usuario, origem, motivo, documento + alerta automático SE estoque < minimo ENTÃO alerta (Seção 29)
- Seção 10 Compras: SOLICITADA -> PEDIDO -> RECEBIDA -> baixa no estoque + atualiza custo + auditoria
- Seção 11 Fornecedores: CNPJ/CPF, contato, histórico
- Seção 12 Clientes: documento, valor total comprado, ticket médio, frequência, última compra
- Seção 7 Dashboard: valor total estoque, baixo, sem estoque
- Seção 31/32: Origem e Auditoria em tudo

# Relatório — Tipo de produto KIT e aba Composição do Kit

Data: 21/11/2026 · Branch: `feat/produto-kit` (não commitada, não publicada)

## Resumo

O NEXUS OS passa a ter o tipo de produto **Kit**. Ao escolher Kit no campo *Tipo de produto*, a aba
**Composição do Kit** aparece na barra de abas da ficha, entre *Estoque* e *Movimento*. Nela o usuário busca
produtos e insumos reais do estoque, informa a quantidade em qualquer unidade compatível (kg, g, L, mL, UN, CX…) e
vê o custo de cada item, o custo total e a margem. Na venda (PDV ou Vendas), o kit é **um único produto**: a venda
baixa os componentes na filial da venda, numa só transação. O kit em si não é baixado, porque não tem estoque próprio.

O cadastro existente não foi refeito: a aba usa os mesmos componentes visuais (`ui.tsx`) e os mesmos tokens de
espaçamento, altura e tipografia (`ficha.module.css`). Nenhuma outra aba mudou de layout.

## Defeitos encontrados e corrigidos no caminho

| Defeito (antes) | Efeito | Correção |
|---|---|---|
| Venda de produto com composição (`ehKit`) baixava o **próprio produto e os ingredientes** | Baixa dupla de estoque | KIT baixa só os componentes; ficha técnica de produção (não-KIT) baixa só o acabado |
| `buscarFatorConversao` exigia `vigenciaAte >= agora`, mas o fator ativo tem `vigenciaAte` nula | **Toda** conversão por embalagem (1 CX = 12 UN) era recusada | Vigência aberta (nula) passa a valer |
| PDV bloqueia item com `estoqueFilial <= 0`, e o kit não tem saldo próprio | Kit nunca seria vendável no PDV | Catálogo do PDV calcula o disponível do kit pelos componentes (quantos kits dá para montar) |
| Pré-checagem de saldo da venda olhava o saldo do próprio produto | Kit seria recusado por "estoque insuficiente" | Para KIT, a checagem é feita componente a componente, com mensagem clara |
| Indicadores da aba mostravam "R$ 0,00 / margem 100%" durante o carregamento (achado na revisão visual) | Número falso por um instante | Mostram "—" até os dados chegarem |

Na produção não havia nenhum produto com composição (0 kits, 0 composições: consulta somente leitura). A
mudança de comportamento da venda não afeta nenhum dado existente.

## Alterações no banco (migração `202611212000_produto_kit`, 100% aditiva)

- `TipoProdutoEnum`: + `KIT`, `FABRICA` e `NAO_CLASSIFICADO`. Os 7 tipos existentes ficam intactos.
- `ComposicaoKit`: + `unidadeId` (FK `Unidade`), `quantidade` (unidade informada) e `ordem`.
  `quantidadePorKit` continua sendo a quantidade **na unidade base** do componente, que é o que sai do estoque.
- `EstoqueMovimentacao`: + `kitProdutoId` (FK `Produto`, SET NULL) e índice `(empresaId, kitProdutoId)`. Marca a baixa como "venda de kit".
- `VendaItem`: + `composicaoKit` (JSONB), cópia da composição, das quantidades baixadas e dos custos no momento da venda.

Nenhum `DROP`, nenhuma alteração de dado e nenhuma coluna obrigatória nova. O RLS cobre automaticamente as colunas
novas, porque as tabelas já têm política por `empresaId`. O drift entre migrações e schema ficou em 0.

**A migração NÃO foi aplicada na produção.** Ela precisa ser aplicada antes do deploy desta versão, e isso depende da sua autorização.

## Prisma

Só `schema.prisma`: os campos acima, as relações `Unidade.composicoesKit` e `Produto.movimentacoesComoKit` (nome `MovimentacaoKit`)
e o índice novo.

## Endpoints

| Endpoint | Situação | O que faz |
|---|---|---|
| `GET /produtos/:id/kit` | Alterado (compatível) | Composição com unidade informada, conversão para a base, custos, unidades compatíveis, disponibilidade por filial, vendas do kit e consumo dos componentes |
| `PUT /produtos/:id/kit` | Alterado (compatível) | Aceita `quantidade` + `unidadeId` e ainda `quantidadePorKit` (modal antigo da listagem). Valida unidade, ciclo, ativo, duplicidade e precisão; recalcula o custo do kit; audita antes e depois |
| `GET /produtos/:id/kit/candidatos` | **Novo** | Busca de componentes: nome, código interno/referência, código de barras (principal e adicionais), grupo (inclui subgrupos), subgrupo e tipo. Só produtos ativos, da empresa, que não sejam kit |
| `POST /produtos/:id/kit/produzir` | Alterado | Recusa produtos do tipo KIT (409): o kit é montado na venda |
| `PUT /produtos/:id` | Alterado | Regras de mudança de tipo (abaixo) |
| `POST /vendas` | Alterado | Expansão do KIT, baixa dos componentes, custo (CMV) e cópia da composição na venda |
| `POST /vendas/:id/cancelar` | Alterado | O estorno devolve os componentes marcados com o kit de origem |
| `POST /compras/:id/receber` | Alterado | Recalcula o custo dos kits que usam os itens recebidos (o preço de venda não muda) |
| `GET /pdv/catalogo` | Alterado | `estoqueFilial` do kit = kits montáveis com o saldo dos componentes na filial |
| `GET /produtos/:id/movimentacoes` | Alterado | Cada movimentação traz `kit` (origem) quando veio da venda de um kit |
| `GET /produtos/catalogos` | Alterado | Inclui os tipos Kit, Fábrica e Não classificado (criados sob demanda, sem duplicar) |

## Regras de negócio implementadas

- **Unidades:** só conversões com regra cadastrada: mesma dimensão (kg↔g, L↔mL, UN↔DZ) ou fator do produto (CX→UN).
  kg↔L sem regra, ou embalagem sem fator, é recusado com mensagem. Uma conversão que gere mais de 3 casas na base
  (0,5 g de um item em kg) também é recusada, porque o estoque não registraria a fração.
- **Custo:** custo do kit = Σ (custo vigente do componente × quantidade na base), seguindo a política de custo de
  cada componente. É recalculado ao salvar a composição e no recebimento de compra. O **preço de venda nunca muda**; a margem é recalculada e a
  mudança de custo vai para o histórico de preços.
- **Venda:** tudo ou nada. Se um componente não tem saldo e não permite estoque negativo, a venda inteira é recusada
  e nada é baixado. Componente com estoque negativo liberado ou sem controle de estoque segue a regra do próprio cadastro.
  Kit sem composição não pode ser vendido.
- **Cancelamento e estorno:** devolvem exatamente o que a venda baixou. Um segundo cancelamento é recusado (sem devolução em dobro).
- **Histórico:** a venda guarda a composição usada. Alterar o kit depois não muda vendas passadas.
- **Mudança de tipo:**
  - Kit → outro tipo: **bloqueada** enquanto houver componentes. Nada é apagado automaticamente.
  - Outro tipo → Kit: bloqueada se o produto é componente de outro kit (kit não compõe kit) ou se tem saldo próprio, que ficaria órfão.
- **Validações:**
  - O kit não pode ser componente de si mesmo.
  - Ciclos são detectados (percurso do grafo de composições), e um produto Kit não pode ser componente.
  - Quantidade zero ou negativa é recusada, e a mesma regra vale para componente inativo ou duplicado.
  - A empresa e a filial são respeitadas.
  - Permissões: `produtos.visualizar` e `produtos.editar`; o custo só aparece com `custos.visualizar`.
- **Componente inativado depois:** continua na composição (histórico preservado) e aparece sinalizado como *Inativo* na aba.
- **Auditoria:** cada gravação da composição gera registro em `Auditoria`, com o antes e o depois (itens, unidades, quantidades e custo).

## Frontend

- **Novo:**
  - `components/produto/AbaComposicaoKit.tsx`, com as seções "Itens que compõem este kit", "Disponibilidade por filial" e
    "Vendas e consumo dos componentes", mais a janela de busca com filtros de tipo, grupo e subgrupo;
  - `frontend/tests/composicao-kit.test.ts`.
- **Alterado:**
  - `app/(dashboard)/produtos/[id]/page.tsx`: aba condicional, posição, marcador de alteração não salva e aviso ao sair;
  - `lib/produto-ficha.ts`: `kitApi`, tipos e `custoDaLinha`;
  - `AbaDados.tsx`: o rótulo da opção vazia passou de "Não classificado" para "Selecione o tipo", porque "Não classificado" agora é um tipo real.
- A aba aparece **assim que Kit é escolhido** no formulário, mesmo antes de salvar. Nesse caso ela avisa que o tipo precisa
  ser salvo antes de montar a composição. Para qualquer outro tipo, a aba fica oculta.

## Testes executados

| Suíte | Resultado |
|---|---|
| `backend/tests/produto-kit.test.ts` (19 cenários, 15 blocos), papel `postgres` | 16/16 |
| O mesmo arquivo com o papel `nexus_app` (RLS ativo) | 16/16 |
| Backend completo no modo do CI, papel `postgres` | 434 passaram, 0 falharam (11 pulados) |
| Backend completo no modo do CI, papel `nexus_app` | 444 passaram, 0 falharam (10 pulados) |
| Frontend (`tsc` + testes) | 73/73 |
| Drift migrações × schema | 0 |
| Build do backend (`tsc`), imagem Docker e `next build` | OK |

Os 19 cenários pedidos estão no teste de integração, nesta ordem: criar KIT; aba visível; outro tipo com a aba
oculta; buscar e adicionar componentes; KG, G, L, ML e CX; conversões; custo total (R$ 30,00, o exemplo do pedido); editar; salvar e
reabrir; vender 1 kit; baixa dos componentes; vender 3 kits; estoque insuficiente; cancelamento; estorno; filiais;
empresas; histórico de movimentações; integridade.

## Revisão visual (navegador real, build de produção, API local)

As 11 abas do kit, mais a janela de busca, foram capturadas em 3 resoluções (1440, 1024 e 390 px): 36 telas.

- **Checagens automáticas:** rolagem horizontal 0, nenhum campo cortado, nenhuma sobreposição e 0 erros JS/CSP. A barra principal de abas tem a mesma altura e
  a mesma fonte em todas as abas.
- **Abas e busca:** a ordem confirmada é Dados | Preços | Tributos | Código de Barras | Estoque | **Composição do Kit** | Movimento | PDV | Filial
  | Premiação | Integrações. No produto comum, a aba fica oculta e aparece quando Kit é escolhido. A busca retornou componentes reais.
- **Celular:** a tabela de composição rola dentro da própria caixa, o mesmo padrão das tabelas das outras abas.

## Integrações

| Módulo | Situação |
|---|---|
| PDV | Concluída e testada. O kit é um item só, e a disponibilidade vem dos componentes |
| Vendas | Concluída e testada. O kit é registrado normalmente, com CMV = custo dos componentes |
| Estoque | Concluída e testada. Baixa por componente, com origem "venda de kit" |
| Compras | Concluída e testada. O recebimento recalcula o custo do kit |
| Financeiro | Concluída e testada. O lançamento leva o valor de venda do kit |
| DRE / Dashboard | Concluída. Eles leem `VendaItem.custoUnitario`, que agora é o custo real dos componentes no momento da venda |
| Relatórios | Parcial. Vendas do kit e consumo líquido por componente estão na aba e no endpoint, e as movimentações trazem o kit de origem. Não foi criado relatório dedicado no módulo Relatórios |
| IA NEXUS | Parcial. Usa os dados reais (custo, margem e vendas do kit já corretos). Não foi criado prompt ou ferramenta específica de rentabilidade de kits |

## Classificação das funcionalidades

| Funcionalidade | Situação |
|---|---|
| Tipo Kit (e Fábrica, Não classificado) sem alterar os existentes | Concluída e testada |
| Aba condicional "Composição do Kit", alinhada às demais | Concluída e testada |
| Busca de componentes reais (nome, código, código de barras, grupo, subgrupo, tipo) | Concluída e testada |
| Tabela (código, produto, tipo, quantidade, unidade, custo unitário, custo total, ações) | Concluída e testada |
| Unidades e conversões (KG/G, L/ML, CX/UN) com bloqueio de incompatíveis | Concluída e testada |
| Custo automático (item, total, por unidade do kit), sem mexer no preço | Concluída e testada |
| Baixa transacional dos componentes na venda, na filial da venda | Concluída e testada |
| Estoque insuficiente sem baixa parcial; regra de estoque negativo respeitada | Concluída e testada |
| Cancelamento e estorno sem duplicidade | Concluída e testada |
| Edição, auditoria e composição preservada em cada venda | Concluída e testada |
| Mudança de tipo protegida (Kit ↔ outro) | Concluída e testada |
| Ciclos, auto-referência, duplicados, inativos, isolamento por empresa e filial | Concluída e testada |
| Responsividade (computador, tablet e celular) | Concluída e testada |
| Relatório dedicado no módulo Relatórios | Pendente |
| Análise específica de kits na IA NEXUS | Pendente |
| Migração na produção e deploy | Bloqueada: depende da sua autorização |

## Pendências e observações

1. **Migração na produção:** aplicar `202611212000_produto_kit` antes do deploy (com backup, como nas anteriores). Exige autorização.
2. **Compras (já existia, fora do escopo):**
   - `POST /compras` usa "UN" quando o item não informa `unidadeCompra`, em vez da unidade de compra do cadastro. Produto estocado em kg sem unidade informada falha.
   - A conversão com fornecedor só procura fator do próprio fornecedor, e não cai no fator geral do produto.
3. **Kit dentro de kit:** não é permitido (decisão de segurança contra ciclos e baixa recursiva). Um produto fabricado com
   ficha técnica pode ser componente de um kit (é baixado como acabado).
4. Nada foi commitado nem publicado.

## Dependências externas

Nenhuma nova: nenhum pacote, serviço ou variável de ambiente.

## Arquivos

- **Backend (novos):**
  - `src/modules/produtos/kit.service.ts`
  - `prisma/migrations/202611212000_produto_kit/migration.sql`
  - `tests/produto-kit.test.ts`
- **Backend (alterados):**
  - `prisma/schema.prisma`
  - `src/modules/produtos/kits.routes.ts`, `produtos.routes.ts`, `produto-ficha.routes.ts` e `catalogo-produtos.service.ts`
  - `src/modules/vendas/vendas.routes.ts`
  - `src/modules/estoque/estoque.service.ts` e `conversao.service.ts`
  - `src/modules/compras/compras.routes.ts`
  - `src/modules/pdv/pdv.routes.ts`
- **Frontend (novos):**
  - `components/produto/AbaComposicaoKit.tsx`
  - `tests/composicao-kit.test.ts`
- **Frontend (alterados):**
  - `app/(dashboard)/produtos/[id]/page.tsx`
  - `components/produto/AbaDados.tsx`
  - `lib/produto-ficha.ts`

# Relatório — Evolução do módulo Produtos (ERP) — 2026-11-21

Branch local `feat/produtos-erp`, a partir da `main`. **Sem commit, sem push, sem deploy, sem migração na produção**, porque a
missão pede autorização para isso. Na produção, só uma consulta de leitura (contagem de cadastros).

> Observação: a missão cita "imagens de referência", mas **nenhuma imagem veio anexada**. A organização seguiu a
> descrição detalhada das abas e campos, com a identidade visual atual do NEXUS OS.

## 1. Diagnóstico inicial
- **O que já existia e funcionava:**
  - listagem de produtos (`/produtos`) com cadastro em modal;
  - estoque por filial (`Estoque`) com movimentações transacionais e protegidas contra corrida;
  - reservas do PDV, kits/ficha técnica e produção;
  - custo médio no recebimento de compra;
  - auditoria e permissões por módulo/ação; RLS por empresa.
- **Lacunas e problemas encontrados:**
  1. Sem ficha por abas: o produto só tinha um modal simples.
  2. **Catálogo de unidades e tipos nunca era criado**: na produção havia 0 unidades, 0 dimensões e 0 tipos. Unidade
     de compra/venda e conversão (caixa → unidade) eram impossíveis, e **não havia rota para gravar fator de conversão**.
  3. Movimentações **sem saldo anterior, saldo posterior e custo unitário**: não dava para rastrear.
  4. Produção registrava ENTRADA e SAÍDA genéricas, sem distinguir produção e consumo de insumo; não existia DESCARTE.
  5. **O recebimento de compra ignorava a política de custo do produto** (sempre média ponderada) e não guardava o último custo.
  6. **O cancelamento de venda estornava a quantidade de cada item, e não o que de fato tinha saído** (kit e sem-controle ficavam errados).
  7. Sem histórico de preços, códigos de barras múltiplos, dados fiscais (além do NCM), preço ou disponibilidade por
     filial e regime tributário da empresa.
  8. Comentário corrompido no schema (`EstoqueMovimentacao`).
- **Alarme falso verificado:** `PATCH /produtos/:id/status` não declara permissão na rota, mas checa `temPermissao` por dentro. Está correto.

## 2. Estrutura anterior × final
| | Antes | Depois |
|---|---|---|
| Ficha | Modal com ~15 campos | Página `/produtos/[id]` com 10 abas (a listagem abre a ficha) |
| Dados | Nome, SKU, marca, categoria, NCM | + referência, descrição resumida, fabricante, código externo, tipo, grupo + 3 subgrupos, 4 unidades + fator, centros de custo, localização, quantidade da embalagem, validade, 8 parâmetros |
| Preços | Custo, preço, promoção | + preço de compra, último custo, política de custo, tabelas A/B/C, desconto máximo, comissão, despesas, fornecedor, **markup × margem bruta × margem líquida**, simuladores, **histórico com justificativa** |
| Tributos | NCM | CEST, origem, CFOPs, CST ou CSOSN (pelo regime), ICMS, PIS, COFINS, IPI, IBS/CBS, natureza, informações adicionais, **validação pelas tabelas oficiais** |
| Códigos | 1 código | Vários por produto (EAN-13/8, UPC-A, GTIN-14, interno, PLU de balança), únicos na empresa, **lidos pelo PDV offline**, etiquetas EAN impressas |
| Estoque | Saldo por filial | + reservado, comprometido, disponível, segurança, ideal, densidade, peso da embalagem, lote, regras de negativo, movimentar e transferir pela ficha |
| Movimento | — | 8 subabas (notas de entrada, saída, cupom, manual, serviço; históricos de movimentação, preços e cadastro), filtros, paginação, **Excel e PDF** |
| Filial | — | Vínculo, disponibilidade, preço, custo, mínimo e máximo por filial, **aplicados na venda e no PDV** |
| PDV, Premiação, Integrações | — | Abas com o que o sistema de fato suporta, e o estado real de cada integração |

## 3. Banco de dados e Prisma
Migração `202611211500_produtos_erp`, **aditiva**: 0 DROP, 0 mudança de tipo, 0 NOT NULL sem padrão.
- `ALTER TYPE ADD VALUE`:
  - `TipoMovEstoque`: `PRODUCAO`, `CONSUMO_INSUMO`, `DESCARTE`;
  - `TipoProdutoEnum`: `MATERIA_PRIMA`, `PRODUTO_ACABADO`, `SERVICO`.
- **Produto:** 40 colunas novas, todas anuláveis ou com padrão, e 3 FKs de unidade.
- **Categoria:** `categoriaPaiId` e `nivel`, para a hierarquia.
- **Empresa:** `regimeTributario`.
- **EstoqueMovimentacao:** `saldoAnterior`, `saldoPosterior` e `custoUnitario`.
- **Tabelas novas** (todas com `empresaId`, então o RLS cobre automaticamente): `ProdutoFiscal` (1:1),
  `ProdutoCodigoBarras`, `ProdutoPrecoHistorico` e `ProdutoFilial`.
- **Validado:**
  - drift migrações × schema = 0;
  - aplicada no banco de teste;
  - RLS ativo nas 4 tabelas novas;
  - validação SQL 10/10.

## 4. Endpoints
| Endpoint | Novo ou alterado | Para quê |
|---|---|---|
| `GET /produtos/catalogos` | Novo | Unidades, tipos, categorias, filiais, fornecedores e regime (cria o catálogo padrão, de forma idempotente) |
| `GET /produtos/:id/ficha` | Novo | Tudo da ficha + saldos por filial + precificação (oculta custo sem `custos.visualizar`) |
| `POST /produtos`, `PUT /produtos/:id` | Alterado | +40 campos; permissão por grupo; justificativa; histórico de preços; código principal sincronizado |
| `PUT /produtos/:id/fator-conversao` | Novo | 1 CX = N UN (versiona: desativa o anterior) |
| `PUT /produtos/:id/fiscal` | Novo | Tributos com validação por regime (422 com o erro por campo) |
| `GET/POST/DELETE /produtos/:id/codigos-barras`, `GET /produtos/codigo/:codigo` | Novos | Códigos múltiplos e busca por qualquer código |
| `GET/PUT /produtos/:id/filiais` | Novos | Configuração por filial; desvínculo exige `produtos.administrar` e saldo zero |
| `GET /produtos/:id/movimentacoes` (+ `/exportar`) | Novos | Histórico filtrado e paginado; Excel e PDF |
| `GET /produtos/:id/documentos` | Novo | Entradas (compras), saídas, cupons, notas manuais |
| `GET /produtos/:id/historico-precos`, `/historico-cadastro`, `/integracoes` | Novos | Históricos e estado real das integrações |
| `POST /categorias` | Alterado | Aceita `categoriaPaiId` (até 3 subgrupos) |
| `PUT /empresas/:id` | Alterado | Aceita `regimeTributario` |
| `POST /estoque/movimentar`, `/estoque/transferir` | Alterados | DESCARTE; transferência negativa com autorização |
| `POST /vendas`, `/vendas/:id/cancelar` | Alterados | Preço/disponibilidade por filial; sem baixa para quem não controla estoque; estorno do que foi baixado |
| `POST /compras/:id/receber` | Alterado | Política de custo, último custo, preço de compra, histórico |
| `GET /pdv/catalogo` | Alterado | Códigos adicionais, preço e disponibilidade da filial, disponível no PDV, posição |
| Produção de kit | Alterado | Registra PRODUCAO e CONSUMO_INSUMO, com custo |

## 5. Integrações concluídas (fluxo comprovado nos testes)
- **Produto → compra → entrada no estoque:** recebimento → `COMPRA` com custo unitário → custo pela política → último custo → histórico.
- **Venda no PDV → baixa de estoque:** preço da filial aplicado na venda; baixa `VENDA` com saldo anterior e posterior;
  cancelamento estorna exatamente o baixado. CMV, DRE e indicadores já liam `VendaItem.custoUnitario`, que vem do custo do produto, e não mudaram.
- **Ficha técnica → produção:** `CONSUMO_INSUMO` (saída do insumo) e `PRODUCAO` (entrada do acabado com o custo da produção);
  o giro de estoque passou a contar o consumo de insumo.
- **PDV offline:** catálogo com todos os códigos; a bipagem encontra por código adicional (teste com IndexedDB).

## 6. Componentes
- **Criados:**
  - estrutura: `components/produto/ficha.module.css` (tokens), `ui.tsx` (Seção, Grade, Campo, Alternador, Botão, Tabela com
    ordenação, pesquisa, paginação e estados vazio/carregando, Modal, Métrica, Selo, Aviso, Célula), `formulario.ts`;
  - abas: `AbaDados`, `AbaPrecos`, `AbaTributos`, `AbaCodigos`, `AbaEstoque`, `AbaMovimento`, `AbaFilial`, `AbasComplementares` (PDV, Premiação, Integrações);
  - impressão: `impressao-etiquetas.css`;
  - bibliotecas: `lib/produto-ficha.ts` e `lib/codigo-barras-svg.ts` (EAN-13/8 sem dependências);
  - página: `app/(dashboard)/produtos/[id]/page.tsx`.
- **Reaproveitados:** cliente `lib/api.ts`, variáveis de tema `--nx-*`, layout do painel, catálogo do PDV offline (Dexie).
- **Sistema visual:** escala de espaçamento de 4 em 4 px (`--pf-1..6`); altura de campo e botão de 36 px; aba de 40 px;
  raios de 10 e 14 px; grade de 12 colunas que vira 4/3/2/1 por largura; recuo e largura máxima iguais aos da listagem.

## 7. Testes executados (resultados reais)
| Execução | Total | Aprovados | Falhas | Pulados |
|---|---|---|---|---|
| Backend completo, papel `postgres` | 417 | 406 | 0 | 11 |
| Backend completo, papel `nexus_app` + RLS | 426 | 416 | 0 | 10 |
| `produtos-ficha.test.ts` (integração, 15 cenários) + `produto-regras.test.ts` (11) | 26 | 26 | 0 | 0 |
| Frontend completo (inclui 6 novos) | 70 | 70 | 0 | 0 |
| Validação RLS (SQL) | 10 | 10 | 0 | — |
| Revisão visual: 10 abas × 3 telas (1440, 1024, 390) | 30 | 30 | 0 | — |

**Revisão visual (navegador real, build de produção):**
- nenhuma rolagem horizontal da página;
- 0 campos sobrepostos e 0 campos cortados;
- 0 erros de JavaScript e 0 violações de CSP.

As tabelas largas rolam dentro da própria caixa em telas menores, que é o comportamento planejado.

**Builds:** `prisma validate`/`generate`, `tsc` do backend e do frontend, `npm run build`, `next build` e `docker build`: todos OK.

## 8. Problemas encontrados e corrigidos durante o trabalho
1. **CSS de impressão**: a primeira versão escondia tudo em qualquer impressão, o que quebraria o cupom do PDV. Passou a
   valer só durante a impressão das etiquetas.
2. **Conteúdo encostado na lateral** e **entradas estreitas na aba Filial**: corrigidos e reconferidos nas 3 telas.
3. **Alternadores desalinhados** em linhas mistas e um **rótulo cortado**: corrigidos.
4. Texto só com espaços gerava alteração fantasma no formulário: corrigido.
5. Cinco falhas que eram **dos meus próprios testes** (vetor GS1 errado, chave de idempotência, status 201): corrigidas no teste, não no código.
6. Comentário corrompido no schema: corrigido.

## 9. Classificação
| Funcionalidade | Situação |
|---|---|
| Ficha por abas, navegação preservando dados, aviso ao sair | CONCLUÍDA E TESTADA |
| Aba Dados: campos, hierarquia, unidades, fator de conversão, parâmetros | CONCLUÍDA E TESTADA |
| Aba Preços: cálculos, justificativa, histórico, permissões | CONCLUÍDA E TESTADA |
| Aba Tributos: validação por regime | CONCLUÍDA E TESTADA |
| Aba Código de Barras: múltiplos códigos, duplicidade, PDV offline, etiquetas | CONCLUÍDA E TESTADA (a impressão física não foi testada numa impressora) |
| Aba Estoque: saldos, parâmetros, movimentar, transferir, negativo autorizado | CONCLUÍDA E TESTADA |
| Movimentações rastreáveis (saldo anterior/posterior/custo) | CONCLUÍDA E TESTADA |
| Aba Movimento: subabas, filtros, paginação, Excel/PDF | CONCLUÍDA E TESTADA |
| Aba Filial: preço e disponibilidade na venda e no PDV, desvínculo protegido | CONCLUÍDA E TESTADA |
| Política de custo no recebimento de compra | CONCLUÍDA E TESTADA |
| Produção com PRODUCAO/CONSUMO_INSUMO | CONCLUÍDA E TESTADA |
| Aba PDV | PARCIAL: disponibilidade, posição, imagem e fracionado são reais; adicionais, complementos e cozinha não existem no PDV |
| Aba Premiação | PARCIAL: parâmetros, vigência e histórico; não há cálculo nem pagamento de premiação |
| Aba Integrações (estado real) | CONCLUÍDA E TESTADA; as integrações em si: fiscal, balança e impressão de produção NÃO IMPLEMENTADAS |
| Controle de lote e validade por lote | PARCIAL: só a configuração; não há entrada por lote |
| Posição do produto na grade do PDV | IMPLEMENTADA, MAS NÃO TESTADA COMPLETAMENTE: o campo chega ao catálogo offline, mas a grade do PDV ainda ordena do jeito antigo |
| Notas fiscais (NF-e, NFC-e, serviço) | BLOQUEADA POR DEPENDÊNCIA EXTERNA: sem provedor fiscal homologado |

## 10. Pendências e riscos
- **Antes de publicar:** aplicar a migração na produção (backup, `migrate deploy` com o `nexus_migrator` e depois
  `01_rls_policies.sql`). O código novo lê as colunas novas: publicar sem a migração quebra o módulo.
- **Regime tributário** precisa ser informado em Configurações → Empresa. A tela de Configurações ainda não tem esse
  campo, só a API: é a próxima pequena entrega.
- **Avisos de hidratação** pré-existentes em outras telas (datas): não afetam a ficha.
- **Riscos:**
  - a validação fiscal confere formato e regime, mas **não** escolhe o CST certo para o produto (isso é da contabilidade);
  - o rateio de despesas na margem líquida é um percentual informado pelo usuário, não apurado do financeiro.

## 11. Arquivos
- **Backend modificados (12):**
  - `prisma/schema.prisma`;
  - `server.ts`;
  - módulos: `compras.routes.ts`, `empresa.routes.ts`, `estoque-indicadores.service.ts`, `estoque.routes.ts`,
    `estoque.service.ts`, `pdv.routes.ts`, `kits.routes.ts`, `produtos.routes.ts`, `vendas.routes.ts`.
- **Backend criados (7):**
  - migração `202611211500_produtos_erp`;
  - código: `catalogo-produtos.service.ts`, `produto-campos.ts`, `produto-ficha.routes.ts`, `produto-regras.ts`;
  - testes: `produto-regras.test.ts`, `produtos-ficha.test.ts`.
- **Frontend modificados (4):** `app/(dashboard)/produtos/page.tsx` (o clique abre a ficha), `lib/pdv/catalogo.ts`,
  `lib/pdv/sincronizarCatalogo.ts`, `lib/pdv/tipos.ts`.
- **Frontend criados (15):**
  - página: `app/(dashboard)/produtos/[id]/page.tsx`;
  - `components/produto/`: 12 arquivos;
  - bibliotecas: `lib/produto-ficha.ts`, `lib/codigo-barras-svg.ts`;
  - teste: `tests/produto-ficha.test.ts`.

# Relatório — Módulo de Fornecedores (cadastro completo por abas)

Data: 21/11/2026 · Branch: `feat/fornecedores` (sem commit; não publicada)

## 1. Situação anterior

- O fornecedor tinha poucos campos: nome, CNPJ (sem validação de dígitos), categoria, status (Ativo, Crítico ou Inativo),
  contato/telefone/whatsapp/e-mail como texto, endereço em texto livre, condição de pagamento e observações.
- Os produtos fornecidos eram uma lista em texto ("Camisa, Boné"). Cada produto aceitava **um único** fornecedor (`Produto.fornecedorId`).
- **Não existiam:**
  - vários contatos por fornecedor;
  - dados bancários e fiscais;
  - dados de compras e logística;
  - avaliação, documentos e busca de CEP;
  - código do fornecedor e status "Bloqueado";
  - campos de auditoria do cadastro.
- **Telas:**
  - Frontend: uma página única com tabela, filtros, indicadores, IA e um formulário simples em janela.
  - Backend: `/api/v1/fornecedores` (listagem, indicadores, sugestões da IA, exportação) e as rotas antigas `/fornecedores`, usadas por Compras.
- **Produção:** 1 fornecedor (ativo, sem CNPJ) e nenhuma compra (consulta somente leitura).

## 2. Encontrado e reutilizado

| Recurso | Uso |
|---|---|
| Rotas `/api/v1/fornecedores` (listagem, KPIs, insights, exportação, IA) | Mantidas e estendidas: código, UF, busca por código, nome fantasia e cidade, contagem por status e colunas novas na exportação |
| Rotas antigas `/fornecedores` (Compras) | Mantidas; ganharam o status Bloqueado e o código automático |
| Validador de CNPJ (`domain/cnpj.ts`) | Reutilizado |
| Armazenamento privado (`lib/storage.ts`, mesmo do RH) | Reutilizado nos documentos |
| Auditoria (`Auditoria`/`registrarAuditoria`) | Histórico de alterações campo a campo |
| `Compra` e `Financeiro` | Fonte real do histórico, do resumo e dos títulos a pagar |
| Catálogo central de `Produto` e `ProdutoFiscal` | Vínculo N:N; os dados fiscais vêm sempre do cadastro do produto |
| Componentes visuais da ficha de Produtos (`components/produto/ui.tsx` + tokens) | Base visual da ficha (mesmos campos, tabelas, abas e modais) |
| RLS genérico por `empresaId` (`01_rls_policies.sql`) | Cobre as 5 tabelas novas automaticamente |

## 3. Implementado

- **Ficha `/fornecedores/:id` e cadastro `/fornecedores/novo`:**
  - Cabeçalho fixo em todas as abas: código, loja/filial, status, tipo de pessoa, CNPJ/CPF com máscara e validação, razão social, nome fantasia e empresa.
  - Ações: Editar, Visualizar, Cancelar, Salvar e Salvar e fechar.
  - Rodapé de auditoria: criado por e em, última alteração por e em, preenchidos pelo servidor.
- **As 11 abas:**

  | Aba | O que traz |
  |---|---|
  | 01 Dados | Cartões Dados cadastrais, Contato principal e Situação, mais o Resumo (pedidos, títulos a pagar, total comprado no ano, nota) |
  | 02 Endereço | ViaCEP pelo servidor, edição manual, endereço de cobrança diferente e endereço alternativo |
  | 03 Contatos | Vários contatos, principal único, não exclui o último; site, e-mail de pedidos e e-mail de NF-e |
  | 04 Financeiro | Condição e forma de pagamento, PIX, dados bancários, limite, natureza, plano de contas e centro de custo |
  | 05 Fiscal | Contribuinte de ICMS, Simples, 6 retenções, CFOP de entrada e observações (informativo, sem cálculo) |
  | 06 Compras e Logística | Prazo, pedido mínimo, frete CIF/FOB, transportadora, comprador e condições |
  | 07 Produtos do Fornecedor | Vínculo com o catálogo central (detalhado abaixo) |
  | 08 Avaliação / Qualidade | Notas de 1 a 5, médias, homologação, validade das certidões com situação; indicador automático de pontualidade só com 3 ou mais compras recebidas |
  | 09 Documentos e Anexos | Tipo, nome, arquivo, envio (data e responsável), validade, status e remoção lógica com histórico |
  | 10 Histórico | Pedidos por status, total no período, contas a pagar abertas e pagas, alterações (usuário, data, campo, antes e depois) |
  | 11 Observações | Gerais, comerciais, restrições e orientações a compradores (uso interno) |

- **Aba 07 em detalhe:** vínculo com o catálogo central, com referência e código no fornecedor, descrição comercial, preço por fornecedor, último preço de compra, data de atualização, prazo, pedido mínimo, status e principal/alternativos. Os dados fiscais aparecem do cadastro do produto. Há busca, filtros, indicadores, histórico de preços, exportação CSV e remoção do vínculo sem excluir o produto.
- **Listagem:**
  - colunas Código, Cidade/UF, Última compra e Ações (ver, editar, bloquear/desbloquear), mais o nome fantasia;
  - aba Bloqueado, filtro por UF e busca por código, nome fantasia e cidade;
  - contadores Total, Ativos, Inativos, Bloqueados e Críticos.
  - "Novo Fornecedor" e o comando da IA "adicionar fornecedor X" abrem a ficha completa.
- **Regras:**
  - CNPJ e CPF validados (front e servidor); documento único por empresa.
  - Código sequencial por empresa, sob trava transacional.
  - Obrigatórios: tipo de pessoa, documento, razão social/nome, CEP, cidade, UF e ao menos um contato.
  - Bloqueado e Inativo **não recebem pedido**; Crítico recebe, porque é alerta e não bloqueio.
  - Dados bancários só aparecem e só mudam com `fornecedores.administrar`. Sem ela, vêm mascarados e a auditoria registra "(protegido)".
  - O preço por fornecedor exige `custos.visualizar` e `custos.editar`; os títulos exigem `financeiro.visualizar`; excluir contato ou documento exige `fornecedores.excluir`.
  - Remoções que afetariam o histórico são lógicas (documentos) ou mantêm o histórico (preços).

## 4. Frontend

- **Novos:**
  - `app/(dashboard)/fornecedores/[id]/page.tsx`
  - `components/fornecedor/AbasCadastro.tsx`, `AbasRelacionadas.tsx`, `formulario.ts` e `fornecedor.module.css`
  - `lib/fornecedor-ficha.ts`
  - `tests/fornecedor-ficha.test.ts`
- **Alterado:** `app/(dashboard)/fornecedores/page.tsx`, com mudanças pontuais. O layout, a IA, os gráficos e os insights foram mantidos.

## 5. Backend

- **Novos:**
  - `src/modules/fornecedores/fornecedor-ficha.routes.ts` e `fornecedor-ficha.service.ts`
  - `src/domain/cpf.ts`
  - `tests/fornecedores-ficha.test.ts`
- **Alterados:**
  - `fornecedores.service.ts` e `fornecedores.routes.ts`: Bloqueado, código, UF, busca, KPIs por status e exportação.
  - `compras.routes.ts`: código no cadastro antigo; pedido só para Ativo/Crítico; o recebimento atualiza o último preço do vínculo e o histórico.
  - `server.ts`: registro das rotas.
- **Endpoints novos:**
  - `GET /api/v1/cep/:cep`
  - `GET /api/v1/fornecedores/catalogos` e `GET /api/v1/fornecedores/alertas-documentos`
  - `GET /api/v1/fornecedores/:id/ficha`, `POST /api/v1/fornecedores/ficha` e `PUT /api/v1/fornecedores/:id/ficha`
  - `…/:id/contatos` (GET, POST, PUT e DELETE)
  - `…/:id/produtos` (GET, POST, PUT e DELETE), mais `…/produtos/candidatos`, `…/produtos/exportar` e `…/produtos/:produtoId/precos`
  - `…/:id/avaliacoes` (GET e POST)
  - `…/:id/documentos` (GET, POST, PUT e DELETE) e `…/documentos/:docId/arquivo`
  - `…/:id/historico`

## 6. Banco de dados e 7. Migração

Migração `202611212200_fornecedores_cadastro`, **100% aditiva**:

- **Na tabela de fornecedores:** campos novos opcionais ou com padrão. A coluna `status` continua TEXT e passa a aceitar "Bloqueado".
- **Tabelas novas:** `FornecedorContato`, `FornecedorProduto`, `FornecedorPrecoHistorico`, `FornecedorDocumento` e `FornecedorAvaliacao`.
- **Índices:** `@@unique([empresaId, codigo])` e índice por UF.
- **Chaves estrangeiras:** com `Restrict`, `SetNull` ou `Cascade`, conforme o caso.
- **Dado preenchido:** só o código sequencial dos fornecedores existentes (coluna nova).
- **O que não há:** nenhum `DROP` e nenhum `ALTER COLUMN`.

Aplicada **somente no banco de teste local**; na produção **não**. O drift entre migrações e schema é 0.

## 8. Integrações

- **Compras:**
  - bloqueio de pedido por status;
  - último preço do vínculo e histórico atualizados no recebimento;
  - histórico, resumo e títulos lidos das compras reais.
- **Financeiro:** títulos a pagar e pagos das compras do fornecedor.
- **Produtos:**
  - vínculo N:N com o catálogo central;
  - o principal é espelhado em `Produto.fornecedorId` (o que Produtos e as integrações já usam);
  - os dados fiscais vêm sempre do produto.
- **Estoque:** nenhum produto é excluído ao remover um vínculo.
- **ViaCEP:** chamado pelo servidor, então a política de segurança do site (CSP) não muda.

## 9. RLS

As 5 tabelas novas têm `empresaId` e recebem a política `nexus_tenant` pelo laço genérico de `01_rls_policies.sql`, já reaplicado no banco de teste. O teste completo rodou com o papel `nexus_app` (RLS ativo, sem BYPASSRLS): 455 passaram, 0 falharam. Nenhuma política foi enfraquecida.

## 10. Testes

| Suíte | Resultado |
|---|---|
| `backend/tests/fornecedores-ficha.test.ts` (10 cenários) | Passou com `postgres` e com `nexus_app` |
| Teste antigo `fornecedores-aba` | 78 de 78 (pegou e confirmou a correção de uma regressão minha na busca por CNPJ) |
| Backend completo no modo CI, `postgres` | 445 passaram, 0 falharam |
| Backend completo no modo CI, `nexus_app` | 455 passaram, 0 falharam |
| Frontend (`tsc` + testes) | 77 de 77 |
| Builds (backend, imagem Docker, Next) e drift | OK, drift 0 |

**Revisão visual:**
- Telas cobertas: 11 abas, edição, cadastro novo e listagem, em 3 resoluções (1440, 1024 e 390 px).
- Resultado: rolagem horizontal 0, nenhum campo cortado ou sobreposto, 0 erros nas páginas novas.
- Pela interface: salvar, recarregar e conferir funcionou (persistência), o histórico registrou a alteração, e o cadastro vazio apontou os obrigatórios.

## 11. Problemas encontrados

1. **Regressão que eu introduzi (corrigida):** a busca por código tratava um CNPJ de 14 dígitos como código e estourava o tipo inteiro. Agora o código vai até 9 dígitos. Foi pega pelo teste antigo.
2. **Erros de hidratação do React (#418, #423, #425) na listagem `/fornecedores`:** **já existiam na `main`** (verificado com o build da `main`). Não fazem parte desta mudança e não foram tocados.
3. **Crítico:** Compras antes recusava fornecedor "Crítico"; agora Crítico recebe pedido e só Bloqueado e Inativo são barrados.

## 12. Pendências e dependências externas

- **Anexos (aba 09):** dependem do `STORAGE_BUCKET` (Supabase Storage) configurado no Render. Sem ele, o envio responde com erro claro e a lista e as validades continuam funcionando. Não verificado na produção.
- **ViaCEP:** serviço público. Se estiver fora do ar, o endereço é preenchido manualmente.
- **Migração na produção:** pendente; depende da sua autorização (com backup, como nas anteriores).
- O comando de IA dedicado a fornecedores não foi alterado, só o atalho de "adicionar".

## Classificação

| Funcionalidade | Situação |
|---|---|
| Cabeçalho fixo, código automático, ações e rodapé de auditoria | IMPLEMENTADA E TESTADA |
| Validação de CNPJ/CPF e documento único por empresa | IMPLEMENTADA E TESTADA |
| Abas Dados, Endereço, Financeiro, Fiscal, Compras e Logística, Observações (persistência) | IMPLEMENTADA E TESTADA |
| Busca de CEP (ViaCEP) | IMPLEMENTADA, MAS NÃO TESTADA: o teste cobre a validação; a chamada real depende do serviço externo |
| Contatos múltiplos com principal | IMPLEMENTADA E TESTADA |
| Dados bancários protegidos e auditados | IMPLEMENTADA E TESTADA |
| Produtos do fornecedor (vínculo, preços, histórico, principal, remoção, exportação) | IMPLEMENTADA E TESTADA |
| Último preço pelo recebimento de compra | IMPLEMENTADA E TESTADA |
| Bloquear; bloqueado e inativo sem pedido | IMPLEMENTADA E TESTADA |
| Avaliação, homologação, certidões e alertas | IMPLEMENTADA E TESTADA |
| Documentos: lista, validade, alertas, remoção lógica | IMPLEMENTADA E TESTADA (sem storage) |
| Documentos: envio e download de arquivo | BLOQUEADA POR DEPENDÊNCIA EXTERNA (STORAGE_BUCKET) |
| Histórico (pedidos, títulos, alterações) | IMPLEMENTADA E TESTADA |
| Listagem: código, UF, status Bloqueado, contadores e ações | IMPLEMENTADA E TESTADA |
| Isolamento entre empresas e permissões | IMPLEMENTADA E TESTADA |
| Responsividade (desktop, notebook, celular) | IMPLEMENTADA E TESTADA |
| IA, gráficos e insights da listagem | EXISTENTE E REUTILIZADA |
| Migração na produção e deploy | PENDENTE (autorização) |

# Relatório — Módulo de Compras completo

Data: 21/11/2026 · Branch: `feat/compras-erp` (sem commit; não publicada)

## 1. Situação anterior

- **Rotas:** listar, ver, criar e editar compra; confirmar; receber (tudo-ou-nada); cancelar.
- **Status:** só 4 — SOLICITADA, PEDIDO, RECEBIDA e CANCELADA.
- **O recebimento:**
  - já dava entrada no estoque, com conversão de unidade e custo;
  - já atualizava o vínculo fornecedor×produto e o custo dos kits;
  - já criava 1 conta a pagar no valor total.
- **O que não existia:**
  - número do pedido, responsável, previsão de entrega, prioridade e observações;
  - frete, desconto e outras despesas;
  - aprovação e envio ao fornecedor;
  - recebimento parcial e conferência com avaria ou recusa;
  - nota fiscal de entrada;
  - histórico por compra.
- **Tela:** uma única página com lista e formulário.
- **E-mail:** Resend já integrado, mas só para recuperação de senha. **WhatsApp:** inexistente.
- **Produção:** 0 compras.

## 2. Reutilizado

| Recurso | Uso |
|---|---|
| `aplicarMovimento`, conversão de unidades, política de custo, histórico de preços, custo de kits | Movidos para `compra.service.ts` e usados pelo recebimento parcial e pelo total |
| Rotas `/compras*` | Mantidas; o recebimento antigo virou o "recebimento total" do serviço |
| Fornecedores (status, contatos, produtos vinculados, preço por fornecedor) | Aba Fornecedor, bloqueio de pedido e último preço |
| `lib/email.ts` (Resend) | Envio do pedido com PDF anexo, agora com suporte a anexo |
| `lib/pdf.ts` | PDF do pedido |
| `Documento` + `lib/storage.ts` | Anexos da compra e XML/DANFE da NF |
| `Auditoria` | Histórico por compra e geral |
| UI das fichas (`components/produto/ui.tsx` e tokens) | Visual da tela principal e da ficha |

## 3. Implementado

- **Tela principal `/compras`:**
  - 8 indicadores reais;
  - abas Pedidos, Recebimentos, Notas Fiscais e Histórico, com filtros de número, fornecedor, status, filial, responsável e período;
  - ações Ver, Editar, Enviar, Duplicar, Histórico e Cancelar;
  - opção "Exigir aprovação antes do envio";
  - botão **Nova compra**.
- **Ficha `/compras/nova` e `/compras/:id`:**
  - cabeçalho fixo (número, empresa, filial, data, responsável, fornecedor e previsão) e barra de etapas;
  - ações do fluxo, só as válidas para o status;
  - Salvar, Salvar e fechar, Cancelar, Editar e Visualizar;
  - rodapé de auditoria;
  - as **6 abas**:

  | Aba | O que traz |
  |---|---|
  | Dados da Compra | Dados do pedido, totais, anexos, aprovação e próximo passo |
  | Produtos | Busca no cadastro central, quantidade, unidade, valor, desconto e observação; custo atual e último preço do fornecedor |
  | Fornecedor | Dados carregados do cadastro, produtos vinculados ("adicionar ao pedido"), prévia e envio |
  | Financeiro | Valores, condição, forma, parcelas, 1º vencimento, conta, centro de custo, plano, cronograma previsto e contas geradas |
  | Recebimento | Conferência (recebido, avariado, recusado e divergência), recebimentos anteriores com movimentações, NF-e |
  | Histórico | Trajetória completa com valor anterior e novo |

- **Fluxo:**
  - Os status: Rascunho → (Aguardando aprovação → Aprovada) → Enviada → Confirmada → Parcialmente recebida → Recebida → Concluída.
  - A aprovação é opcional por empresa e exige `compras.administrar` quando ativa.
  - Transições inválidas são recusadas.
- **Recebimento parcial:**
  - **pedido não movimenta estoque**: só o recebimento confirmado movimenta;
  - recebimento atômico, com trava da compra e chave de idempotência;
  - quantidade acima do pendente é recusada;
  - a entrada vai para a filial da compra, convertida para a unidade do produto;
  - a movimentação fica vinculada a `recebimentoId`.
- **Financeiro:**
  - as contas a pagar são criadas **no recebimento**, proporcionais ao que chegou, com frete, desconto e despesas rateados e parcelas conforme a condição;
  - o último recebimento fecha o total exato;
  - repetir o mesmo recebimento não duplica nada.
- **Cancelamento:**
  - antes de qualquer recebimento, com motivo registrado;
  - compra parcial não cancela (as entradas são mantidas); **Concluir** encerra o saldo.
- **Notas fiscais:**
  - número, série, chave de 44 dígitos (única por empresa), emissão, entrada e valor;
  - divergência de valor detectada;
  - conferida/divergente;
  - XML e DANFE como anexo.
- **Envio ao fornecedor:**
  - prévia e PDF;
  - e-mail com PDF anexo;
  - WhatsApp pela API oficial da Meta ou "abrir conversa" (wa.me);
  - cada tentativa registrada com o resultado **real**.

## 4–5. Arquivos

- **Backend (novos):**
  - `src/modules/compras/compra.service.ts`, `compra-ficha.routes.ts` e `canais-envio.ts`
  - `prisma/migrations/202611220000_compras_completo/`
  - `tests/compras-ficha.test.ts`
- **Backend (alterados):**
  - `prisma/schema.prisma`
  - `src/modules/compras/compras.routes.ts` (rotas antigas ligadas ao serviço novo)
  - `src/lib/email.ts` (`enviarEmail` exportado, com anexo, reply-to e id)
  - `src/modules/estoque/estoque.service.ts` (`recebimentoId`)
  - `src/modules/estoque/conversao.service.ts` (cai no fator geral do produto; detalhes no item 11)
  - `src/server.ts`
  - `tests/compras-aba.test.ts` (ordem da limpeza)
- **Frontend (novos):**
  - `app/(dashboard)/compras/[id]/page.tsx`
  - `components/compra/AbasCompra.tsx` e `formulario.ts`
  - `lib/compra-ficha.ts`
  - `tests/compra-ficha.test.ts`
- **Frontend (alterados):**
  - `app/(dashboard)/compras/page.tsx` (tela principal reescrita no novo padrão)
  - `components/fornecedor/fornecedor.module.css` (classe `.duasColunas`)

## 6–7. Banco e migração

Migração `202611220000_compras_completo`, **100% aditiva**:

- **Status:** 6 valores novos no enum de status da compra.
- **Compra:** colunas opcionais ou com padrão, `@@unique([empresaId, numero])` e índice por status.
- **CompraItem:** `quantidadeRecebida`, `desconto` e `observacao`.
- **Empresa:** `comprasExigeAprovacao`.
- **EstoqueMovimentacao:** `recebimentoId`.
- **Tabelas novas:** `CompraRecebimento`, `CompraRecebimentoItem`, `CompraNotaFiscal` e `CompraEnvio`.
- **Dados preenchidos (só colunas novas):** o número das compras existentes e o recebido das compras já RECEBIDAS.
- **O que não há:** nenhum `DROP` e nenhum `ALTER COLUMN`.

Aplicada **só no banco de teste local**; **não na produção**. O drift entre migrações e schema é 0.

## 8. Integrações

| Módulo | Situação |
|---|---|
| Fornecedores | Dados, contatos, produtos vinculados, bloqueio (Bloqueado/Inativo não criam, não aprovam, não enviam), último preço no recebimento |
| Produtos | Seleção do cadastro central, custo atual, último preço do fornecedor, histórico de preços (link para a ficha) |
| Estoque | Entrada só no recebimento confirmado, por filial, com conversão e rastreio pedido → recebimento → movimentação |
| Financeiro | Contas a pagar proporcionais por recebimento, parcelas, centro de custo, sem duplicidade |
| Notas fiscais | Notas de entrada vinculadas a pedido e recebimento, chave única, divergências, anexos |
| E-mail | Resend (configurado por variável de ambiente) |
| WhatsApp | API oficial (configurada por variável de ambiente) ou conversa manual |

## 9. RLS

As 4 tabelas novas têm `empresaId` e entram na política genérica do `01_rls_policies.sql`, já reaplicado no banco de teste. O teste completo rodou com o papel `nexus_app` (RLS ativo, sem BYPASSRLS): 467 passaram, 0 falharam.

## 10. Testes

| Suíte | Resultado |
|---|---|
| `tests/compras-ficha.test.ts` (11 blocos) | Passou |
| Backend completo no modo CI, `postgres` | 457 passaram, 0 falharam |
| Backend completo no modo CI, `nexus_app` | 467 passaram, 0 falharam |
| Testes antigos de compras, fornecedores, kit e produtos | Passaram (o recebimento antigo virou o total do serviço) |
| Frontend (`tsc` + testes) | 81 de 81 |
| Drift, build do backend, imagem Docker e `next build` | OK, drift 0 |

**Revisão visual:**
- Telas cobertas: as 4 abas da tela principal, as 6 abas da ficha, a edição e a compra nova, em 3 resoluções.
- Checagens: rolagem horizontal 0, nada cortado ou sobreposto, 0 erros JS/CSP.
- Persistência pela interface: salvar, recarregar e conferir funcionou, e o histórico registrou a alteração.

## 11. Problemas encontrados e corrigidos

1. **Conversão em compras (já existia):** com o fornecedor informado, o fator geral do produto (1 CX = 12 UN) era ignorado e a compra em embalagem falhava. Agora o fator específico do fornecedor tem prioridade, e o fator geral vale quando não há um específico.
2. **Lista de pedidos:** clicar na aba já ativa limpava a lista sem recarregar. Corrigido.
3. **Celular:** o cartão de totais ficava espremido. Agora o layout tem uma coluna em telas pequenas.

## 12. Pendências e dependências externas

**E-mail (pronto, falta configurar).** Variáveis no Render:
- `RESEND_API_KEY`;
- `EMAIL_FROM`, com o domínio verificado na Resend;
- `COMPRAS_EMAIL_RESPOSTA` (opcional).

Sem essas variáveis, o envio fica registrado como "não configurado" e nada é simulado.

**WhatsApp (pronto, falta configurar).** Variáveis no Render:
- `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` (Meta Business / WhatsApp Cloud API);
- `WHATSAPP_TEMPLATE`, um template aprovado com cabeçalho de documento e 1 parâmetro.

As instruções completas estão em comentário em `canais-envio.ts`. A confirmação de entrega por webhook **não** foi implementada.

**Anexos (XML, DANFE, documentos):** dependem do `STORAGE_BUCKET` no Render (pendência anterior).

**Ainda não feito:**
- migração na produção (depende da sua autorização, com backup);
- depósito/local por recebimento: o sistema trabalha por filial, sem depósito.

## Classificação

| Funcionalidade | Situação |
|---|---|
| Tela principal (indicadores, 4 abas, filtros, ações) | IMPLEMENTADA E TESTADA |
| Ficha com cabeçalho, etapas e 6 abas; Salvar, Salvar e fechar, Cancelar, Editar e Visualizar | IMPLEMENTADA E TESTADA |
| Número automático, totais, edição restrita por status | IMPLEMENTADA E TESTADA |
| Fluxo e aprovação configurável; transições inválidas bloqueadas | IMPLEMENTADA E TESTADA |
| Produtos do cadastro central, custo e último preço | IMPLEMENTADA E TESTADA |
| Fornecedor carregado, produtos vinculados, bloqueio | IMPLEMENTADA E TESTADA |
| Recebimento parcial e total, idempotência, estoque por filial, conversão | IMPLEMENTADA E TESTADA |
| Financeiro proporcional, parcelas, sem duplicidade | IMPLEMENTADA E TESTADA |
| Notas fiscais (dados, chave única, divergência, conferência) | IMPLEMENTADA E TESTADA |
| Cancelamento com motivo; concluir saldo | IMPLEMENTADA E TESTADA |
| PDF do pedido | IMPLEMENTADA E TESTADA |
| Abrir conversa no WhatsApp (wa.me), registro como conversa aberta | IMPLEMENTADA E TESTADA |
| Envio por e-mail (Resend) | IMPLEMENTADA, MAS NÃO TESTADA (chave não configurada) |
| Envio pela API do WhatsApp | BLOQUEADA POR DEPENDÊNCIA EXTERNA (conta Meta) |
| Anexos de compra e XML/DANFE | BLOQUEADA POR DEPENDÊNCIA EXTERNA (STORAGE_BUCKET) |
| Histórico por compra e geral | IMPLEMENTADA E TESTADA |
| Isolamento entre empresas, permissões e RLS | IMPLEMENTADA E TESTADA |
| Responsividade | IMPLEMENTADA E TESTADA |
| Migração na produção e deploy | PENDENTE (autorização) |

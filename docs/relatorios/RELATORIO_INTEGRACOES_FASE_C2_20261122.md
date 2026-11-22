# Integrações — Fase C2: cobranças do Asaas e do Mercado Pago no Financeiro

Data: 22/11/2026 · Branch: `feat/integracoes-fase-c2` · Migração: `202611250000_financeiro_cobranca` (somente aditiva, **não aplicada na produção**)

## O que mudou
- Detalhe de uma conta a receber pendente: painel **Cobrança**.
  - **Asaas** (boleto, PIX ou "cliente escolhe"): reaproveita o cliente pelo CPF/CNPJ (`GET /v3/customers?cpfCnpj=`) ou cria (`POST /v3/customers`); cria a cobrança (`POST /v3/payments`, `externalReference` = id do lançamento); vencimento no passado vira hoje (o Asaas não aceita data passada).
  - **Mercado Pago**: link de pagamento (`POST /checkout/preferences`, `external_reference` = id do lançamento, `notification_url` por empresa — nada a configurar no painel deles).
  - Link com Copiar/Abrir; status no provedor; data do pagamento.
- **Baixa automática segura**: o aviso (webhook) só dispara uma consulta. O servidor consulta o pagamento na API do provedor com a credencial da **própria empresa** e só dá baixa se estiver pago, se a referência for um lançamento desta empresa e se o valor conferir **ao centavo**. A baixa é condicional (PENDENTE/VENCIDO → PAGO): avisos repetidos ou simultâneos não baixam duas vezes.
  - Asaas: `POST /integracoes/asaas/webhook/:id` exige `asaas-access-token` igual ao **Token do webhook** (campo avançado novo, 32–255 caracteres). Botão **Atualizar status** consulta `GET /v3/payments/{id}`.
  - Mercado Pago: `POST /integracoes/mercadopago/webhook/:id` → `GET /v1/payments/{id}` (pago = `approved`). A assinatura `x-signature` não é usada porque o formato exato não consta na documentação lida; a segurança vem da consulta à API.
- Financeiro: campos `cobrancaProvedor`, `cobrancaId`, `cobrancaUrl`, `cobrancaStatus`, `pagamentoExternoId`, `pagoEm`.
- Permissão: gerar/atualizar cobrança exige `financeiro.criar`; limites de tentativa por empresa; webhooks limitados por IP.

## Testes
| Verificação | Resultado |
|---|---|
| Backend completo (`postgres`) | 492 passaram, 0 falharam |
| Backend completo (`nexus_app`) | 502 passaram, 0 falharam |
| Testes novos da C2 | 8/8 |
| Frontend | 85/85; tsc, next build e imagem Docker OK |
| Revisão visual (desktop e celular) | sem erros, sem rolagem horizontal |

Comprovado: baixa só da própria empresa, valor ao centavo, idempotente, 5 avisos simultâneos → 1 baixa; despesa e lançamento pago recusados; provedor desconectado → 409; **Asaas e Mercado Pago reais recusaram as credenciais fictícias** e nada foi gravado; webhook do Asaas sem token/token errado → 401; **corpo "approved" falso não baixa nada**; registro de um provedor não serve para o outro; permissão e isolamento.

**Não validado**: cobrança real criada e paga (sem chaves de sandbox).

## Para usar
1. Asaas: na Central, salvar a chave e um **Token do webhook**; no painel do Asaas, cadastrar o webhook com a URL exibida na Central, o mesmo token e os eventos de cobrança.
2. Mercado Pago: só conectar o Access Token na Central (a URL de aviso vai em cada link).
3. `API_PUBLIC_URL` no Render (endereço público da API) para montar as URLs de aviso.

# Central de Integrações — Fase B (WooCommerce, Mercado Pago, WhatsApp Business, E-mail)

Data: 22/11/2026 · Branch: `feat/integracoes-fase-b` · Migração: `202611240000_integracoes_mensagens` (somente aditiva, **não aplicada na produção**)

## 1. Situação por integração

| Integração | Classificação | Autenticação | Teste de conexão (leitura oficial) | Pendência |
|---|---|---|---|---|
| WooCommerce | IMPLEMENTADA, AGUARDANDO CREDENCIAIS | Basic Auth (Consumer Key/Secret) sobre HTTPS | `GET <loja>/wp-json/wc/v3/orders?per_page=1` | Chave real; importação de pedidos (Fase C) |
| Mercado Pago | IMPLEMENTADA, AGUARDANDO CREDENCIAIS | `Authorization: Bearer <Access Token>` | `GET https://api.mercadopago.com/v1/payment_methods` | Token real; nome da conta não exibido (endpoint de usuário não consta na referência oficial); webhooks e Financeiro (Fase C) |
| WhatsApp Business | IMPLEMENTADA, AGUARDANDO CREDENCIAIS | Cloud API (Meta) — Access Token | `GET graph.facebook.com/<versão>/<PHONE_NUMBER_ID>` | Token permanente, número e modelos aprovados na Meta |
| E-mail da empresa | IMPLEMENTADA, AGUARDANDO CREDENCIAIS | SMTP (TLS) + IMAP opcional, senha de app | `transporter.verify()` + `status('INBOX')` | Conta real; login Google/Microsoft (OAuth) **com bloqueio externo**: exige app aprovado nesses provedores |

Documentação oficial consultada: WooCommerce REST API, referência do Mercado Pago, WhatsApp Cloud API (webhooks, status, templates, números), Nodemailer e ImapFlow.

## 2. O que funciona

### WhatsApp Business
- Campos: Phone Number ID, WABA ID, Meta App ID, Access Token; avançados: App Secret, Verify Token, versão da Graph API (padrão v23.0).
- Envio real: texto (janela de 24 h) ou **modelo aprovado** com parâmetros; erro 131047 explicado; erro 190 marca a integração como "Reconectar".
- Webhook por empresa: `GET/POST /integracoes/whatsapp/webhook/:registroId`.
  - GET: `hub.verify_token` comparado em tempo constante → devolve `hub.challenge`.
  - POST: `X-Hub-Signature-256` = HMAC-SHA256 do **corpo bruto** com o App Secret; sem App Secret, nada entra.
  - Só aceita eventos do `phone_number_id` da própria empresa.
  - Mensagens recebidas gravadas uma vez (wamid único por empresa); status de entrega só avança (gravação condicional atômica).
- Histórico próprio (mensagens enviadas/recebidas, status, falhas) + eventos da integração. URL do webhook exibida com botão Copiar.

### E-mail da empresa
- Envio por SMTP (STARTTLS 587 ou SSL/TLS 465, TLS 1.2+), HTML/texto, até 10 arquivos/10 MB, Reply-To; assunto com quebra de linha neutralizado (anti-injeção de cabeçalho).
- Caixa de entrada (IMAP, opcional): lista remetente, assunto, data e lido/não lido das mensagens recentes (sem baixar o conteúdo).
- Histórico de envios (destinatários, assunto, status, Message-ID — nunca corpo ou anexo).

### WooCommerce e Mercado Pago
- Telas próprias, teste real, credenciais cifradas. Asaas (Fase A) inalterado.

## 3. Segurança
- Segredos cifrados (AES-256-GCM), mascarados, nunca devolvidos; nada em `localStorage`.
- **SSRF**: URL da loja só HTTPS pública, sem credenciais embutidas, porta 443/8443, sem seguir redirecionamentos; hosts SMTP/IMAP só públicos e portas da lista. Bloqueia loopback, redes privadas, link-local/metadados de nuvem, CGNAT, multicast e equivalentes IPv6.
- **DNS rebinding (e-mail)**: o host é resolvido e validado uma vez; a conexão vai ao IP validado e o nome fica só no TLS (SNI e certificado).
- **Limites**: testar/salvar/caixa de entrada 20 por 10 min por empresa; envios 120/min por empresa; webhook 600/min por IP antes de qualquer consulta.
- Isolamento: empresa da sessão; webhook de uma empresa não aceita assinatura de outra; RLS nas tabelas novas.

## 4. Análise e correções
A análise minuciosa encontrou e esta fase corrigiu:
1. **Status de entrega podia regredir** com avisos simultâneos ("entregue" sobrescrevendo "lida"). Corrigido com update condicional. O teste novo **falhou contra o código antigo** (rodada 1) e passa com a correção.
2. Falta de limite de tentativas (abuso como varredor de portas/SMTP). Corrigido.
3. DNS rebinding em SMTP/IMAP. Corrigido.
4. Webhook público sem limite. Corrigido.
5. Revisão visual: barra de abas da janela era espremida com muitos campos (afetava também a Fase A). Corrigido; título do e-mail alinhado ao card.

Pendências da análise (não feitas nesta fase): WooCommerce ainda resolve DNS na conexão (risco reduzido por não seguir redirecionamentos); validação cruzada porta × segurança no e-mail; falha transitória rebaixa status conectado; telefone sem DDI assume +55; aviso de que a URL do webhook muda ao remover/reconectar; cards "E-mail Transacional"/Gemini por presença de variável; consentimento (opt-in) e retenção de mensagens (LGPD); permissão específica para envio; Compras ainda usa WhatsApp/e-mail do servidor (unificar na Fase C).

## 5. Testes
| Verificação | Resultado |
|---|---|
| Backend completo (`postgres`) | 484 passaram, 0 falharam |
| Backend completo (`nexus_app`) | 494 passaram, 0 falharam |
| Testes da Fase B | 17 (SSRF, assinatura, desafio, telefone, e-mail, anti-rebinding, provedores reais, webhook, idempotência, simultaneidade, isolamento, limite 429) |
| Frontend | 85/85 |
| TypeScript, `next build`, imagem Docker, drift | OK / 0 |
| Revisão visual (desktop e celular) | sem rolagem horizontal, sem erro JS, abas com 41 px |

Respostas reais dos provedores com credenciais fictícias: Meta → erro 190 (token inválido); Mercado Pago → 400 `invalid_token` (tratado como credencial inválida); WooCommerce em host sem loja → "REST API não encontrada". **Nenhuma conexão bem-sucedida foi validada** (sem credenciais reais); envio real de e-mail e leitura IMAP não foram executados contra servidor real.

## 6. Dependências novas
`nodemailer@10.4.0` e `imapflow@2.11.0` (versões publicadas há mais de duas semanas; Node 22 na imagem). Tipagem mínima do nodemailer em `src/types/nodemailer.d.ts`.

## 7. Configuração
`API_PUBLIC_URL` (backend) — endereço público da API para montar a URL do webhook do WhatsApp.

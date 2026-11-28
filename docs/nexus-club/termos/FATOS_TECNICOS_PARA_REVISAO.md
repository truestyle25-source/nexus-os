# NEXUS OS / NEXUS CLUB — fatos técnicos para a revisão dos Termos e da Política

Levantado no código e na configuração em 27/11/2026, para quem for revisar a minuta
"Termos de Uso e Política de Privacidade — NEXUS OS e NEXUS CLUB" (versão 0.1).
Cada item diz se foi **verificado** (no código, na configuração ou no banco de produção) ou se
**falta confirmar**. Nenhum valor secreto foi aberto.

## 1. Campos da minuta que só a empresa pode preencher (21)
Razão social, CNPJ, endereço completo, e-mail de contato, canal/URL de suporte, canal de segurança,
e-mail/WhatsApp/endereço de suporte, e-mail e formulário de privacidade, encarregado (DPO) ou canal,
link da lista de fornecedores, URL da Política, painel de cookies (ver item 6), canal de atendimento da
empresa vendedora, data de publicação.

## 2. Fornecedores e onde ficam os dados (para os itens 7 e 8 da Política)
| Serviço | Fornecedor | Situação |
|---|---|---|
| Banco de dados (todos os dados das empresas e do NEXUS CLUB) | Supabase (Postgres), servidor **AWS us-east-1 (Virgínia, EUA)** | **verificado** no endereço do banco de produção → há **transferência internacional** |
| Arquivos (anexos, fotos de produto) | Supabase Storage, mesmo projeto | verificado (configuração) |
| Servidor da aplicação (backend) | Render | verificado; **região a confirmar** no painel do Render |
| Site (frontend) | Vercel | verificado; região/edge a confirmar |
| E-mails (confirmação de conta, nova senha, avisos) | Resend | verificado no código |
| Inteligência artificial (NEXUS AI) | Google Gemini (API) | verificado no código |
| WhatsApp | Meta (WhatsApp Business / Graph API), por empresa | verificado no código |
| Pagamentos (cobrança a partir do Financeiro) | Asaas e Mercado Pago, por empresa | verificado no código |
| Marketplaces/lojas | Mercado Livre, Shopee, WooCommerce, por empresa | verificado no código |
| Backups diários (cifrados, com teste de restauração) | GitHub Actions + armazenamento compatível com S3 | verificado; **provedor e país do armazenamento a confirmar** |

## 3. Segurança realmente implantada (item 10 da Política — pode ser descrita sem exagero)
Verificado:
- senhas guardadas com bcrypt (nunca em texto);
- isolamento entre empresas no próprio banco (Row Level Security), com testes automáticos a cada mudança;
- conta do consumidor separada: a empresa não vê a conta global nem dados de outro clube (testado);
- CPF do consumidor guardado cifrado (AES-256-GCM) e buscado por código irreversível (HMAC);
- credenciais de integrações cifradas;
- limite de tentativas de login e de cadastro;
- registro de auditoria das ações;
- backups diários cifrados com teste de restauração;
- conexões por HTTPS (Render e Vercel).
**Não existe** hoje: autenticação em dois fatores (MFA). A minuta não deve afirmar MFA.

## 4. Dados que o cadastro do NEXUS CLUB pede hoje
Nome, e-mail, **CPF (obrigatório)**, senha, celular (opcional), WhatsApp (opcional),
**data de nascimento (opcional)**, aceite dos Termos e da Política (com versão, data e IP).
Decisões que dependem de vocês (a minuta pede no item 15 e no checklist):
1. **Idade mínima** para usar o NEXUS CLUB. Hoje o sistema não confere idade.
2. **Data de nascimento**: ainda não tem finalidade definida (aniversário/benefícios são "futuro" no plano).
   Recomendação técnica: tirar o campo do cadastro até a finalidade existir.
3. **CPF obrigatório**: hoje é obrigatório (identificar a conta, ligar ao cadastro da loja, futuramente
   identificar no caixa). Se for mantido, a Política deve dizer isso com essas finalidades.

## 5. O que a Política promete e ainda não existe para o consumidor
- **Exportar os próprios dados e encerrar a conta** (direitos do item 14): previsto na Fase 5.
  Antes de abrir o cadastro ao público, ou essas funções ficam prontas, ou o pedido é atendido pelo
  e-mail de privacidade (item 1 do anexo).
- **Telas de autorização de mensagens por loja e canal**: a regra está pronta (histórico, versão do texto,
  revogação imediata, tudo começa desligado); as telas são da Fase 5.
- Identificação no caixa por CPF/QR, catálogo, compra online, pagamento e entrega: ainda não existem.
  A minuta já fala "quando habilitado", o que é compatível.

## 6. Cookies e armazenamento no navegador (item 11 da Política)
Verificado no código do site: **um único cookie**, essencial (`nexus_auth`, marca de sessão, 8 h), e o
crachá de acesso guardado no armazenamento local do navegador. **Não há** ferramentas de análise, publicidade
ou rastreamento. Hoje não é necessário painel de preferências de cookies; o texto pode dizer isso.

## 7. Como os termos entram no sistema
- Os dois textos ficam separados: **Termos de Uso** (Parte I) e **Política de Privacidade** (Parte II), sem as
  orientações internas nem o checklist. Arquivos: `TERMOS_USO.md` e `POLITICA_PRIVACIDADE.md`.
- O comando de publicação **recusa** texto com campos entre colchetes ou a palavra "MINUTA".
- Cada publicação vira uma versão nova; quem aceitou fica ligado à versão exata, e versão nova pede novo aceite.

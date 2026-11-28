# NEXUS CLUB

Clube de clientes do NEXUS OS: uma conta de consumidor vale para os clubes de várias lojas;
cada loja só enxerga o que é dela. Plano aprovado em 27/11/2026 (plano principal + adendo).

## O que existe (por fase)
| Fase | O que entrega | Onde |
|---|---|---|
| F-Foto | Foto do produto (envio, troca, remoção; bucket privado) | PR #56 (no ar) |
| 2 | Banco: conta do consumidor, clubes, termos, autorizações; RLS | PR #58 (no ar) |
| 3 | Cadastro, e-mail, login, senha do consumidor; crachá próprio; travas | PR #59, #61 (no ar, desligado) |
| 4 | Aba "★ Sou cliente NEXUS" no login; telas de conta | PR #62 |
| 5 | Área do cliente: clubes, compras, autorizações, baixar dados, excluir conta | PR #63 |
| 6 | Painel da loja: Clientes → ★ NEXUS CLUB (visão geral, membros, termos, configurações) | PR #64 |
| 7 | Promoções do clube + vitrine no app; regra única de preço | PR #65 (migração) |
| 10 | Teste de travas em todas as rotas do servidor | PR #66 |

## O que ainda falta (depende de decisão ou de terceiros)
- **Fase 8 — campanhas de WhatsApp:** pelo plano, só começa com a integração do WhatsApp
  **comprovadamente conectada** e com **modelo de marketing aprovado pela Meta**. Hoje isso não foi verificado.
- **Fase 9 — PDV:** identificar o cliente por CPF/QR no caixa, aplicar promoção de membro e benefício
  (calculados pelo servidor, com a regra única de `backend/src/modules/clube/preco-clube.ts`).
  **Muda o layout do PDV: precisa de aprovação com imagem antes.** Até lá, as promoções aparecem no
  app do cliente, mas **não mudam o preço no caixa**.
- **Termos finais:** a minuta está em `docs/nexus-club/termos/` (publicada só como provisória, para teste).
- **Decisões:** idade mínima; manter ou não a data de nascimento; texto sobre o CPF obrigatório.

## Como ligar (servidor)
Três variáveis no backend (Render). Sem elas, as rotas `/club` respondem 503 e a aba do login não aparece:
- `NEXUS_CLUB_HABILITADO=true`
- `NEXUS_CLUB_JWT_SECRET` (≥ 32 caracteres, **diferente** do `JWT_SECRET`)
- `NEXUS_CLUB_CPF_CHAVE` (≥ 32 caracteres; **nunca trocar** depois que houver contas)

Antes de abrir o cadastro ao público: publicar os termos finais
(`npm run club:publicar-termo -- TERMOS_USO arquivo.md --confirmar`, idem `POLITICA_PRIVACIDADE`);
quem aceitou a versão provisória precisa aceitar a nova (o servidor pede sozinho).

## Segurança (resumo)
- Conta do consumidor **global**: só o próprio consumidor (ou o sistema) a lê; a loja nunca.
- Tabelas por empresa com RLS; o consumidor só **lê** o que é dele; a empresa do clube só é aberta
  pelo servidor depois de conferir a carteirinha.
- Três travas entre crachás (tabela de usuários, tipo `CONSUMIDOR`, segredos diferentes), testadas
  em **todas** as rotas (`backend/tests/clube-travas.test.ts`).
- Histórico de autorizações e aceites não se altera nem se apaga (papel `nexus_app`).
- Senhas com bcrypt; CPF cifrado + HMAC; tokens de e-mail de uso único (só o hash no banco).
- Promoção nunca abaixo do custo; alçada de desconto com as mesmas faixas do PDV.

## Testes
`backend/tests/clube-*.test.ts` (dados, autenticação, área do cliente, painel da loja, promoções,
travas) e `prisma/seguranca/04_validacao_rls.sql` (T11); `frontend/tests/club-api.test.ts`.

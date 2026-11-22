# Central de Integrações — Fase A (estrutura, janela de configuração, Asaas)

Data: 22/11/2026 · Branch: `feat/central-integracoes` · Migração: `202611230000_central_integracoes` (somente aditiva, **não aplicada na produção**)

## 1. O que a Fase A entrega

| Item | Situação |
|---|---|
| Catálogo de provedores no backend (fonte única do que cada card oferece) | Feito |
| Estados reais por provedor (banco) e indicadores reais | Feito |
| Janela de configuração (abas Configuração · Sincronização · Histórico) | Feito |
| Credenciais cifradas por empresa (AES-256-GCM), máscara, "vazio = manter" | Feito |
| Testar sem gravar · Salvar com teste real · Desconectar · Remover | Feito |
| Histórico por integração (sem segredos) | Feito |
| Mercado Livre e Shopee na janela (reaproveitando os fluxos OAuth existentes) | Feito |
| Asaas: primeira integração por credencial | Feito (aguardando credencial real) |

### Arquivos
- Backend: `src/modules/integracoes/central/` (`provedores.ts`, `adaptadores.ts`, `central.service.ts`, `central.routes.ts`); eventos de histórico em `integracoes.routes.ts` (ML) e `shopee/shopee.routes.ts`.
- Banco: `IntegracaoExterno` + `credenciais` (JSON de segredos cifrado), `config` (JSON não sensível), `conectadoEm`; tabela nova `IntegracaoEvento`. RLS por `empresaId` aplicada pela política genérica.
- Frontend: `components/integracoes/ConfigIntegracaoModal.tsx`, `lib/integracoes-central.ts`, ajustes em `app/(dashboard)/central-integracoes/page.tsx` (layout preservado).

### Rotas (todas com autenticação, permissão do módulo `integracoes` e empresa da sessão)
| Rota | Permissão | Função |
|---|---|---|
| `GET /integracoes/central/painel` | visualizar | catálogo + estados + indicadores |
| `GET /integracoes/central/:provedor` | visualizar | estado e configuração (segredos mascarados) |
| `POST /integracoes/central/:provedor/testar` | editar | teste real, **não grava** credenciais |
| `PUT /integracoes/central/:provedor` | editar | valida, testa de verdade, cifra e salva |
| `POST /integracoes/central/:provedor/desconectar` | editar | apaga segredos, mantém config e histórico |
| `DELETE /integracoes/central/:provedor` | excluir | remove a configuração, mantém histórico |
| `GET /integracoes/central/:provedor/historico` | visualizar | últimos 50 eventos |

Obs.: `GET /integracoes/central` já pertencia ao módulo de Importação e não foi alterada.

### Estados
`CONECTADO` só após validação real. Falha de credencial → `ERRO`; falha transitória (timeout, indisponível, limite) → `CREDENCIAIS_SALVAS`; ainda: `NAO_CONFIGURADO`, `AGUARDANDO_AUTORIZACAO`, `EXPIRADO` (exibido "RECONECTAR"), `DESCONECTADO`, `INDISPONIVEL`.

**Saúde da central** = conectadas ÷ (conectadas + com erro/expiradas). Não configuradas e indisponíveis não entram. Sem nenhuma integração em uso, mostra "—".

## 2. Situação por integração

| Integração | Classificação | Autenticação | Pendência |
|---|---|---|---|
| Mercado Livre | PARCIALMENTE IMPLEMENTADA (já existia; agora na janela + histórico) | OAuth 2.0, app do NEXUS no servidor | Credenciais do app (`MERCADOLIVRE_*`) no Render para validar em produção |
| Shopee | PARCIALMENTE IMPLEMENTADA (já existia; agora na janela + histórico) | Open Platform v2 (HMAC) | Credenciais do app Shopee no servidor |
| Asaas | IMPLEMENTADA, AGUARDANDO CREDENCIAIS | Chave de API (`access_token`), produção/sandbox | Chave real; sincronização com Financeiro e webhooks (Fase C) |
| WooCommerce | NÃO IMPLEMENTADA (Fase B) | Consumer Key/Secret | — |
| Mercado Pago | NÃO IMPLEMENTADA (Fase B) | Access Token | — |
| Shopify | COM BLOQUEIO EXTERNO | OAuth do app | App do NEXUS no Shopify Partners |
| Nuvemshop | COM BLOQUEIO EXTERNO | OAuth do app | App no portal de parceiros |
| Melhor Envio | COM BLOQUEIO EXTERNO | OAuth 2.0 do app | App cadastrado no Melhor Envio |
| Correios | COM BLOQUEIO EXTERNO | Token do contrato | Contrato e acesso ao CWS |
| Jadlog | COM BLOQUEIO EXTERNO | Token do contrato | Contrato Jadlog |
| Open Banking | COM BLOQUEIO EXTERNO | Consentimento via agregador | Contrato com agregador (Pluggy/Belvo) |
| PIX (BR Code) | já existente em Configurações (inalterado) | — | PIX por API do banco depende do banco e de certificado |
| WhatsApp Business / E-mail | NÃO IMPLEMENTADA (Fase B) | — | — |

### Asaas — detalhes (documentação oficial consultada)
- Base: produção `https://api.asaas.com/v3`, sandbox `https://api-sandbox.asaas.com/v3`; cabeçalho `access_token`; `User-Agent` enviado.
- Prova de conexão: `GET /myAccount/commercialInfo/` (somente leitura; nome e CPF/CNPJ mascarado).
- Prefixo da chave conferido antes da chamada (`$aact_prod_` / `$aact_hmlg_`); `invalid_environment` tratado.
- Destino fixo por ambiente (sem URL informada pelo usuário → sem SSRF), timeout de 10 s, sem seguir redirecionamentos, sem registrar corpo ou cabeçalhos.
- **Evidência real**: o teste automatizado salvou uma chave fictícia no formato sandbox e o Asaas respondeu de verdade `401` → status `ERRO / CREDENCIAL_INVALIDA`. Nenhuma credencial real foi usada; conexão bem-sucedida **não** foi validada.

## 3. Segurança verificada
- Segredo cifrado no banco (o valor não aparece na coluna), nunca devolvido pela API, nem no HTML da página, nem no histórico.
- Formulário limpa os segredos após salvar; nada em `localStorage`.
- `empresaId` do corpo é ignorado (teste dedicado); outra empresa não vê configuração nem histórico.
- Sem permissão `editar`/`excluir`: 403 em testar, salvar, desconectar e remover; sem login: 401.
- Parâmetro de provedor validado por regex (`..%2Fadmin` → 400).

## 4. Defeitos encontrados e corrigidos
1. **Exclusões de todo o sistema quebradas (já existia)**: `api.delete` do frontend enviava `Content-Type: application/json` sem corpo e o Fastify recusava com 400. Afetava desconectar Mercado Livre, remover loja Shopee, arquivar produto, excluir meta, departamento, cargo e contatos/documentos de fornecedor. Comprovado contra a API real (sem corpo → 400; com `{}` → processado). Correção mínima em `lib/api.ts`: corpo `{}`.
2. Conflito de rota com a Importação (`GET /integracoes/central`): rota nova renomeada para `/painel`.
3. Limpeza do teste antigo do Mercado Livre passou a apagar os eventos de histórico.
4. Botão de engrenagem nos cards do ML/Shopee espremia o status: movido para o cabeçalho do card.
5. Card do Asaas dizia "OAuth": corrigido para "chave de API".

## 5. Testes
| Verificação | Resultado |
|---|---|
| Backend completo (papel `postgres`) | 467 passaram, 0 falharam |
| Backend completo (papel `nexus_app`, o da produção) | 477 passaram, 0 falharam |
| Testes novos da Central (backend) | 10/10 |
| Frontend (inclui 3 novos) | 84/84 |
| TypeScript backend e frontend · `next build` · imagem Docker | OK |
| Drift banco × schema | 0 |
| Revisão visual (desktop, notebook, celular) | sem rolagem horizontal, sem erro JS |

Fluxo no navegador: validação de obrigatórios, mostrar/ocultar segredo, teste real (erro de credencial exibido), salvar, recarregar (persistiu, segredo mascarado e campo vazio), histórico, remover (status volta a "NÃO CONFIGURADO").

## 6. Pendências
- Aplicar a migração na produção (somente com autorização).
- Fase B: WooCommerce, Mercado Pago, WhatsApp Business e E-mail (com proteção SSRF para URLs informadas pelo usuário).
- Fase C: integração com Financeiro/Vendas e webhooks (Asaas, Mercado Pago, WhatsApp).

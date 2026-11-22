# Integrações — Fase C1: Compras envia pela conta da empresa

Data: 22/11/2026 · Branch: `feat/integracoes-fase-c1` · **Sem migração**

## O que mudou
- Envio do pedido de compra (`POST /api/v1/compras/:id/envio`):
  1. **WhatsApp / E-mail da empresa** conectados na Central de Integrações (primeira opção);
  2. senão, as variáveis do servidor (Resend, `WHATSAPP_TOKEN`) — comportamento anterior mantido;
  3. senão, `NAO_CONFIGURADO` (nada simulado).
- WhatsApp da empresa: PDF enviado à Meta (`/media`) e mandado como documento; com **"Modelo para documentos (PDF)"** (campo avançado novo) usa o modelo aprovado com cabeçalho de documento (entrega fora da janela de 24 h); sem modelo, documento com legenda (só dentro da janela).
- E-mail da empresa: SMTP da própria conta, PDF anexado.
- O envio entra no histórico da Central (origem **COMPRAS**).
- Ficha da compra: selo mostra de onde sai o envio ("Conta da empresa", "WhatsApp da empresa", "… (servidor)" ou "Não configurado — conecte na Central") e nova coluna **Entrega** (Aceita pela Meta / Entregue / Lida / Não entregue), alimentada pelo webhook do WhatsApp.

## Testes
| Verificação | Resultado |
|---|---|
| Backend completo (`postgres`) | 490 passaram, 0 falharam |
| Backend completo (`nexus_app`) | 500 passaram, 0 falharam |
| Testes novos da C1 | 6/6 |
| Frontend | 85/85; tsc, next build e imagem Docker OK |
| Revisão visual da ficha (desktop e celular) | sem erros, sem rolagem horizontal |

Comprovado: sem canais → `NAO_CONFIGURADO` e status da compra inalterado; com WhatsApp da empresa conectado o envio sai pela conta da empresa (não cai para o servidor), a **Meta real recusou o token fictício (erro 190)** e a falha ficou na compra e na Central; status "Lida" do webhook aparece no envio; token nunca aparece em resposta; isolamento entre empresas.

**Não validado**: envio bem-sucedido (sem token real da Meta nem conta de e-mail real).

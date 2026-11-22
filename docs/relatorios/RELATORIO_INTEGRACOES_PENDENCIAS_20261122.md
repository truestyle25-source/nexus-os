# Integrações — pendências da análise

Data: 22/11/2026 · Branch: `feat/integracoes-pendencias` · Migração: `202611260000_integracoes_lgpd_agendamento` (somente aditiva, **não aplicada na produção**)

## O que foi resolvido
| Pendência | Solução |
|---|---|
| Importação automática do WooCommerce | Opção "Importar automaticamente a cada 15 minutos" na aba Sincronização (filial escolhida). Agendador com trava por *lease* no registro (uma instância por vez), falha registrada no histórico e nova tentativa com espera crescente (até 6 h). `INTEGRACOES_AGENDADOR=false` desliga. |
| E-mail: porta × segurança | Combinações erradas recusadas antes de conectar (465 = SSL/TLS; 587/25/2525 = STARTTLS; IMAP 993 = SSL/TLS, 143 = STARTTLS). |
| Status caía por falha passageira | Mesmas credenciais + timeout/indisponível/limite → continua CONECTADO, com aviso. Credencial recusada → ERRO. Credencial nova não herda o status. |
| Telefone de outro país | "+" ou "00" = já tem código do país (sem prefixar 55); sem código, assume Brasil. Central e Compras. |
| URL do webhook muda ao remover | Aviso na confirmação de remoção. |
| Cards Gemini / E-mail Transacional | Variável presente não é mais "Conectado": "Credenciais salvas" até um teste real; botão **Testar** faz leitura oficial (Google: lista de modelos; Resend: domínios — chave restrita a envio conta como válida). Resultado vale por 24 h. |
| LGPD — consentimento | Envio pela Central exige confirmação de que o contato autorizou, exceto se o cliente já escreveu para a empresa. A base fica gravada na mensagem (cliente iniciou / autorização declarada / fornecedor). |
| LGPD — descadastro | SAIR / PARAR / STOP descadastra; VOLTAR reativa; descadastro e reativação manuais. Ninguém da lista recebe mensagem (Central e Compras). |
| LGPD — retenção | Prazo configurável (90 d, 180 d, 1 ano padrão, 2 anos). Depois dele, conteúdo, nome e telefone (WhatsApp) e destinatários/assunto (e-mail) são apagados; ficam data e status. Idempotente. |
| WooCommerce — DNS rebinding | Conexão HTTPS fixada no IP validado (nome original no TLS/SNI e no Host), sem nova consulta DNS; vale para o teste e para a importação. |

Ajuste encontrado na rodada completa: o resumo antigo de `GET /integracoes` não contava o estado novo "Credenciais salvas"; corrigido no backend e no indicador da tela.

## Testes
| Verificação | Resultado |
|---|---|
| Testes novos das pendências | 8/8 |
| Testes de integrações (todos os arquivos) — `postgres` e `nexus_app` | 60/60 e 60/60 |
| Rodada completa anterior à correção do resumo | 516/517 e 526/527 (a única falha era o resumo, corrigido) |
| Frontend | 85/85; tsc, next build e imagem Docker OK |
| Revisão visual (desktop e celular) | sem erros, sem rolagem horizontal |

Evidências reais: Google e Resend recusaram chaves fictícias (credencial inválida); a Meta recusou o token fictício (erro 190) e a integração foi para "Reconectar"; envio para número descadastrado bloqueado na tela; conexão fixada funcionou contra `https://example.com` com certificado conferido; importação automática ligada/desligada persistiu após recarregar.

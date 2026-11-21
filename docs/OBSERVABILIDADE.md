# Observabilidade e monitoramento — NEXUS OS

Atualizado em 2026-11-21.

## 1. Logs (Pino, JSON no stdout, coletados pelo Render)
Configuração única em `backend/src/lib/logger.ts`, usada pelo Fastify e pelo código fora de requisições
(agendadores, integrações e e-mail).

| Campo | Significado |
|---|---|
| `reqId` | Id da requisição. Reaproveita o `X-Request-Id` recebido se tiver formato seguro; senão gera um UUID. Volta no cabeçalho `X-Request-Id` e no campo `referencia` das respostas 500 e 503 |
| `empresaId`, `usuarioId` | Em toda linha de requisição autenticada (só ids, nenhum dado pessoal) |
| `componente` | `agendador`, `agendador-ml`, `agendador-shopee`, `mercadolivre`, `email`, `rate-limit`, `tarefa-agendada` |
| `evento` | Eventos para busca e alerta (tabela abaixo) |
| `rota` | Rota do Fastify (sem os valores dos parâmetros) |

**Níveis:** `info` para requisições e recusas do cliente (validação, regra de negócio, 4xx); `warn` para
sobrecarga, erro de tela e integração com falha temporária; `error` **só** para o que vira 500 ou exige ação.
Antes, toda resposta 400 era registrada como `error`, o que escondia os erros reais.

**Redação de segredos:** os campos `senha`, `senhaAtual`, `novaSenha`, `senhaHash`, `password`, `token`,
`accessToken`, `refreshToken`, `apiKey`, `client_secret` e os cabeçalhos `Authorization` e `Cookie` são
trocados por `[REDACTED]`. Parâmetros sensíveis na URL (OAuth `code`/`state` etc.) são mascarados.
E-mails no log de envio são mascarados (`fu***@dominio.com`).

### Catálogo de `evento`
| evento | Nível | Quando |
|---|---|---|
| `erro_interno` | error | Exceção não tratada (resposta 500) |
| `capacidade_excedida` | warn | Sem conexão ou transação disponível a tempo (resposta 503 + `Retry-After`) |
| `banco_indisponivel` | error | `/health/ready` não conseguiu falar com o banco |
| `tarefa_concluida` / `tarefa_falhou` | info / error | Tarefas diárias (snapshot de estoque, fechamento de expediente) |
| `integracao_falhou` | warn/error | Mercado Livre, Shopee ou Resend |
| `erro_frontend` | warn | Erro de tela enviado pelo navegador |
| `email_nao_enviado` | warn | `RESEND_API_KEY` ausente |

Todos os `console.*` do código que roda em produção foram trocados por log estruturado. Os scripts de linha de
comando (backup, restauração, seed) continuam com saída de texto, de propósito.

## 2. Health checks
| Rota | Tipo | Resposta |
|---|---|---|
| `GET /health` | Liveness (processo vivo). Usado pelo health check do Render | `{status:'ok'}`; não depende do banco, para o Render não reiniciar a instância por um soluço do banco |
| `GET /health/ready` | Readiness | 200 `{status, banco:'ok', latenciaBancoMs, tarefasAtrasadas, uptimeS}` ou 503 `{status:'indisponivel', banco:'falha'}`. Nunca expõe host, versão ou mensagem do banco |

## 3. Monitoramento e alertas
| Alerta | Como dispara | Comprovação |
|---|---|---|
| API indisponível | `monitor.yml` (a cada 10 min) falha em `/health` após 4 tentativas | Disparo manual com `api` inválida (seção 4) |
| Banco indisponível | `monitor.yml`: `/health/ready` diferente de 200 | Lógica testada em `tests/pilares-infra.test.ts` |
| Tarefa diária falhou ou atrasou | `monitor.yml`: `tarefasAtrasadas` não vazia (sem sucesso há mais de 26 h) | `tarefasAtrasadas` testada |
| Frontend fora do ar | `monitor.yml`: `/login` diferente de 200 | Disparo manual |
| Backup falhou ou não está configurado | `backup.yml` vermelho | Hoje fica vermelho até os segredos existirem |
| Muitos 500, falha de integração ou de tela | Logs com `evento=` (seção 1) | **Pendente de ferramenta** que leia os logs e alerte (seção 5) |

**Canal:** e-mail do GitHub para o dono do repositório quando um workflow agendado falha. É preciso deixar
ligado em GitHub → Settings → Notifications → Actions → "Send notifications for failed workflows only".

## 4. Como provar o alerta
GitHub → Actions → **Monitor de produção** → Run workflow → em `api`, informe `https://exemplo.invalid`. A execução fica
vermelha e o e-mail chega. Confira na caixa de entrada; só você pode confirmar o recebimento.

## 5. Monitoramento de erros (agrupamento e frequência): opções
| Ferramenta | Plano gratuito (aprox.)* | Encaixe |
|---|---|---|
| **Sentry** (recomendado) | ~5 mil erros/mês | SDK oficial para Fastify e Next; agrupa por pilha, mostra a frequência e o endpoint; liga ao `reqId` |
| Better Stack (Logs + Uptime) | Monitores de uptime e volume de log limitado | Recebe os logs do Render por "Log Stream" e alerta por consulta (`evento="erro_interno"`) |
| Axiom | Volume mensal de log generoso | Log Stream do Render e consultas e alertas sobre os campos JSON |

\*Confira os limites atuais. **Não foi integrado** porque exige criar a conta e gerar uma DSN ou token, o que é
decisão sua. Com a DSN em mãos, a integração é pequena: o logger e os `error.tsx` já centralizam os pontos de captura.

## 6. Frontend
- `app/error.tsx` (fora do painel), `app/(dashboard)/error.tsx` (dentro do painel, mantém sidebar e topbar) e
  `app/global-error.tsx` (erro no layout raiz). Mostram mensagem e botão "Tentar de novo", e registram o erro em
  `POST /telemetria/erro-frontend`: só mensagem, digest, página e pilha, nunca o token. A rota tem limite de
  30 por minuto por IP e corpo de no máximo 16 KB.
- **Achado pré-existente, não corrigido:** erros de hidratação do React (#418/#423/#425) em `/dre`, `/estoque`,
  `/fiscal`, `/fluxo`, `/fornecedores` e `/rh`. As páginas formatam datas durante a renderização, com o servidor
  em UTC e o navegador em Brasília. Não quebram a tela, porque o React refaz no cliente. A correção é página a
  página: formatar a data só depois de montar o componente.

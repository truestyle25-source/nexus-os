# Relatório — Evolução dos 5 pilares de infraestrutura (2026-11-21)

Branch `feat/pilares-infra`. **Sem merge, sem deploy e sem alteração na produção.** Na produção, só leituras
(dump de backup, contagens, varredura). Nenhum segredo neste documento.

## 1. Resumo executivo
| Pilar | Situação inicial (auditoria de 21/11) | Situação final |
|---|---|---|
| Autenticação e segurança | Forte (RLS, 401 em 100% das rotas privadas), com lacunas | Lacunas fechadas. **3 falhas reais corrigidas**: sessões não encerradas na troca de senha, API pública sem limite e restauração capaz de apagar a produção |
| CI/CD | CI bom; `main` sem proteção; deploy sem esperar o CI; Node 20 | CI com drift, Docker, auditorias bloqueantes e Node 22; Dependabot; proteção da `main` **pronta para aplicar** |
| Observabilidade | Logs Pino básicos; sem alertas; `/health` sem banco | Logs estruturados com `reqId`/empresa/evento; `/health/ready`; telas de erro com registro; monitor externo com alerta por e-mail |
| Backup e recuperação | Só manual, só local, sem cifragem | Backup diário **verificado por restauração** e cifrado, **testado contra a produção**. Falta só você cadastrar os segredos |
| Escalabilidade | Sem teste acima de 5 empresas | Carga de 10 a 100 empresas medida; **bug de vendas sob carga corrigido (24% → 0% de erro com 10 empresas)**; rate limit e tarefas prontos para várias instâncias |

## 2. Autenticação e segurança
**Já existia:** JWT de 8 h com revogação por `jti`; bloqueio de usuário inativo e empresa suspensa; RLS em
todas as tabelas; permissões por módulo e ação; limite de login no banco.

**Corrigido:**
1. **Troca ou redefinição de senha encerrava só a sessão atual**: as outras sessões, inclusive a de quem usou
   uma senha vazada, valiam por até 8 h. Agora `Usuario.sessoesValidasDesde` recusa todo token anterior à troca,
   com precisão de ms (claim `emitidoEmMs`). Testado, inclusive o caso do mesmo segundo.
2. **API pública sem rate limit** (o README afirmava que havia): agora 120/min **por chave de API**.
3. **Rate limit em memória por processo**, que zerava no reinício e não era compartilhado: agora no banco
   (`RateLimitJanela`), atômico e compartilhado. A IA passou a limitar **por usuário**, não por IP.
4. **IP forjado:** comprovado que `X-Forwarded-For` forjado vira o `req.ip` com `trustProxy: true`. Ficou
   configurável por `TRUST_PROXY_HOPS` ou `CLIENT_IP_HEADER` (testado). **A ativação depende de verificar a cadeia
   real de proxies do Render** (pendência).
5. Troca da URL da API pelo `localStorage` (que poderia desviar o token) desligada na produção.

**Implementado:** cabeçalhos de segurança na API (CSP para JSON, X-Frame-Options, nosniff, Referrer-Policy,
Permissions-Policy, HSTS, COOP) e no frontend (CSP completa com `connect-src` restrito, X-Frame-Options,
nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removido).

**Testes:** 12 casos novos em `tests/pilares-infra.test.ts`; suíte completa com RLS ativo; **varredura de
31 telas no navegador real com 0 violações de CSP**.

**Pendências:** cookie HttpOnly, bloqueado pela arquitetura (frontend e API em sites diferentes; precisa de
domínio próprio); isolamento por filial (decisões de negócio); nonce de CSP, para depois da migração do Next.

## 3. CI/CD
- **Workflows:** `ci.yml` com 4 jobs (backend, frontend, Docker, gitleaks); `backup.yml`; `monitor.yml`; `dependabot.yml`.
  Entraram: Node 22, checagem de drift (schema = migrações), build e partida da imagem Docker e auditoria
  **bloqueante** (antes era só aviso).
- **Proteção da `main`:** preparada em `docs/protecao-main.json` (PR obrigatório, 4 checks, sem force-push,
  vale para o administrador). **Não aplicada**: alterar configuração do repositório exige sua autorização.
- **Deploy:** a Vercel publica sem esperar o CI (comprovado: 09:11 com o CI rodando). O deploy automático do
  Render não pôde ser verificado. Configuração recomendada em `docs/CI_CD_E_DEPLOY.md`.
- **Staging:** proposta sem custo (Supabase Free + Render Free + Preview da Vercel). Criar é decisão sua.
- **Dependências:** Next 14 (crítica) com plano de migração; Node 22 aplicado; Dependabot configurado.

## 4. Observabilidade
- **Logs:** configuração única com redação de segredos; `reqId` em toda linha e no cabeçalho;
  `empresaId`/`usuarioId` nas requisições autenticadas; catálogo de `evento`; níveis corrigidos (antes, todo 400
  era `error`); todos os `console.*` de runtime convertidos; e-mails mascarados no log.
- **Health:** `/health` (vivo) e `/health/ready` (banco, latência e tarefas atrasadas, sem expor detalhes).
  Comprovado: sem banco, `/health` responde 200 e `/health/ready` responde 503.
- **Erros de tela:** `error.tsx`, `(dashboard)/error.tsx` e `global-error.tsx`, que registram em `/telemetria/erro-frontend`.
- **Alertas:** `monitor.yml` a cada 10 min (API, banco, tarefas e frontend) e `backup.yml`, com e-mail do GitHub na falha.
  **Só podem ser disparados depois do merge** (o GitHub só agenda e executa manualmente workflows da branch principal).
- **Pendente:** ferramenta de agrupamento de erros (Sentry recomendado), que exige criar conta e DSN.
- **Achado pré-existente:** erros de hidratação do React em 6 telas (datas formatadas na renderização).

## 5. Backup e recuperação
- **Rotina:** diária no GitHub Actions: dump → integridade → **restauração de teste com contagem tabela a tabela** →
  SHA-256 → AES-256 → envio. **Testada contra a produção**: 86 tabelas, 163 FKs, 52 migrações, 0 divergências,
  138 s; decifragem conferida e senha errada recusada.
- **Armazenamento:** S3-compatível (R2 recomendado) ou, temporariamente, artefato cifrado de 30 dias.
- **Retenção:** 30 dias. **Criptografia:** AES-256 em repouso; TLS na transferência.
- **Restauração:** script reescrito, com destino obrigatório, bloqueio de produção e do Supabase, validação antes,
  destino vazio e conferência depois. **Corrigido um risco real**: o script antigo restaurava com `--clean` na `DATABASE_URL`.
- **RPO de 24 h e RTO de 2 a 4 h**; plano por cenário e teste mensal em `docs/BACKUP_E_RECUPERACAO.md`.
- **Pendências:** cadastrar os segredos `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE`, escolher o armazenamento e
  **verificar no painel do Supabase o plano e os backups nativos**.

## 6. Escalabilidade
- **Banco e conexões:** pool de 10 por instância; `nexus_app` com limite de 20 (até 2 instâncias); `max_connections` de 60.
- **Bug corrigido:** transações desistiam de esperar conexão em 2 s e **perdiam vendas com 500**. Agora
  esperam até 10 s e duram até 15 s; sobrecarga vira **503 + Retry-After**, que o PDV offline reenvia sem duplicar.
- **Carga** (isolada; 1 vCPU, 512 MB, RLS ativo):

  | Empresas | Requisições | Erros | Observação |
  |---|---|---|---|
  | 10 | 310 | **0%** | antes da correção: 24% das vendas com 500 |
  | 25 | 775 | 2,5% | só nas 250 vendas simultâneas |
  | 50 | 1.550 | 11,6% | só nas vendas simultâneas (503) |
  | 100 | 3.100 | 22,4% | só nas vendas simultâneas (503) |

  Todos os demais cenários tiveram 0 erros em todos os níveis. **O gargalo é a CPU** (100%); a memória ficou em no máximo 153 MB.
- **Paginação:** as listagens de tela já são limitadas. Os riscos reais (somas sobre o histórico inteiro, feitas
  em memória) foram corrigidos nos 2 casos de maior impacto, com agregação no banco; restam 2 pendentes.
- **Agendadores:** trava distribuída (10 instâncias disputando, 1 executa) e retomada de execução perdida.
  A Shopee ainda não tem a trava.
- **Infra:** recomendação por fase em `docs/ESCALABILIDADE_E_CARGA.md` (Render Starter na Virgínia + Supabase Pro ≈ US$ 32/mês para ~10 empresas).
- **Docker e Node:** Node 22 LTS; `.dockerignore` novo, que impede segredos, backups e `node_modules` na imagem.

## 7. Segurança de credenciais
| Credencial | Situação | Ação |
|---|---|---|
| Senha do usuário de produção (pública no GitHub desde 09/11) | Trocada em 20/11; confirmado que a antiga não abre a conta | Encerrado |
| **Senha atual do `postgres`** | Num checkpoint **local** do Cline (nunca enviado ao GitHub) e em históricos de IA | **Trocar** (pendência) |
| Credencial do `.env.test` | Em 2 commits públicos; não confere com a produção | Trocar se a conta existir |
| Demais segredos de produção | Nenhum no histórico | — |

## 8. Testes
| Execução | Total | Aprovados | Falhas | Pulados |
|---|---|---|---|---|
| Backend, papel `postgres` (final) | 403 | 390 + 2 na repetição | 0 | 11 |
| Backend, papel `nexus_app` + RLS (final) | 412 | 400 + 2 na repetição | 0 | 10 |
| Backend, `nexus_app` + RLS (rodada intermediária) | 411 | 401 | 0 | 10 |
| Novos (`pilares-infra.test.ts`) | 12 | 12 | 0 | 0 |
| Frontend | 64 | 64 | 0 | 0 |
| Validação RLS (SQL) | 10 | 10 | 0 | — |
| Varredura de 31 telas (navegador) | 31 | 31 carregam | 0 violações de CSP | — |

Builds: `prisma validate`/`generate`, `tsc` do backend e do frontend, `npm run build`, `next build`, `docker build`
(Node 22) e a imagem subindo com e sem banco: **todos OK**.

Falhas encontradas durante o trabalho, todas corrigidas:
1. `configuracoes.test.ts` usava um token emitido antes da troca de senha (comportamento novo e correto).
2. A janela do mesmo segundo no `iat` foi fechada com `emitidoEmMs`.
3. O medidor de carga travava o próprio processo; corrigido antes de valer qualquer número.
4. As vendas com 500 sob carga (seção 6).

## 9. Alterações no GitHub
Branch `feat/pilares-infra`. O resumo do PR e a situação do CI estão no PR desta entrega.

- **Criados:**
  - Workflows: `backup.yml`, `monitor.yml`, `dependabot.yml`.
  - Backend: `.dockerignore`, `scripts/backup-producao.sh`, migração `202611211000_pilares_infra`, `lib/logger.ts`,
    `lib/client-ip.ts`, `lib/tarefa-agendada.ts`, `tests/pilares-infra.test.ts`.
  - Frontend: `error.tsx` (2), `global-error.tsx`, `components/TelaDeErro.tsx`, `lib/relatar-erro.ts`,
    `scripts/verificar-auditoria.cjs`.
  - Documentação: 6 documentos em `docs/`, `docs/protecao-main.json` e este relatório.
- **Modificados:**
  - Workflow `ci.yml`.
  - Backend: `Dockerfile`, `package*.json` (só o `pino` declarado), `schema.prisma`, `01_rls_policies.sql`,
    `server.ts`, `prisma.ts`, `auth.ts`, `rateLimiter.ts`, `apiKeyAuth.ts`, `auth.routes.ts`, `email.ts`,
    `scheduler.ts`, `backup.ts`, `restaurar-backup.ts`, `dashboard.routes.ts`, `vendas.routes.ts`,
    `agendador-ml.ts`, `mercadolivre.service.ts`, `shopee-scheduler.ts`, `fastify.d.ts`, `configuracoes.test.ts`, `.env.example`.
  - Frontend: `next.config.js`, `lib/api.ts`.
  - `README-PRODUCAO.md`.
- **Removidos:** nenhum.

## 10. Pendências externas
| # | Pendência | Depende de |
|---|---|---|
| 1 | **Antes do merge:** aplicar a migração `202611211000_pilares_infra` + `01_rls_policies.sql` na produção (aditiva, com backup antes). Sem isso, o código novo quebra o login | Sua autorização |
| 2 | Cadastrar `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE` (comandos em `BACKUP_E_RECUPERACAO.md`) | Você (credenciais) |
| 3 | Escolher e criar o armazenamento externo (R2 recomendado) | Você (conta) |
| 4 | Aplicar a proteção da `main` (`docs/protecao-main.json`) | Sua autorização |
| 5 | Render: Auto-Deploy "After CI Checks Pass" e confirmar o estado atual | Painel do Render |
| 6 | Verificar o plano e os backups do Supabase | Painel do Supabase |
| 7 | Trocar a senha do `postgres` | Você |
| 8 | Medir a cadeia de proxies do Render e então definir `TRUST_PROXY_HOPS` | Deploy + logs |
| 9 | Ligar as notificações de workflow com falha e testar o alerta (Run workflow com URL inválida) | Você (após o merge) |
| 10 | Sentry (ou similar): criar conta e DSN | Decisão |
| 11 | Plano pago e região do Render; Supabase Pro | Decisão financeira |
| 12 | Staging na nuvem | Decisão |

## 11. Classificação final
| Pilar | Classificação |
|---|---|
| Autenticação e segurança | **IMPLEMENTADO E VALIDADO** (cookie HttpOnly e ativação do `TRUST_PROXY_HOPS` dependem de fatores externos) |
| CI/CD | **IMPLEMENTADO PARCIALMENTE**: CI validado; proteção da `main` e bloqueio do deploy pelo CI dependem de autorização e dos painéis |
| Observabilidade | **IMPLEMENTADO PARCIALMENTE**: logs e health validados; alertas só disparáveis depois do merge; agrupamento de erros depende de conta |
| Backup e recuperação | **BLOQUEADO POR DEPENDÊNCIA EXTERNA**: rotina implementada e testada contra a produção; só começa a rodar com os segredos |
| Escalabilidade | **IMPLEMENTADO PARCIALMENTE**: correções validadas por carga; capacidade para 50 a 100 empresas depende de infraestrutura paga |

## 12. Recomendação final
| Ambiente ou etapa | Pronto? | Base |
|---|---|---|
| Desenvolvimento | **Sim** | Comprovado (testes, Docker, banco local) |
| Staging | **Não existe na nuvem** | Proposta sem custo; depende de você criar |
| Produção | **Sim, com as pendências 1, 2 e 7** | Comprovado: segurança, testes e backup verificado |
| Primeiro cliente piloto | **Sim**, idealmente com Render Starter | Comprovado: 10 empresas sem erro com 1 vCPU. **Projeção:** o Render Free (~0,1 vCPU) fica cerca de 10 vezes mais lento |
| 10 empresas | **Sim**, com Render Starter (de preferência na Virgínia) e o backup ativo | Carga comprovada em ambiente isolado |
| 50 empresas | **Ainda não** | Erros de capacidade em rajadas de vendas (503). Exige 1 a 2 vCPU e um novo teste |
| 100 empresas | **Não** | Exige várias instâncias, Supavisor em modo transação, agendadores separados e um novo teste (projeção) |

## 13. Resultado final dos testes (depois de todas as alterações)
- **Backend como `postgres`:** 403 testes, 390 aprovados e 2 falhas (`ponto`, `produtos`) com `Can't reach database server at localhost:5432`, uma queda momentânea do Postgres em Docker local. Repetidos isoladamente: **4/4 aprovados**.
- **Backend como `nexus_app` + RLS:** 412 testes, 400 aprovados e 2 falhas (`financeiro`, `metas`), na mesma janela da queda do banco. Repetidos isoladamente: **4/4 aprovados**.
- Nenhuma falha atribuível ao código desta entrega. **A prova definitiva é o CI do PR** (Postgres isolado, os dois papéis).

# NEXUS AI — Plano de Implementação sobre a estrutura atual do NEXUS OS

Data: 24/11/2026 (revisado com 5 requisitos reforçados: seção 5A) · Status: **proposta para aprovação** (nada implementado ainda)

Este plano transforma a visão "NEXUS AI — Enterprise Intelligence System" em etapas executáveis **em cima do que o NEXUS OS já tem**: Fastify 5, Prisma 5.22, PostgreSQL (Supabase) com RLS por `empresaId`, permissões por módulo/ação, auditoria, agendadores com *lease* e a Central de Integrações. Nada de segundo ERP, banco paralelo ou aplicações separadas.

---

## 1. Ponto de partida — o que já existe (auditado)

| Peça existente | Onde | Situação | Uso no NEXUS AI |
|---|---|---|---|
| Chamada ao modelo | `backend/src/modules/ia/ia.service.ts` (`consultarIA`) | Gemini via REST, chave no servidor, timeout 15 s, saída JSON opcional, modelo por `GEMINI_MODEL` | Vira o **primeiro provedor** do Model Router |
| Pergunta livre | `POST /ia/perguntar`, `POST /chat` | Responde com contexto montado na rota, grava `ConversaIA` | Substituída gradualmente pela Central NEXUS AI |
| Painel de inteligência | `GET /ia/intelligence-center` | Lê vendas, estoque, financeiro e metas direto com Prisma | Vira ferramentas tipadas reutilizáveis |
| Alertas e notificações | `Alerta`, `Notificacao`, `/alertas`, `/notificacoes` | Funcionando, por empresa | Destino dos **insights** e eventos da IA |
| Regras de automação | `RegraAutomacao`, `/automacao/regras`, `/automacao/executar` | Regras com condição/ação em texto, execução manual | Base do **NEXUS AUTOMATION** (com aprovação) |
| Usos específicos de IA | `iaRelatorios.service.ts`, `iaFornecedores.service.ts`, RH (`lideranca`, `treinamentos`, `plano-desenvolvimento`) | Cada um chama `consultarIA` com seu próprio prompt | Migram para agentes registrados |
| Isolamento | RLS genérico por `empresaId` + `comoSistema`/`definirSistemaDaRequisicao` | Em produção | Toda ferramenta da IA roda **no contexto da empresa da sessão** |
| Permissões | `permissoes-catalogo.ts` (módulos × `visualizar/criar/editar/excluir/cancelar/administrar`) | Em produção | Cada ferramenta declara a permissão exigida |
| Auditoria | `Auditoria`, `registrarAuditoria` | Em produção | Toda execução de ferramenta com efeito é auditada |
| Agendamento seguro | `TarefaAgendada` (lease), agendadores ML/Shopee/Integrações | Em produção | Fila e eventos da IA usam o mesmo padrão |
| Limite de uso | `createRateLimiter` (janela no Postgres) | Em produção | Limite de chamadas/custo por empresa |
| Histórico de integrações | `IntegracaoEvento` | Em produção | Fonte para o Agente de Segurança e Integrações |

**Lacunas reais hoje:** um único provedor e um único prompt genérico (o papel atual inclui instruções sobre voz que não cabem num assistente analítico); a IA lê dados com consultas montadas em cada rota (sem contrato reutilizável); não há registro de execuções, custo, ferramentas usadas, memória, documentos (RAG) nem aprovações; `RegraAutomacao` é texto livre sem fila nem aprovação.

---

## 2. Decisões de arquitetura (o que muda e o que não muda)

1. **O PostgreSQL continua sendo a única fonte da verdade.** A IA nunca recebe SQL, conexão ou acesso direto: só **ferramentas tipadas** do backend.
2. **Ferramenta = função do backend** com entrada validada por Zod, permissão declarada (módulo + ação), execução no contexto da empresa (RLS) e saída estruturada. É o mesmo padrão das rotas atuais.
3. **Cálculo é do código; interpretação é do modelo.** Margem, giro, previsão e anomalia são calculados em TypeScript/SQL verificáveis. O modelo explica, cruza e recomenda — nunca "inventa" um número.
4. **Toda resposta cita a fonte**: ferramentas usadas, período, filtros e o que não foi possível confirmar (campo obrigatório no formato de resposta).
5. **Provedor intercambiável.** O Model Router começa com o Gemini (já configurado) e aceita outros provedores sem mudar agentes. As chaves ficam no servidor (Render), nunca no frontend nem como ferramenta.
6. **Nada de oito modelos rodando o tempo todo.** Agente é configuração (papel + ferramentas + limites), acionada sob demanda pelo orquestrador ou por evento.
7. **Autonomia em níveis (0–3)**, com aprovação humana obrigatória para preço, compra, financeiro, cancelamento, permissão, exclusão e fiscal — mesmo com autorização geral.

---

## 3. Módulo novo: `backend/src/modules/nexus-ai/`

```
nexus-ai/
  gateway.routes.ts        # A. AI Gateway — rotas /api/v1/nexus-ai/* (auth, empresa, filial, permissões, limites)
  provedores/              # B. Model Router — interface Provedor + gemini.ts (reaproveita consultarIA) + roteamento por tarefa
  orquestrador.ts          # C. Orchestrator — plano de etapas, chamada de agentes, limite de passos e de custo
  agentes/registro.ts      # D. Agent Registry — agentes versionados (papel, ferramentas, nível de autonomia)
  ferramentas/             # E. Tool Registry — ferramentas tipadas por domínio (estoque, vendas, financeiro, ...)
  memoria.service.ts       # F. Memória empresarial e base documental (RAG)
  aprovacoes.service.ts    # G. Execution and Approval Engine
  eventos/                 #    Outbox de eventos + worker (padrão lease já usado no projeto)
  observabilidade.ts       # H. Registro de execuções, tokens, custo, latência e erros
  avaliacao/               #    Bateria de perguntas reais com respostas esperadas (regressão dos agentes)
```

### Persistência (domínio próprio no Prisma; migrações só aditivas)

| Entidade | Finalidade | Observações |
|---|---|---|
| `AIConversa` / `AIMensagem` | Conversas da Central NEXUS AI | Migra `ConversaIA` sem apagar o histórico |
| `AIExecucao` | Cada investigação (pergunta ou evento) | Agente(s), quem pediu, empresa/filial, status, duração, custo |
| `AIExecucaoFerramenta` | Cada ferramenta chamada | Nome, versão, entrada resumida, resultado resumido, permissão verificada |
| `AIAprovacao` | Ação preparada aguardando decisão | Proposta, evidências, impacto, quem aprovou/rejeitou, resultado |
| `AIInsight` | Descoberta/alerta da IA | Liga-se a `Alerta` existente; evidências e período |
| `AIMemoria` | Memória empresarial autorizada | Metas, políticas, critérios; editável/excluível; por empresa |
| `AIDocumento` / `AITrecho` | Base documental (RAG) | Trechos com embedding (pgvector no Supabase), filtrados por empresa e permissão |
| `AIConsumo` | Tokens e custo por empresa/dia | Base do limite de custo |
| `AIEvento` | Outbox de eventos de negócio | Venda, estoque abaixo do mínimo, despesa atípica… processados por worker |

Todas com `empresaId` → RLS genérico aplica automaticamente.

---

## 4. Agentes (configuração, não aplicações)

| # | Agente | Ferramentas iniciais (somente leitura) | Fonte no NEXUS |
|---|---|---|---|
| 01 | **Estoque e Produtos** | saldo por filial, movimentações, giro, ruptura, parados, ficha técnica/kit | `Estoque`, `EstoqueMovimentacao`, `EstoqueSnapshotDiario`, `ComposicaoKit` |
| 02 | **Comercial** | vendas por período/vendedor/canal, ticket médio, curva ABC, clientes | `Venda`, `VendaItem`, `VendaPagamento`, `Cliente` |
| 03 | **Financeiro** | fluxo de caixa, DRE, margem, despesas atípicas, contas vencidas | `Financeiro`, `DRE`, `Caixa`, `/fluxo-caixa` |
| 04 | **Compras** | histórico de custo, comparação de fornecedores, sugestão de reposição | `Compra`, `CompraItem`, `FornecedorPrecoHistorico`, `CompraRecebimento` |
| 05 | **Executivo** | consolida os demais + `Meta`, `IndicadorDiario` | agregação dos outros agentes |
| 06 | **RH** | metas de equipe, jornada/ponto, inconsistências | módulos RH/Ponto |
| 07 | **Marketing** | campanhas/canais (quando houver dados), segmentação de clientes | Vendas + Clientes + integrações |
| 08 | **Segurança** | acessos, auditoria, anomalias de operação, integrações | `Auditoria`, `IntegracaoEvento`, `LoginAttempt` |

Cada agente declara: papel, ferramentas permitidas, **permissões mínimas do usuário** (ex.: o Agente Financeiro só responde para quem tem `financeiro.visualizar`), nível máximo de autonomia, versão e limites (passos, tempo, custo).

---

## 5. Segurança e governança (requisitos, não opcionais)

- **Permissão por ferramenta e por usuário**: a IA nunca vê mais do que o usuário que pediu poderia ver.
- **Empresa e filial da sessão**: nunca do texto da pergunta nem do modelo.
- **Injeção de comandos** (riscos OWASP para LLM): dados vindos do banco, documentos e integrações são tratados como **dados**, nunca como instruções; ferramentas com efeito só passam pelo motor de aprovação.
- **Vazamento**: respostas não expõem segredos, tokens, dados de outras empresas nem campos sensíveis (respeitando permissões de custo, salário, etc.).
- **Consumo**: limite de passos por investigação, de chamadas por minuto e de custo diário por empresa (`AIConsumo` + `createRateLimiter`).
- **Auditoria completa**: agente, solicitante, empresa/filial, ferramentas, dados consultados (resumo), resultado, aprovador e resultado da execução.
- **LGPD**: memória e conversas por empresa, com exclusão e retenção configuráveis (mesmo padrão já usado no WhatsApp).

---

## 5A. Requisitos reforçados (revisão de 24/11/2026)

### 1. Monitoramento de segurança em tempo real
Não depender só de perguntas. Eventos de risco entram numa **fila de investigação automática** (outbox `AIEvento` + worker com *lease*, mesmo padrão dos agendadores atuais):

| Evento detectado (por regra em código, não pelo modelo) | Origem no NEXUS | Encaminhamento |
|---|---|---|
| Logins falhos em sequência / de IP novo | `LoginAttempt`, rate limiter | Agente de Segurança → `Alerta` CRÍTICO |
| Alteração de permissões ou de usuário administrador | `Auditoria` | Investigação + notificação ao responsável |
| Cancelamentos, estornos ou descontos fora do padrão | `Venda`, `MovimentacaoCaixa`, `DivergenciaCaixa` | Investigação de caixa |
| Ajuste de estoque grande ou fora do horário | `EstoqueMovimentacao` | Investigação de estoque |
| Exportação/consulta em massa de dados sensíveis | `Auditoria`, rotas de relatório | Alerta + registro |
| Falhas repetidas de integração ou webhook com assinatura inválida | `IntegracaoEvento`, rotas de webhook | Alerta de integração |
| Tentativa de manipulação da IA (item 2) | Gateway NEXUS AI | Bloqueio + alerta |

A **detecção é determinística** (regras e limiares no código, sempre ativas mesmo sem IA); a IA só investiga e explica depois. Cada evento é processado uma única vez (chave de idempotência por evento).

### 2. Proteção contra manipulação da própria IA (prompt injection)
- **Separação rígida entre instrução e dado:** tudo que vem de cadastros, documentos, mensagens de WhatsApp/e-mail, pedidos de marketplace e respostas de integrações entra no contexto **marcado como dado não confiável**, nunca como instrução; o papel do agente diz explicitamente que esse conteúdo não pode mudar regras.
- **Ferramentas, não texto, decidem o que acontece:** o modelo só consegue agir chamando ferramentas registradas; ferramentas com efeito **nunca executam direto** — viram proposta no motor de aprovação (nível 2) ou exigem política explícita (nível 3).
- **Permissão herdada do usuário em cada chamada:** mesmo que um texto malicioso "convença" o modelo, a ferramenta recusa no servidor o que o usuário não pode fazer; a empresa vem sempre da sessão.
- **Saídas filtradas:** a resposta passa por verificação de vazamento (segredos, tokens, campos sem permissão, dados de outra empresa) antes de chegar à tela.
- **Detecção e registro:** padrões conhecidos de injeção ("ignore as instruções", pedidos de chaves, troca de papel) em dados ou perguntas geram registro no histórico e alerta de segurança; o conteúdo suspeito é neutralizado, não executado.
- **Testes adversariais** fazem parte da bateria de avaliação (cadastro de produto com instrução embutida, documento malicioso, mensagem de cliente tentando extrair dados).

### 3. Recuperação automática e continuidade
- **O ERP não depende da IA:** nenhuma rota de vendas, PDV, estoque, compras ou financeiro chama o modelo no caminho crítico. Se o Gemini cair, só a NEXUS AI fica indisponível (com mensagem clara), o resto funciona.
- **Investigações retomáveis:** cada investigação (`AIExecucao`) guarda as etapas concluídas e o resultado de cada ferramenta; ao reiniciar ou se o provedor voltar, retoma da última etapa, sem refazer o que já foi feito.
- **Sem duplicar operações:** toda ação proposta tem **chave de idempotência**; aprovar duas vezes ou repetir após falha não executa duas vezes (mesmo mecanismo `IdempotencyKey` já usado no PDV e nas integrações).
- **Falha do provedor:** tentativas com espera crescente e limite; circuito aberto após falhas seguidas (para de chamar por um tempo); provedor secundário opcional quando configurado.
- **Eventos não se perdem:** gravados na outbox na mesma transação do fato de negócio; o worker processa quando a IA voltar.

### 4. Avaliação da qualidade das respostas
- **Números conferidos por cálculo, não por texto:** cada indicador citado na resposta precisa vir de uma ferramenta; um **verificador** compara os números da resposta com os resultados das ferramentas e **reprova** a resposta se houver divergência (ex.: margem escrita ≠ margem calculada), mesmo que o texto esteja bem escrito.
- **Bateria de avaliação por agente** (`nexus-ai/avaliacao/`): empresas de teste com dados conhecidos e perguntas com respostas esperadas (valores, produtos, períodos). Critérios: número exato, fonte citada, período correto, sem dado de outra empresa, recusa quando não há permissão.
- **Bloqueio de regressão:** toda mudança de agente, ferramenta, prompt ou modelo roda a bateria no CI; abaixo do limite mínimo, não entra.
- **Respostas honestas:** quando a ferramenta não retorna dado suficiente, a resposta diz o que não pôde ser confirmado em vez de completar com suposição.
- **Retorno do usuário:** botão "correta / incorreta" em cada resposta, registrado para revisão.

### 5. Controle financeiro da inteligência
- **Livro de consumo** (`AIConsumo`): tokens de entrada/saída, custo estimado, agente e usuário por chamada, consolidado por empresa/dia/mês.
- **Limites por empresa (e por plano de assinatura):** número de investigações, tokens e custo mensal; aviso em 80%, bloqueio suave em 100% (a IA para, o ERP não), liberação pelo administrador.
- **Roteamento por custo:** perguntas simples usam modelo mais barato; só investigações complexas usam o modelo maior; respostas idênticas recentes reaproveitam o resultado (cache com validade curta).
- **Limite por investigação:** máximo de passos, ferramentas e tempo; acima disso, encerra e explica.
- **Painel de consumo** para o administrador da empresa e relatório consolidado para o dono da plataforma (base para cobrança quando houver clientes pagantes, integrado ao módulo `Assinatura`).

---

## 6. Experiência (sem mudar a identidade visual)

Nova página **NEXUS AI** no menu (reaproveitando `/ia` e `/intelligence`), com seis áreas: **Conversar**, **Visão Executiva**, **Inteligência** (insights), **Automações**, **Aprovações**, **Histórico**. Toda conclusão mostra fontes, período, critérios e limitações; nenhum número de exemplo aparece como dado real.

---

## 7. Fases de implementação (cada fase = PR próprio, testes, revisão e aprovação)

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **01 — Fundação** | Módulo `nexus-ai`, Gateway, Model Router (Gemini) com tentativas e circuito, registro de agentes e ferramentas, `AIExecucao` retomável, `AIExecucaoFerramenta`, **`AIConsumo` com limites por empresa**, **separação instrução × dado e filtro de saída**, auditoria | Pergunta passa por Gateway → agente → ferramenta → resposta com fontes, registrada e limitada; **provedor fora do ar não afeta o ERP**; **limite de custo bloqueia só a IA**; testes de isolamento, permissão e **injeção básica** |
| **02 — Agente de Estoque (leitura)** | 6–8 ferramentas reais de estoque; **verificador de números**; **bateria de avaliação no CI**; tela "Conversar" | 20+ perguntas reais com números conferidos por cálculo; **resposta com número divergente é reprovada**; testes adversariais (cadastro com instrução embutida) passam; nenhuma resposta sem fonte |
| **03 — Comercial, Financeiro, Compras** | Um por vez, mesmo padrão | Mesma bateria por agente; permissões de custo/financeiro respeitadas |
| **04 — Orquestração (NEXUS BRAIN)** | Plano de etapas, chamada de vários agentes, consolidação e supervisão | "Por que o lucro caiu?" investigado por ≥ 2 agentes com evidências cruzadas |
| **05 — Inteligência preditiva** | Previsão de demanda/caixa, detecção de anomalias e simulador (cálculos determinísticos + interpretação) | Previsões comparadas com histórico (erro medido); simulador não altera dados |
| **06 — Automações controladas** | Outbox `AIEvento` + worker, **monitoramento de segurança em tempo real (eventos da seção 5A.1)**, insights automáticos, aprovações e execução autorizada (níveis 2–3) com idempotência | Evento → investigação → proposta → aprovação → execução auditada; nada executa sem permissão; **evento de segurança gera alerta mesmo com a IA fora do ar**; aprovar duas vezes não executa duas vezes |
| **07 — Homologação** | Isolamento, falha do provedor, custo, desempenho, recuperação, segurança | Relatório de homologação com evidências |

**Recomendação:** aprovar e iniciar apenas a **Fase 01 + Fase 02** (fundação + Agente de Estoque somente leitura). É o menor passo que já entrega valor real e valida toda a arquitetura.

---

## 8. Critérios para considerar a IA profissional

Dados reais com fonte · indicadores conferidos por cálculo (verificador reprova número divergente) · zero acesso indevido · empresas e filiais segregadas · resistência a manipulação (testes adversariais aprovados) · memória controlada · ferramentas reais validadas · auditoria completa · ERP independente da IA e investigações retomáveis sem duplicar · eventos de segurança monitorados em tempo real · tempo de resposta monitorado · custo e uso limitados por empresa · bateria de avaliação aprovada a cada mudança.

---

## 9. Decisões que dependem de você

1. **Provedor de IA:** começar só com o Gemini (já configurado) e deixar a troca preparada, ou já incluir um segundo provedor na Fase 01.
2. **Limite de custo por empresa** (ex.: valor mensal ou número de investigações por plano de assinatura).
3. **Base documental (RAG):** ativar pgvector no Supabase (operação administrativa — exige sua autorização) na fase em que os documentos forem implementados.
4. **Primeiro agente:** Estoque (recomendado) ou outro.

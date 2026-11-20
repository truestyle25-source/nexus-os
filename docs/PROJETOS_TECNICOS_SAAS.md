# Projetos técnicos — próximas evoluções do NEXUS OS (2026-11-20)

Projetos das Fases 11, 12 e 13. Cada um tem um bloqueio ou decisão explícita antes da implementação.

---

## Fase 11 — Autenticação com cookie HttpOnly

### Situação atual (verificada no código)
- `frontend/lib/api.ts`: JWT em `localStorage('nexus_token')`, enviado como `Authorization: Bearer`.
- Cookie `nexus_auth=1` (não HttpOnly) só como sinal para o `middleware.ts` do Next redirecionar telas.
- `localStorage('nexus_api_url')` pode sobrescrever a URL da API (qualquer XSS redireciona o token para outro host).
- Backend: `@fastify/cookie` registrado; revogação por `jti` (`TokenRevogado`); logout revoga o token.
- Sem refresh token: o JWT expira em 8 h e o usuário faz login de novo.

### Bloqueio para implementar sem quebrar o login
**É preciso saber se frontend e API estão no MESMO site (mesmo domínio registrável).**
- `NEXT_PUBLIC_API_URL` de produção está só nas variáveis da Vercel (não acessíveis daqui).
- Se a API estiver em outro domínio (ex.: `*.onrender.com` com o frontend em `*.vercel.app`), um cookie HttpOnly é **cookie de terceiros**: exige `SameSite=None; Secure`, e o Safari (ITP) e o modo anti-rastreamento do Chrome **bloqueiam**. O login quebraria para parte dos usuários.

### Arquitetura recomendada
1. **Mesmo site**: servir a API pelo domínio do frontend (rewrite da Vercel `/api/:path* → backend`, ou `api.seudominio.com.br` sob o mesmo domínio raiz).
2. Login define `nexus_session` = JWT, com `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`.
3. **CSRF**: `SameSite=Lax` bloqueia POST entre sites; mais o **header obrigatório** `X-Nexus-CSRF` (double submit: cookie legível `nexus_csrf` + header igual) em métodos que alteram dados.
4. `authenticate`: aceita cookie **ou** Bearer durante a transição (o PDV offline e a API pública continuam com Bearer).
5. Logout: revoga o `jti` (já existe) e apaga o cookie.
6. Frontend: `credentials: 'include'`; parar de gravar o token no `localStorage`; remover a sobrescrita `nexus_api_url` em produção.
7. Refresh token rotativo (opcional, fase 2): `nexus_refresh` HttpOnly com `Path=/auth/refresh`.

### Plano de transição (sem derrubar sessões)
| Passo | Efeito |
|---|---|
| A. Backend aceita cookie **e** Bearer; login passa a **também** definir o cookie | Ninguém é deslogado |
| B. Frontend usa `credentials: 'include'` e deixa de ler/gravar o token | Sessões novas só por cookie |
| C. Depois de 8 h (expiração máxima), parar de aceitar Bearer **nas rotas do painel** | O token antigo some sozinho |

### Testes necessários
Login/logout/me por cookie; CSRF (POST sem header → 403); cookie de outro site recusado; token revogado → 401;
PDV offline (fila Dexie) continua sincronizando; Safari/iOS e Chrome com bloqueio de terceiros; SSR do Next sem token.

### Decisão necessária (sua)
Confirmar o domínio da API em produção, ou autorizar colocá-la sob o mesmo domínio do frontend.

---

## Fase 12 — Isolamento e autorização por filial

### Mapeamento (verificado no schema)
- **18 tabelas com `filialId`**: Setor, Usuario, ProducaoKit, Estoque, SessaoInventario, EstoqueSnapshotDiario,
  EstoqueMovimentacao, Compra, Venda, Caixa, ConsumoInterno, Financeiro, DRE, IndicadorDiario, Meta, Funcionario,
  EstoqueReserva, IdempotencyKey.
- `Usuario.filialId`: **uma** filial por usuário (não há tabela usuário↔filiais).
- `Permissao`: por módulo/ação, **sem filial**.
- Hoje a filial é escolhida na requisição (`filialId` no corpo/query) e validada como "pertence à empresa", **não** como "o usuário pode operar nela".

### Proposta
1. Tabela `UsuarioFilial (usuarioId, filialId, papel)`; administrador da empresa = acesso a todas (flag `acessoTodasFiliais` no usuário).
2. Backend: no `authenticate`, carregar as filiais permitidas e:
   - validar todo `filialId` recebido (corpo/query) contra essa lista, com um helper único;
   - nas listagens sem filial, filtrar pelas filiais permitidas.
3. Banco: `set_config('app.filial_ids', 'id1,id2', true)` (já previsto no contexto) e policy **RESTRICTIVE** nas 18 tabelas:
   `USING (current_setting('app.filial_ids', true) IS NULL OR "filialId" IS NULL OR "filialId" = ANY(string_to_array(current_setting('app.filial_ids', true), ',')))`.
   Sem a variável (admin) = todas as filiais; com a variável = só as listadas.
4. Relatórios consolidados (DRE, dashboard): admin vê o consolidado; gerente vê só a(s) sua(s) filial(is).

### Pontos a decidir antes de implementar
- Registros sem filial (`filialId` nulo: metas e financeiros "da empresa") — quem vê?
- Transferência entre filiais: precisa de permissão nas duas pontas.
- Funcionário (RH) de uma filial pode ser visto pelo RH central?
- PDV: caixa é por usuário+filial (já é); o catálogo é por filial (já é).

---

## Fase 13 — Concorrência e escalabilidade

### Medido nesta revisão (ambiente isolado, `nexus_app` + RLS, servidor real)
| Cenário | Resultado |
|---|---|
| 5 empresas × 25 vendas simultâneas (estoque 10 cada) = 125 vendas em 5,6 s | Exatamente 10 aprovadas por empresa, estoque final 0, 0 respostas 5xx |
| 8 aberturas simultâneas de caixa pelo mesmo usuário | Exatamente 1 (advisory lock já existente) |
| 5 recebimentos simultâneos da mesma compra | **Antes**: 5 aceitos, 5 lançamentos financeiros, 35 un. movimentadas. **Depois** (`FOR UPDATE`): 1 aceito, 1 lançamento, 7 un. |
| 2 compras diferentes do mesmo produto recebidas juntas | **Antes**: atualização perdida. **Depois**: estoque 10, custo médio 3,8 (correto) |
| Isolamento sob carga | Cada empresa vê só o próprio produto |
| Logs do servidor | 0 deadlocks, 0 `too many connections`, 0 erros de permissão |
Teste permanente: `backend/tests/concorrencia-operacoes.test.ts` (falha sem as travas, passa com elas).

### Limites de conexão (capacidade)
- `max_connections` do Supabase: **60**; `nexus_app`: limite **20**; pool do Prisma: **10** por instância.
- 1 instância do backend = até 10 conexões. **Mais de 2 instâncias** com o pool de 10 excedem o limite do papel →
  ajustar `PRISMA_CONNECTION_LIMIT` (ex.: 6 por instância) ou usar o pooler em modo transação (porta 6543)
  com `pgbouncer=true`.
- Os agendadores rodam dentro do processo do backend: com várias instâncias, rodariam em duplicidade → mover para um worker único.

### Próximos testes recomendados (ambiente isolado)
- 50 e 100 empresas × 5 filiais com carga sintética (k6/autocannon) medindo p95 e conexões.
- Fechamento de caixa concorrente com vendas em andamento.
- Transferências entre filiais concorrentes (A→B e B→A no mesmo produto) para deadlock.
- `EXPLAIN ANALYZE` das listagens com RLS (custo do `set_config` + policy) com volume realista.

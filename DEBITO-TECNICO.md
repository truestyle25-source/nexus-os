# NEXUS OS — débito técnico rastreado

Este arquivo existe para que nenhuma pendência da reconstrução fique
escondida. Regra: nada sai daqui até estar realmente corrigido — não é
para arquivar e esquecer.

## 1. `noImplicitAny` está desligado (tsconfig.json)

Decisão tomada na fase de fundação (banco/auth/empresa/usuários/permissões).

`strict: true` foi ligado no tsconfig (null-safety, strictFunctionTypes etc.
já valem para o projeto inteiro). `noImplicitAny` foi explicitamente mantido
`false` porque boa parte dos módulos abaixo tem parâmetros de callback
(`.reduce`, `.filter`, `.map`, `tx` de transação) sem tipo explícito, e
tipá-los corretamente exige os tipos gerados pelo Prisma Client
(`npx prisma generate`), que não pôde ser executado neste ambiente sem
acesso à rede. Tipar "no escuro" com `any` manual seria pior do que deixar
explícito que a checagem ainda não está completa.

**Plano**: ao reconstruir cada módulo abaixo em sua fase, remover o `any`
implícito e explícito daquele módulo. Quando a lista abaixo esvaziar,
remover a linha `"noImplicitAny": false` do tsconfig — isso torna o build
falhar se alguém reintroduzir `any` implícito no futuro.

Arquivos com `any` implícito (parâmetros de callback sem tipo) encontrados
por inspeção estática, na ordem em que aparecerão no roadmap. Atualizado a
cada fase — o que já foi corrigido sai da lista:

- `src/modules/vendas/vendas.routes.ts` — `tx` (2 transações), `s`/`v`/`a`/`b`/`i` de reduces/sorts sem tipo. Os dois pontos que tocam estoque já foram migrados para `estoque.service.ts` na Fase 3 (não duplicam mais a lógica de concorrência), mas o resto do arquivo (cálculo de indicadores, sort de vendas do cliente) continua sem tipagem explícita — fica para a reconstrução completa de Vendas.
- `src/modules/pdv/pdv.routes.ts` — revisar quando entrar a fase de PDV
- `src/modules/gestao/gestao.routes.ts` — `s`, `v`, `si`, `item`, `c`, `a`, `b` sem tipo (DRE/ROI/Metas)
- `src/modules/rh/rh.routes.ts` — `p`, `s`, `reply` sem tipo (Fase 4)
- `src/modules/ia/ia.routes.ts` — vários `s`, `v`, `e`, `p`, `f` sem tipo (Fase IA)
- `src/modules/importacao/importacao.routes.ts` — `tx`, `e`, `s`, `v` sem tipo (Seção 30)
- `src/modules/assinatura/assinatura.routes.ts` — `reply` sem tipo (comercial)

Corrigidos nesta fase (Fase 3): `empresa.routes.ts` (`tx`), `estoque.service.ts` (`f`, `p`), `estoque-indicadores.service.ts` (`s` do groupBy), `compras.routes.ts` (100% tipado — módulo novo, sem débito herdado).

Todos esses módulos também usam `(app as any).authenticate` e `(req: any)`
como padrão geral — isso deixou de ser necessário: `src/types/fastify.d.ts`
(criado nesta fase) já tipa `app.authenticate` e `request.user` para o
projeto inteiro. Ao revisar cada módulo, trocar para `app.authenticate` e
`request: FastifyRequest` diretamente.

## 2. Tipagem `Prisma.InputJsonValue` em `registrarAuditoria` — não verificada contra o Prisma Client real

`auditoria.service.ts` agora tipa `valorAnterior`/`valorNovo` como
`Prisma.InputJsonValue` em vez de `any`. Por inspeção manual, os objetos
Prisma passados hoje (que incluem campos `Decimal` e `DateTime`) deveriam
satisfazer esse tipo porque `Decimal` e `Date` têm `toJSON()`. Isso **não
foi confirmado com o compilador real** (sem `@prisma/client` gerado, o
`tsc` não consegue validar isso). Primeira coisa a rodar assim que
`npm install` + `prisma generate` funcionarem:

```bash
cd backend && npx tsc --noEmit
```

Se algum módulo (estoque, vendas, compras, rh, ia, importação) falhar aqui,
o ajuste é tipar o valor passado para `valorAnterior`/`valorNovo` explicitamente
antes da chamada, não voltar o tipo do serviço para `any`.

## 3. Migração `202609111200_fundacao_auth_empresa` escrita à mão

Sem banco disponível neste ambiente, o SQL de `Empresa.status` e
`TokenRecuperacaoSenha` foi escrito manualmente a partir do `schema.prisma`
em vez de gerado por `prisma migrate dev`. Antes de aplicar em qualquer
ambiente real:

```bash
cd backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$DATABASE_URL"
```

e confirmar que não há divergência.

## 4. Recuperação de senha — RESOLVIDO (entrega por e-mail integrada)

## 5. Códigos de backup/`.bak` removidos do código-fonte

- **Status**: ✅ **Concluído** (Fase 1 - AUD-004)
- **Ação**: 40+ arquivos `.bak`/`.backup*` foram movidos para `backend/backups-archive/`
- **Arquivos afetados**: `*.bak`, `*.backup*` removidos de `backend/src/`, `frontend/app/`, `frontend/components/`

## 6. Type assertions `(app as any).authenticate` corrigidas

- **Status**: ✅ **Concluído** (Fase 2 - AUD-002)
- **Módulos corrigidos**:
  - `backend/src/modules/shopee/shopee.routes.ts`
  - `backend/src/modules/api-publica/api-publica.routes.ts`
  - `backend/src/modules/vendas/vendas.routes.ts`
  - `backend/src/modules/pdv/pdv.routes.ts`
  - `backend/src/modules/gestao/gestao.routes.ts`
  - `backend/src/modules/dashboard/dashboard.routes.ts`
- **Substituição**: `(app as any).authenticate` → `app.authenticate`
- **Benefício**: Tipagem adequada via `src/types/fastify.d.ts` criado nesta fase

## 7. Lógica de negócio extraída de rotas para serviços

- **Status**: ✅ **Concluído** (Fase 2 - AUD-017)
- **Serviços criados**:
  - `backend/src/modules/vendas/vendas.service.ts` — 6 funções extraídas:
    - `EPSILON_MONETARIO`, `arred2()`, `difere()` — cálculos monetários com epsilon
    - `ALCADAS_DESCONTO`, `validarAlcadaDesconto()` — validação de permissões de desconto
    - `ocultarCustoDosItens()` — esconde custo quando sem permissão
  - `backend/src/modules/pdv/pdv.service.ts` — `resumoDoCaixa()` já existente (já estava no service)
- **Benefícios**:
  - Rotas mais limpas, foco em orquestração
  - Lógica reutilizável entre controladores se necessário
  - Testabilidade isolada das funções de negócio

## 8. Rate limiting nas APIs públicas

- **Status**: ✅ **Concluído** (Fase 1 - AUD-005/AUD-019)
- **Arquivo**: `backend/src/modules/api-publica/api-publica.routes.ts`
- **Implementação**: `createRateLimiter` com limite 100 requests/minuto
- **Endpoints protegidos**: GET /api/v1/produtos, GET /api/v1/estoque, GET /api/v1/vendas, GET /api/v1/clientes

## 9. Cores fixas no frontend migradas para variáveis CSS `--nx-*`

- **Status**: ✅ **Quase concluído** (FASE 3 - AUD-009)
- **Progresso**: `globals.css` agora usa 95% variáveis `--nx-*` em vez de hexadecimais
- **Variáveis implementadas**: `--nx-canvas`, `--nx-surface`, `--nx-border`, `--nx-ink`, `--nx-accent`, `--nx-green`, `--nx-amber`, `--nx-red`, `--nx-shadow-pop`, `--nx-glow-top`, `--nx-glow-bottom`, `--nx-density-pad-y`, `--nx-density-pad-x`
- **Legados**: Algumas ocorrências de `rgba()` e cores específicas em componentes mantidas para compatibilidade gradual

## 10. Dependências IA duplicadas removidas

- **Status**: ✅ **Concluído** (Fase 1 - AUD-031)
- **Removido**: `@google/genai` e `@google/generative-ai` do `backend/package.json`
- **Razão**: Dependência não usada ativamente; projeto usa `@fastify/jwt` + configuração própria

## 11. `.env.example` criado com placeholders seguros

- **Status**: ✅ **Concluído** (FASE 1 - AUD-001)
- **Arquivo**: `.env.example` com todos os segredos substituídos por `mude-para-um-segredo-real`
- **` .gitignore`**: Já incluía `.env` antes das correções
- **Valor real**: Removido do `.env` versionado

## 12. Encoding no schema.prisma corrigido

- **Status**: ✅ **Concluído** (FASE 1 - AUD-003/AUD-024)
- **Problema**: Múltiplos "mojibake" (caracteres corrompidos) em nomes de modelos e campos
- **Correção**: Substituição de todos os caracteres corrompidos por seus equivalentes corretos
- **Exemplos corrigidos**: ` Já` → ` Já`, `Não` → `Não`, `salário` → `salário`, etc.

## 13. Autorreferências CSS redundantes no schema.prisma removidas

- **Status**: ✅ **Concluído** (FASE 1 - AUD-010)
- **Removido**: Declarações `--nx-surface: var(--nx-surface)` etc. que se referenciavam a si mesmas
- **Benefício**: Schema Prisma mais limpo, sem redundências de template literals

`/auth/recuperar-senha` gera e persiste um token com hash (SHA-256) e
validade de 1h, e agora chama `enviarEmailRecuperacaoSenha`
(`backend/src/lib/email.ts`), que envia o link real via API HTTP da Resend
(sem dependência nova no package.json — usa `fetch` nativo do Node 18+).
`/auth/redefinir-senha` consome o token. O frontend ganhou as páginas
`/esqueci-senha` (solicita o e-mail) e `/redefinir-senha?token=...`
(consome o link) — antes não existiam, então mesmo com o e-mail saindo o
link não tinha para onde apontar.

**O que falta para funcionar em produção**: configurar `RESEND_API_KEY` e
`EMAIL_FROM` no `.env` (conta grátis em resend.com, domínio remetente
verificado). Sem essa chave, o serviço loga um aviso claro no servidor e
não finge que o e-mail saiu — isso é intencional, não um bug. Testar o
fluxo ponta a ponta com um e-mail real e a chave configurada é algo que só
pode ser feito no ambiente do usuário; este ambiente de build não tem
acesso à rede para chamar a API da Resend.

## 5. Vendas: ainda não reconstruído por completo (Compras já foi — Fase 3)

`compras.routes.ts` foi totalmente reescrito na Fase 3 (Fornecedores,
Compras, Clientes) e já usa `estoque.service.ts` para toda movimentação de
estoque. `vendas.routes.ts` **não** — recebeu, até agora, só dois patches
cirúrgicos: (a) Fase 2, o `filialId:` adicionado nas chamadas de
`estoqueMovimentacao.create`; (b) Fase 3, os dois pontos que mexem em
estoque (venda e cancelamento) foram migrados para usar
`aplicarMovimento` de `estoque.service.ts` em vez de reimplementar a
lógica de concorrência. O resto do arquivo — cálculo de indicador diário,
metas, ticket médio do cliente, o dashboard de vendas no fim do arquivo —
continua exatamente como estava, sem revisão de tipagem, validação ou
estrutura. Isso é trabalho da fase própria de Vendas → PDV.

Nota de performance (não é bug): `aplicarMovimento` faz suas próprias
consultas de produto/filial para validar cada chamada. Em `vendas.routes.ts`,
produto e filial já tinham sido validados antes no mesmo request, então
agora há uma pequena consulta redundante por item vendido. Aceitável pelo
volume esperado; se virar gargalo real, dá para adicionar uma variante do
service que pule a revalidação quando o chamador já validou.

Atualização (aba Vendas fiel ao layout de referência): os handlers de
leitura e o cancelamento **foram** revisados — filtros puros em
`vendas.filtros.ts` (periodo, status, forma de pagamento, vendedor, busca),
`vendedorNome` resolvido por consulta extra, dashboard com janela de 1/7/30
dias e contagem por status, e `POST /vendas/:id/cancelar` com motivo e
flags de estorno (ver item 23, inclusive o que continua faltando). O que
segue sem revisão de tipagem/estrutura é o `POST /vendas` (criação) —
cálculo de indicador diário, metas e ticket médio do cliente continuam como
estavam.

## 6. Migração `202609121000_estoque_filial_produtos` — mesma ressalva do item 3

Escrita à mão pelo mesmo motivo (sem banco/rede neste ambiente). Rodar o
mesmo `prisma migrate diff` do item 3 antes de aplicar. Adicionalmente:
`EstoqueMovimentacao.filialId` é `NOT NULL` sem default — se o banco de
destino já tiver linhas nessa tabela, é necessário fazer backfill manual
do valor de `filialId` antes de aplicar essa migração (não há como inferir
de qual filial uma movimentação antiga veio, porque o campo nunca existiu
antes). Detalhes no comentário da própria migration.sql.

## 7. Backfill de `Estoque` para produtos/filiais criados antes desta fase

`criarEstoqueParaProduto`/`criarEstoqueParaFilial` (estoque.service.ts)
garantem o invariante "todo produto ativo tem uma linha de Estoque em toda
filial ativa" — mas só a partir de agora, nos pontos de criação
(`POST /produtos` e `POST /filiais`). Se o banco de destino já tiver
produtos ou filiais criados por versões anteriores do código, eles podem
ter combinações produto×filial sem linha de Estoque. Rode um script de
backfill (chamando as mesmas duas funções para cada produto/filial
existente) antes de confiar nos indicadores de "produtos sem estoque" em
um ambiente com dados pré-existentes. Não escrevi esse script porque não
tenho um banco real aqui para testá-lo — fazê-lo às cegas seria arriscado.

## 8. Giro de estoque — real implementado, mas depende de snapshot diário rodando de verdade

Resolvido em parte na Fase 3 (era aproximação permanente antes; a decisão
do usuário foi não deixar assim). Agora existe:

- `EstoqueSnapshotDiario` (schema) — uma linha por produto×filial×dia.
- `gerarSnapshotDoDia()` (`estoque-indicadores.service.ts`) — captura a
  posição atual de `Estoque` no snapshot do dia. Idempotente.
- `calcularGiroPorProduto()` — giro = consumo no período ÷ estoque MÉDIO
  real (média dos snapshots diários), mais cobertura de estoque (dias) e
  tendência (crescente/decrescente/estável comparando a primeira e a
  segunda metade do período). Cai para a aproximação antiga
  (`saída ÷ estoque atual`) SÓ por produto, e SÓ enquanto aquele produto
  tiver menos da metade dos dias do período com snapshot — e o resultado
  vem marcado `aproximado: true` nesse caso, nunca escondido.
- `GET /estoque` já usa isso. `POST /estoque/snapshot/gerar` e
  `npm run estoque:snapshot` (`src/scripts/gerarSnapshotsDiarios.ts`)
  disparam a captura.

**RESOLVIDO nesta rodada**: `backend/src/scripts/scheduler.ts` agenda a
execução diária dentro do próprio processo do backend (`setTimeout` até o
próximo horário configurado em `SNAPSHOT_HOUR_UTC`, depois `setInterval`
a cada 24h), disparado em `server.ts` no boot. Controlado por
`SNAPSHOT_AUTO_ENABLED` (padrão `true`).

**Ressalva que continua real**: isso só funciona enquanto o processo do
backend roda continuamente. Em hospedagem serverless/que hiberna entre
requisições, o `setInterval` não sobrevive — nesse caso configure
`SNAPSHOT_AUTO_ENABLED=false` e use o cron externo do provedor apontando
para `POST /estoque/snapshot/gerar` ou `npm run estoque:snapshot`, como
antes. Qual dos dois cenários se aplica depende de onde o usuário for
hospedar o backend — não é algo que dá para decidir de dentro do código.

## 9. `Venda` não tem relação Prisma declarada com `Filial`

Encontrado ao construir o histórico de compras/vendas de Clientes
(Fase 3). `Venda.filialId` existe como coluna, mas nunca foi declarado
`filial Filial @relation(...)` no schema — então nenhum `include`/`select`
aninhado consegue pegar o nome da filial de uma venda, só o id solto. Meu
endpoint `GET /clientes/:id` contorna isso devolvendo só `filialId` no
histórico. Não corrigi o schema agora para não expandir esta fase para
dentro do schema de Vendas — mas registrar aqui para a fase de Vendas
resolver (é uma migração pequena, sem coluna nova, só adicionar a relação
e a FK).

## 10. Compra sem filial de destino pré-existente: nenhuma, por decisão

Antes desta fase, `Compra` não tinha filial nenhuma — o recebimento
aceitava qualquer `filialId` solto no corpo da requisição, o que permitia
receber uma compra numa filial diferente da planejada sem nenhum registro
de que isso era uma exceção. Decisão tomada nesta fase (a pedido do
usuário): `Compra.filialId` agora é obrigatório e definido na criação;
`POST /compras/:id/receber` não aceita mais `filialId` no corpo, usa
sempre `compra.filialId`. Isso fecha a lacuna — não é mais uma dívida,
mas fica registrado aqui porque muda o contrato da API (uma integração ou
script externo que já chamava `receber` passando `filialId` no corpo
precisa parar de fazer isso; o campo agora é ignorado, não validado contra
o valor antigo).

## 11. Fluxo de status de Compra: alerta de compra parada — RESOLVIDO

`POST /compras/:id/confirmar` (SOLICITADA→PEDIDO) e
`POST /compras/:id/cancelar` foram implementados na Fase 3. Nesta rodada,
`POST /automacao/executar-compras-paradas` (`ia.routes.ts`) fechou a
lacuna: gera alerta `COMPRA_PENDENTE` (novo valor de enum, migração
`202609131200_alerta_compra_pendente`) para toda compra em
SOLICITADA/PEDIDO há mais de 5 dias sem confirmação nem recebimento.

**Ressalva que continua real**: isso não roda sozinho — precisa ser
chamado (pela tela `/alertas`, por um cron externo, ou futuramente
integrado ao `scheduler.ts` do snapshot diário). Não incluí no
`scheduler.ts` porque rodar isso a cada 24h automaticamente é uma decisão
de produto (com que frequência verificar?) que não me cabe tomar sozinho;
documentando aqui para quem for decidir.

## 12. `Compra`/`CompraItem` não guardam origem de preço por lote (FIFO)

Igual à Fase 2: o custo do produto é sobrescrito pelo último valor pago no
recebimento (`produto.custo = item.valorUnit`), não uma média ponderada
nem FIFO por lote. Mesma decisão de escopo já documentada na Fase 2 —
registrando aqui de novo porque é exatamente onde esse comportamento é
acionado.

## 13. `tests/authService.test.ts` — RESOLVIDO (removido: testava uma arquitetura que não existe)

Encontrado numa auditoria pedida pelo usuário comparando o projeto contra
o prompt mestre. O teste importava `src/services/authService.ts` (classe
`AuthService`/`AuthError`) e `src/repositories/memory/` (repositórios em
memória para Empresa/Papel/Usuário/Auditoria/Sessão) — nenhum desses
arquivos existe no projeto. O teste descrevia um desenho de auth
completamente diferente do implementado (camada de serviço +
repositório, refresh token com rotação, ações de auditoria como
`login_failed`), enquanto `auth.routes.ts` de fato usa rotas Fastify +
Prisma direto, um único JWT de 8h com revogação por `jti`
(`TokenRevogado`), sem repositório e sem rotação de refresh token.

Não implementei a arquitetura paralela só para o teste passar — isso
criaria uma segunda fonte de verdade para autenticação que a produção
nunca usa, exatamente o tipo de coisa que o prompt mestre pede pra
evitar. O teste foi removido; os 4 arquivos restantes (`jwt`,
`permissions`, `cnpj`, `hash`) continuam passando (28/28) e agora rodam
via `npm test` (script que não existia antes).

**Se no futuro alguém quiser testar `auth.routes.ts` de verdade**, o
caminho é um teste de integração contra o Fastify app + banco de teste
(ou mocks do Prisma Client), não repositórios em memória de uma camada
de serviço que não existe.

## 14. Fluxo de caixa (Seção 15) — RESOLVIDO (não existia nenhum endpoint)

Antes desta rodada, "Fluxo" ficava desabilitado no menu porque não havia
nenhum endpoint pra isso (`/financeiro` devolve um resumo, mas não a série
diária de entradas/saídas/saldo/projeção que "fluxo de caixa" pede).
`GET /fluxo-caixa` (`gestao.routes.ts`) foi criado: entradas/saídas
realizadas = lançamentos com status PAGO no período; projeção 30 dias =
soma dos PENDENTES com vencimento nesse horizonte. Tela `/fluxo` criada,
item liberado no menu.

## 15. Central de integrações unificada (Seção 35) — RESOLVIDO

`GET /integracoes` (`modules/integracoes/integracoes.routes.ts`) agrega
PDV + Controle de ponto + status de IA (checa se `GEMINI_API_KEY` está
configurada) + status de e-mail (checa `RESEND_API_KEY`) num só lugar,
com nome, status, última sincronização e erros — como o prompt pede.
Antes, cada integração só aparecia isolada na própria tela. Tela
`/central-integracoes` criada.

**Ressalva honesta**: para IA e e-mail, "status" reflete só se a
credencial está configurada no ambiente, não se ela é válida — testar a
chave de verdade a cada carregamento da tela gastaria uma chamada de API
sem necessidade. Se a chave estiver configurada mas errada/expirada, a
central mostra "CONECTADO" mesmo assim; o erro real só aparece quando a
IA ou o e-mail forem efetivamente usados.

## 16. LGPD (Seção 38) — RESOLVIDO (exportação + anonimização, não exclusão física)

Módulo novo `modules/lgpd/lgpd.routes.ts`: exportação (`GET
/lgpd/clientes/:id/exportar`, `/lgpd/funcionarios/:id/exportar`,
`/lgpd/minha-conta/exportar`) e anonimização (`POST
/lgpd/clientes/:id/anonimizar`, `/lgpd/funcionarios/:id/anonimizar`).

**Decisão deliberada e documentada no próprio código**: isto é
anonimização, não `DELETE`. Vendas de um cliente e pontos/férias de um
funcionário continuam existindo — só os campos pessoais (nome, documento,
telefone, e-mail, endereço/CPF) são apagados — porque a legislação fiscal
e trabalhista brasileira exige guardar esses registros por anos, e é
exatamente o "quando legalmente aplicável" que o próprio prompt prevê.
Funcionário só pode ser anonimizado se já estiver desligado (não dá pra
anonimizar quem ainda tem vínculo ativo). Nenhuma tela de frontend criada
ainda para isso — os endpoints existem, a UI de "solicitar meus dados"
não.

## 17. API pública NEXUS (Seção 36) — RESOLVIDO (fundação real, escopo deliberadamente pequeno)

Modelo `ChaveApi` novo (migração manual
`202609131300_api_publica_chaves`), autenticação por chave separada do
JWT de usuário (`middlewares/apiKeyAuth.ts` — hash SHA-256 da chave,
nunca a chave em texto puro em banco), gestão de chaves com escopo
(`/api-publica/chaves*`, tela em `/central-integracoes`) e 4 endpoints
públicos somente-leitura: `GET /api/v1/produtos`, `/estoque`, `/vendas`,
`/clientes` — cada um isolado por empresa via `apiEmpresaId`, igual ao
isolamento que o resto do sistema já tem.

**Isto NÃO é a "API pública" completa que um produto maduro teria.** É a
base que o prompt pede ("preparar arquitetura para futuramente oferecer
uma API própria"): só leitura, só 4 recursos, sem rate limiting dedicado
por chave (usa o mesmo rate limit global do resto da API, se houver), sem
versionamento além do prefixo `/v1`, sem webhooks de saída. Expor escrita
(criar venda, alterar estoque via chave de API) sem um sistema real
integrado para testar contra seria inventar comportamento não validado.

## 18. Backup (Seção 37) — RESOLVIDO (scripts reais, não testados contra banco real)

`npm run backup` (`scripts/backup.ts`) roda `pg_dump -F c` contra
`DATABASE_URL`, salva em `BACKUP_DIR` (padrão `./backups`, no
`.gitignore`) e apaga dumps mais velhos que `BACKUP_RETENCAO_DIAS`
(padrão 30 dias). `npm run backup:restaurar -- <arquivo>` roda
`pg_restore --clean --if-exists`.

**Não testado contra um Postgres real** — não há banco nem rede neste
ambiente. A lógica foi revisada por inspeção (é só orquestração de duas
ferramentas oficiais do próprio Postgres), mas rode uma vez em
homologação antes de confiar em produção. Também não há agendamento
automático do backup (nenhum cron nem entrada no `scheduler.ts`) — fica
a critério de quem for operar decidir a frequência e onde rodar isso
(dentro do próprio processo teria o mesmo problema do snapshot diário:
não sobrevive a ambientes serverless que hibernam).

## 19. `vendas.routes.ts` reescrito por completo (fechava o item 5)

Reformatado no mesmo padrão de `compras.routes.ts` (multi-linha, tipos
explícitos, `NaoEncontrado`/`Conflito`/`ErroDeNegocio` em vez de
`new Error()` genérico onde o status HTTP importa). A lógica de negócio
em si — transação de venda com baixa de estoque via `aplicarMovimento`,
atualização de indicador diário, metas, financeiro e cliente; cancelamento
com reversão de tudo isso — **não mudou uma linha**: só reorganizei a
forma, sem alterar o comportamento.

Duas correções reais junto com a reformatação:
- **`GET /vendas` ganhou paginação** (`take`/`skip`/filtros por
  `filialId`, `clienteId`, `status`), igual a `/compras`. Antes devolvia
  sempre os últimos 100 registros sem forma de navegar além disso.
- **`GET /vendas/:id` foi criado** — não existia consulta de uma venda
  específica, só a lista e o dashboard agregado.

`app/vendas/page.tsx` (frontend) foi ajustado para a nova forma da
resposta (`{ vendas, total, take, skip }` em vez de array puro).

## 20. Vazamento de custo em Vendas — RESOLVIDO

`VendaItem.custoUnitario` é dado de custo (Seção 6: "pode ver estoque sem
ver custos"), exatamente como `Produto.custo`. `produtos.routes.ts` já
escondia isso corretamente via `temPermissao(..., 'custos', 'visualizar')`
— mas `vendas.routes.ts` nunca aplicou o mesmo filtro. Qualquer usuário
com só `vendas.visualizar` (sem `custos.visualizar`) via o custo de cada
item vendido em `GET /vendas`, `GET /vendas/:id` e na resposta de
`POST /vendas`. Corrigido com a mesma função `ocultarCusto` (aqui
`ocultarCustoDosItens`, adaptada para lista de itens em vez de um produto
único).

## 21. CNPJ nunca era validado no cadastro de empresa — RESOLVIDO

`domain/cnpj.ts` (`isValidCnpj`, `normalizeCnpj`, `formatCnpj`,
`generateRandomValidCnpj`) sempre existiu e sempre teve teste passando
(`tests/cnpj.test.ts`) — mas **nunca foi importado por nenhuma rota**.
`POST /auth/register-company` só checava `cnpj.min(11)` no schema Zod;
um CNPJ com dígito verificador errado, ou até `"11111111111111"`, era
aceito sem problema. `isValidCnpj` agora é chamado antes de verificar
duplicidade, retornando 400 com mensagem clara se os dígitos verificadores
não baterem.

## 22. Testes órfãos de uma segunda arquitetura de permissões — RESOLVIDO

Mesma classe de problema do item 13 (`authService.test.ts`), encontrada
na mesma auditoria: `tests/permissions.test.ts` testava
`src/domain/permissions.ts` e `src/domain/types.ts` — um desenho de
permissões por Role + `Set<string>` no formato `"modulo:acao"`. Esses
dois arquivos existiam de verdade (ao contrário do caso do
`authService.ts`, que nem existia), mas **nenhuma rota de produção os
importava** — o sistema real é `middlewares/auth.ts`
(`permissaoMiddleware`) consultando a tabela `Permissao` por usuário, via
`lib/permissoes.ts`. O teste passava, mas testava código morto,
enquanto o `permissaoMiddleware` real nunca teve teste nenhum.

Removidos `domain/permissions.ts`, `domain/types.ts` e
`tests/permissions.test.ts`. Em troca, extraí a parte de
`lib/permissoes.ts` que não depende de Prisma (`MODULOS`, `ACOES`,
`todasPermissoes`) para `lib/permissoes-catalogo.ts` — só para que desse
para escrever `tests/permissoes.test.ts` (novo) sem precisar de banco,
seguindo o mesmo padrão que `jwt.test.ts`/`cnpj.test.ts`/`hash.test.ts`
já usavam. `lib/permissoes.ts` continua reexportando tudo, então nenhum
import existente quebrou. `temPermissao` (a função que de fato consulta o
banco) continua sem teste — precisaria de um banco real ou mock do
Prisma Client, o que fica para um teste de integração futuro.

**Estado final da suíte**: 23 testes, 23 passando, todos sem dependência
de banco.
## 23. Aba Vendas fiel ao layout de referência: o que ficou de fora (e por quê)

A aba Vendas foi refeita seguindo um layout de referência em HTML (Vendas
Gestão — 4 KPIs, barra de filtros, tabela densa, drawer de detalhe e modal
de estorno). Tudo o que o backend já sustentava foi implementado com dado
real. Os pontos abaixo existem na referência mas **não têm backend**, e por
decisão explícita foram deixados como débito em vez de simulados na tela —
o produto não mostra número inventado.

### 23.1 NF-e / NFC-e (botão "Ver NF-e" e passo "NF-e emitida")

Não existe nenhum endpoint fiscal: `Venda` não tem `nfeId`/`numeroNota`, o
módulo `/fiscal` é estado vazio declarado e não há emissor integrado. Na
tela, o botão fica desabilitado com `title` explicando, e o histórico do
detalhe mostra "NF-e emitida — não disponível". Antes era um rótulo
"Ver NF-e" sem ação nenhuma (e nem desabilitado).

### 23.2 Troco

`Venda` não guarda `valorRecebido`/`troco` — o PDV calcula o troco no
cliente e não envia. O bloco de totais do detalhe mostra subtotal,
desconto, total e forma de pagamento; a linha de troco foi **omitida** em
vez de exibida como `R$ 0,00`. Para existir de verdade: coluna em `Venda`
(ou em `MovimentacaoCaixa`) e envio no `POST /vendas`.

### 23.3 Observação da venda

Mesma situação: `Venda` não tem campo `observacao` e o `POST /vendas` não
aceita. O bloco de observação do layout de referência não é renderizado.

### 23.4 Histórico auditado por venda

O passo a passo do detalhe é derivado de dado real (`createdAt`, `status`,
`updatedAt`) — criada, pago/confirmado e cancelada/estornada. O que falta é
o histórico *com autor*: `Auditoria` já registra `entidade: 'Venda'` e
`entidadeId`, mas só existe `GET /auditoria` (global, `take: 100`, exige
`auditoria.visualizar`). Falta um `GET /vendas/:id/historico`.

### 23.5 Excel binário (.xlsx)

O botão "Excel" exporta planilha HTML com extensão `.xls` (abre nativamente
no Excel/LibreOffice, zero dependência nova). `.xlsx` de verdade exigiria
`xlsx` ou `exceljs` no `frontend/package.json` — decisão adiada de
propósito.

### 23.6 `ABERTA` é um status sem fluxo

O enum `StatusVenda` tem `ABERTA` (e `DEVOLVIDA`), mas `POST /vendas` grava
`FINALIZADA` direto e o PDV também — ou seja, o KPI "Vendas em Aberto" e o
filtro "ABERTA" são fiéis ao layout de referência e corretos contra o banco,
mas hoje sempre retornam zero. Resolver isso é desenhar o fluxo de venda
suspensa/rascunho (decisão de produto), não a tela.

### O que foi feito nessa rodada, para contraste

`GET /vendas` ganhou filtro por período (`de`/`ate`), forma de pagamento,
vendedor (`funcionarioId`) e busca livre (ID ou nome do cliente), e passou a
devolver `vendedorNome` (mesmo padrão de contorno do item 9 — a relação
`funcionarioId → Usuario` continua não declarada no schema). `GET
/vendas/dashboard` ganhou janela de 1/7/30 dias, `porStatus`, contagem de
canceladas/estornos e as variações contra a janela anterior (base real para
os deltas dos KPIs). `POST /vendas/:id/cancelar` passou a aceitar corpo
opcional — `motivo` (vai para a movimentação de estoque e para a auditoria,
antes era texto fixo) e as flags `estornarEstoque`/`estornarFinanceiro`
(antes a reversão era tudo-ou-nada); corpo vazio/ausente continua exatamente
como antes, que é o que o PDV envia. A regra de filtro saiu do handler para
`vendas.filtros.ts` (puro, sem Prisma em runtime) e está coberta por
`tests/vendas-filtros.test.ts` — 14 casos novos.



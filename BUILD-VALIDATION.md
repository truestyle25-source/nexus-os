# NEXUS OS — validação da revisão final deste pacote

## Fase: fundação (Prisma, Auth, Empresa, Filiais, Usuários, Permissões, arquitetura base do backend)

### Correções aplicadas

- Corrigido bug real de compilação: `src/middlewares/auth.ts` usava o tipo
  `FastifyInstance` sem importá-lo (`registerAuthentication(app: FastifyInstance)`).
  Isso quebrava o build independentemente de dependências instaladas.
- `tsconfig.json`: `strict` ligado (`false` → `true`). `noImplicitAny` mantido
  `false` deliberadamente — ver `DEBITO-TECNICO.md` item 1 para o motivo e o
  plano de fechá-lo módulo por módulo.
- Criado `src/types/fastify.d.ts`: tipagem de `app.authenticate` e
  `request.user` (payload do JWT) para o projeto inteiro, eliminando a
  necessidade de `(app as any).authenticate` / `(req: any)` nos módulos
  revisados. Módulos ainda não revisados continuam funcionando (o `any`
  explícito neles não quebra com `strict: true`), mas devem migrar para os
  tipos novos quando entrarem em sua fase.
- Criado `src/lib/permissoes.ts`: catálogo central de módulos/ações (Seção 6)
  compartilhado por auth, usuários e todo módulo futuro — evita permissão
  "fantasma" por string digitada errado.
- Criado `src/lib/erros.ts` (`ErroDeNegocio`) e corrigido o error handler
  global (`server.ts`): antes, qualquer `throw new Error('mensagem')` dentro
  de uma rota (padrão usado em todos os módulos do projeto, inclusive nos
  ainda não revisados) virava HTTP 500 genérico e a mensagem de negócio era
  descartada. Isso violava a Seção 45 ("mensagens claras") em todo o
  sistema, não só nesta fase. Agora: Zod → 400 com detalhes; `ErroDeNegocio`
  → status explícito; erro conhecido do Prisma (`P2002`/`P2025`) → 409/404;
  `Error` simples lançado deliberadamente → 400 com a própria mensagem;
  qualquer outra coisa → 500 genérico (detalhe só no log do servidor).
- `Empresa` ganhou o campo `status` (StatusGeral). `authenticate` agora nega
  acesso se a empresa do usuário estiver suspensa, mesmo com token válido.
- Adicionado fluxo completo de recuperação de senha: geração de token
  (hash SHA-256, validade de 1h) em `/auth/recuperar-senha` e consumo em
  `/auth/redefinir-senha` (endpoint novo). Entrega do token ao usuário
  (e-mail) continua pendente — ver `DEBITO-TECNICO.md` item 4.
- Removido `POST /empresas`: criava uma Empresa órfã (sem filial, usuário
  ou assinatura) a partir de uma sessão já autenticada, inconsistente com o
  modelo de 1 usuário → 1 empresa usado no resto do sistema. Nada no
  frontend chamava esse endpoint. `GET /empresas` foi mantido (path
  inalterado — 3 páginas do frontend dependem dele) e não é afetado.
- `auditoria.service.ts`: `valorAnterior`/`valorNovo` deixaram de ser `any`
  e passaram a `Prisma.InputJsonValue` — ver `DEBITO-TECNICO.md` item 2 para
  a ressalva sobre verificação sem Prisma Client gerado.
- Adicionado encerramento gracioso do processo (`SIGTERM`/`SIGINT` fecham o
  Fastify e desconectam o Prisma antes de sair).

### Correções aplicadas (etapa anterior, mantidas)

- Mantida a arquitetura única Fastify + Prisma; nenhuma integração legada Express/PG foi reintroduzida.
- Corrigido o isolamento do produto usado no cancelamento de venda para validar `empresaId`.
- Corrigido o motor de automação para que a existência de um alerta de estoque não interrompa a avaliação de validade do mesmo produto.
- Alertas de estoque passaram a distinguir `ESTOQUE_ZERADO` de `ESTOQUE_BAIXO` e evitam duplicação por tipo/entidade.
- Dashboard passou a consultar também DRE, ROI e metas existentes no backend, sem criar novas fontes de dados.
- Mantida a migration Prisma existente para as alterações de integridade (`202609110001_integrity_security`).

## O que NÃO foi inventado

- Não foi criada integração de PDV sem fornecedor/API/SDK/webhook ou banco oficialmente autorizado.
- Não foi criada uma entidade fictícia de campanha/projeto/investimento para mascarar a limitação atual do ROI.
- Não foi criado um serviço de e-mail fictício para recuperação de senha. O projeto continua exigindo um provedor de e-mail autorizado para entregar o link/token ao usuário.
- A integração Control iD usa somente endpoints documentados pelo fabricante. O código atual lê `access_logs`; o mapeamento semântico de tipos de batida depende da configuração do Modo Ponto do equipamento e não é presumido pelo NEXUS.

## Fase: Produtos → Estoque

### Correções aplicadas

- **Bug estrutural real**: `EstoqueMovimentacao` não tinha `filialId`, apesar do estoque em si ser controlado por filial (`Estoque.filialId`). Isso tornava impossível reconstruir histórico de movimentação por filial e impossível implementar transferências de verdade. Adicionado `filialId` (obrigatório) e `filialDestinoId` (opcional, usado em transferências) ao model, com migração e patch mínimo nos 3 pontos de Vendas/Compras que já criavam `EstoqueMovimentacao` (ver `DEBITO-TECNICO.md` item 5 — só o campo novo foi adicionado lá, não uma reescrita).
- **Vazamento de dado real**: `GET /produtos` e `GET /estoque` sempre devolviam `custo`, `margem` e `valorTotal`, mesmo para usuários sem a permissão `custos.visualizar` — violava o exemplo explícito da Seção 6 ("visualizar estoque sem visualizar custos"). Corrigido: esses campos somem da resposta (não viram `0`, que seria um dado falso) quando o usuário não tem essa permissão.
- **Lacuna real**: produto novo não tinha nenhuma linha de `Estoque` até a primeira movimentação, então ficava invisível em "produtos sem estoque"/"estoque baixo". Corrigido com `criarEstoqueParaProduto`/`criarEstoqueParaFilial` (`estoque.service.ts`), chamadas na criação de Produto e de Filial. Backfill para dados pré-existentes ainda pendente — `DEBITO-TECNICO.md` item 7.
- **Lacuna real**: `POST /estoque/movimentar` recusava explicitamente `TRANSFERENCIA` ("não pode ser feita por este endpoint"), mas não existia nenhum outro endpoint que implementasse transferência — Seção 9 pede isso explicitamente. Implementado `POST /estoque/transferir`, transacional, com concorrência segura, gerando duas movimentações ligadas por um `documento` compartilhado.
- Extraída a lógica de movimentação de estoque (antes inline em `estoque.routes.ts`) para `estoque.service.ts`, reutilizável por Vendas/Compras/PDV quando essas fases forem reconstruídas.
- Adicionados: `GET /produtos/:id`, `PATCH /produtos/:id/status` (ativar/inativar/arquivar — Seção 8), validação de SKU/código de barras únicos por empresa, `estoqueMaximo >= estoqueMinimo`, paginação (`take`/`skip`) em `GET /produtos` e `GET /estoque/movimentacoes`, filtro por filial em `GET /estoque` e `GET /estoque/movimentacoes`.
- Adicionados indicadores que faltavam na Seção 9: produtos próximos da validade, produtos parados, giro (aproximado — ver `DEBITO-TECNICO.md` item 8 para a limitação explícita desse cálculo).
- `POST /categorias` passou a validar entrada com Zod e registrar auditoria (antes não validava nada).
- Corrigidas 2 páginas de frontend (`produtos`, `estoque`, `vendas`) que quebrariam com o novo formato de resposta paginado/com custo condicional — patch mínimo, não reconstrução dessas páginas.

### Preservado sem alteração

`compras.routes.ts` e `vendas.routes.ts` só receberam o patch mecânico de compatibilidade do `filialId` — a lógica de negócio deles não foi revisada nesta fase (fica para a Fase 3).



- `package.json` backend/frontend: **OK, JSON válido**.
- Checagem leve de delimitadores em `.ts`/`.tsx`: **OK**.
- Busca de arquitetura Express/PG legada dentro de `backend/src`: **nenhuma referência encontrada**.
- Busca de `reply` usado sem parâmetro nas rotas revisadas: **corrigido**.
- `npm install` real: **não concluído neste ambiente**. A tentativa excedeu o limite de execução; a tentativa offline também não pôde ser concluída porque o cache não contém todos os pacotes.
- `prisma generate`: **não executado com dependências instaladas**.
- `backend npm run build`: **não executado com dependências instaladas**.
- `frontend npm run build`: **não executado com dependências instaladas**.

### Fase fundação: o que foi possível checar sem `npm install`

Este ambiente tem `tsc` global (TypeScript 6.0.3, instalado fora do
projeto), mas **não tem rede** para instalar as dependências do projeto
(`fastify`, `@prisma/client`, `zod` etc.) nem um Postgres para gerar/aplicar
migrations. Isso permite apenas uma checagem sintática parcial — não um
build real:

```bash
cd backend
mv tsconfig.json /tmp/tsconfig.json.bak   # tsc rejeita --flags + tsconfig juntos
tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck \
  $(find src -name "*.ts")
mv /tmp/tsconfig.json.bak tsconfig.json
```

Resultado: **nenhum erro real além dos esperados** `TS2307` ("Cannot find
module") para os pacotes não instalados, e `TS2591` ("Cannot find name
'process'/'Buffer'") pela ausência de `@types/node` sem `npm install` —
essas duas classes de erro são artefato deste ambiente, não bugs do código.

O único erro real encontrado por essa checagem (antes da correção) foi o
`FastifyInstance` sem import em `middlewares/auth.ts`, já corrigido. Os
arquivos tocados nesta fase (`server.ts`, `lib/*.ts`, `middlewares/auth.ts`,
`types/fastify.d.ts`, `modules/auth/*`, `modules/empresa/*`,
`modules/usuarios/*`, `modules/auditoria/*`) ficaram com **zero** erros
além dos dois artefatos acima. Os módulos ainda não revisados nesta fase
(produtos, estoque, compras, vendas, pdv, gestão, rh, ia, importação,
assinatura) continuam com parâmetros de callback sem tipo explícito
(`TS7006` sob checagem estrita) — isso é esperado, está listado em
`DEBITO-TECNICO.md` item 1, e **não quebra o build real** porque
`noImplicitAny` foi mantido `false` no `tsconfig.json` até cada um desses
módulos ser reconstruído em sua fase.

Isso **não substitui** um `tsc --noEmit` real com as dependências e o
Prisma Client gerados — só ele valida de fato os tipos que vêm do Prisma,
do Fastify e do Zod (ex.: se `Prisma.InputJsonValue` aceita os objetos
passados por `registrarAuditoria` — ver `DEBITO-TECNICO.md` item 2).

## Fase: Compras → Fornecedores → Clientes (+ 2 decisões arquiteturais pedidas antes da fase)

### Decisão 1 — Compra.filialId

`Compra` ganhou `filialId` obrigatório, definido na criação. `POST /compras/:id/receber` não aceita mais `filialId` no corpo — usa sempre `compra.filialId`. Motivo completo no comentário acima do model `Compra` em `schema.prisma` e no relatório da fase enviado ao usuário.

### Decisão 2 — giro real via snapshot diário

Nova tabela `EstoqueSnapshotDiario` + `estoque-indicadores.service.ts` (`gerarSnapshotDoDia`, `calcularGiroPorProduto`) + `POST /estoque/snapshot/gerar` + `npm run estoque:snapshot`. Giro passa a usar estoque médio real quando há histórico suficiente; cai para aproximação só por produto e só enquanto o histórico daquele produto for curto, sempre marcado `aproximado`. **Nada dispara o snapshot sozinho** — precisa de um cron externo apontando para o script ou o endpoint (`DEBITO-TECNICO.md` item 8).

### Correções e construções desta fase

- `compras.routes.ts`: reescrito por completo. Fornecedores e Clientes ganharam CRUD real (antes só tinham GET/POST rudimentares): `PUT`, `PATCH .../status` (ativar/inativar/arquivar), validação de CNPJ/CPF/documento único por empresa, histórico de compras/vendas no `GET .../:id`.
- Compras ganhou: `GET /compras`, `GET /compras/:id`, `PUT /compras/:id` (só enquanto SOLICITADA), `POST /compras/:id/confirmar` (SOLICITADA→PEDIDO — não existia nenhuma transição para PEDIDO antes), `POST /compras/:id/cancelar` (não existia nenhuma forma de cancelar uma compra antes, apesar do enum já ter o status CANCELADA).
- Recebimento de compra (`POST /compras/:id/receber`) passou a usar `estoque.service.ts` (`aplicarMovimento`) em vez de lógica de estoque inline duplicada.
- `vendas.routes.ts`: os dois pontos que mexem em estoque (criação e cancelamento de venda) foram migrados para `estoque.service.ts` — eliminada a duplicação da lógica de concorrência entre Vendas e Estoque/Compras. O resto do arquivo não foi tocado (`DEBITO-TECNICO.md` item 5).
- Extraído `lib/format.ts` (`clean()`) — estava duplicado inline em `auth.routes.ts`, agora reutilizado por Fornecedores/Clientes também.
- Corrigidos, nos arquivos tocados nesta fase, todos os parâmetros de callback sem tipo (`TS7006`) encontrados pela checagem estática — `compras.routes.ts` é o primeiro módulo de negócio sem nenhum débito de tipagem implícita.

### Checagem estática desta fase

Mesmo comando das fases anteriores (`tsc --noEmit` sem node_modules, filtrando `TS2307`/artefatos de `@types/node`), rodado depois de cada bloco de mudanças. Resultado: zero erros reais em todo o backend, incluindo os arquivos de Vendas/Empresa tocados só parcialmente nesta fase.



```bash
cd backend
npm install
npm run prisma:generate
npx prisma validate
npx tsc --noEmit
npm run db:migrate
npm run build

cd ../frontend
npm install
npm run build
```

O build só deve ser considerado aprovado depois que esses comandos terminarem sem erro no ambiente que possui as dependências e um `DATABASE_URL` válido para aplicar as migrations. Antes do `db:migrate`, rode também o `prisma migrate diff` descrito em `DEBITO-TECNICO.md` item 3 (e a mesma checagem para as migrações `202609121000_estoque_filial_produtos` e `202609121600_compra_filial_e_snapshot_estoque`) para confirmar as migrações escritas à mão.

Depois do deploy, configure um cron externo (systemd timer, cron do provedor, GitHub Action agendado, etc.) chamando `npm run estoque:snapshot` ou `POST /estoque/snapshot/gerar` uma vez por dia — sem isso, o giro de estoque nunca sai do fallback aproximado (`DEBITO-TECNICO.md` item 8).

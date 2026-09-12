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

## 4. Recuperação de senha — endpoint pronto, entrega ao usuário não

`/auth/recuperar-senha` gera e persiste um token com hash (SHA-256) e
validade de 1h. `/auth/redefinir-senha` consome esse token. Não existe
provedor de e-mail integrado — o token nunca chega ao usuário fora deste
banco de dados. Isso não é um bug a esconder: é uma integração pendente
(depende de credenciais de um provedor de e-mail real, que ninguém
forneceu ainda).

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

**O que ainda falta, e é a dívida real que sobra**: nada dispara o
snapshot sozinho. Este projeto não tem scheduler embutido. Sem um cron
externo (do provedor de hospedagem, um systemd timer, um GitHub Action
agendado, etc.) chamando o script ou o endpoint uma vez por dia, o
histórico de snapshots nunca cresce e o giro fica preso no fallback
aproximado para sempre — exatamente o cenário que essa fase queria evitar
como estado permanente. **Você precisa configurar esse cron no ambiente
de produção**; isto não é algo que eu possa fazer de dentro do código.

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

## 11. Fluxo de status de Compra: falta transição automática/alertas

`POST /compras/:id/confirmar` (SOLICITADA→PEDIDO) e
`POST /compras/:id/cancelar` foram implementados nesta fase, mas nada
dispara `confirmar` automaticamente nem avisa quando uma compra fica muito
tempo em SOLICITADA/PEDIDO sem confirmação/recebimento. Isso é papel do
Motor de Automação (Seção 29), que ainda não foi construído.

## 12. `Compra`/`CompraItem` não guardam origem de preço por lote (FIFO)

Igual à Fase 2: o custo do produto é sobrescrito pelo último valor pago no
recebimento (`produto.custo = item.valorUnit`), não uma média ponderada
nem FIFO por lote. Mesma decisão de escopo já documentada na Fase 2 —
registrando aqui de novo porque é exatamente onde esse comportamento é
acionado.

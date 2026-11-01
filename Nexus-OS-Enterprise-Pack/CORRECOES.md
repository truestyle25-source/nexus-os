# Correções aplicadas ao Enterprise Pack

Este documento lista o que mudou em relação ao pacote original e o que ainda NÃO foi verificado.

## O que foi corrigido

1. **Permissões por módulo e ação.** Antes, qualquer usuário da empresa podia ler, criar, aprovar e excluir em qualquer módulo. Agora cada rota confere `modulo:acao` na tabela `Permissao`, lida uma vez por requisição. Ausência de linha = negado.
2. **Medicina do trabalho.** Sem permissão `medicina_trabalho:visualizar`, o módulo some da listagem e da busca, e acessar um registro dele retorna 403. O campo `observacaoRestrita` só aparece para quem tem `medicina_trabalho:administrar`.
3. **Brecha do fiscal fechada.** Status como "autorizada" ou "transmitida" são recusados tanto no campo `status` quanto no campo `situacao`. Antes, só `situacao` era verificado.
4. **Status de sistema protegidos.** `aprovado`, `rejeitado`, `aguardando_aprovacao` e `arquivado` não podem mais ser definidos por PATCH ou POST. Só o fluxo de envio, aprovação e exclusão os define.
5. **Segregação de funções.** Quem solicitou um registro não pode aprovar nem rejeitar a própria solicitação (retorna 403).
6. **Registros em aprovação não podem ser editados** (retorna 409).
7. **Datas validadas.** Campos de data precisam ser datas reais (AAAA-MM-DD). Contratos exigem fim posterior ao início.
8. **Campos desconhecidos recusados.** Cada módulo aceita só os campos que declara.
9. **Listagens filtradas por permissão.** Resumo, aprovações pendentes e totais contam só o que o usuário pode ver. O resumo financeiro só aparece para quem tem `financeiro:visualizar`.
10. **Busca ampliada.** Procura também em campos como fornecedor/cliente, vaga, cargo e nome, não só em `descricao`.
11. **Não autenticado não passa.** Sem empresa ou usuário identificados, a resposta é 401.

## Integração obrigatória antes de usar

- Adicionar no catálogo de permissões do Nexus (`lib/permissoes-catalogo.ts`) os módulos `financeiro`, `contabilidade`, `fiscal`, `patrimonio`, `compras`, `producao`, `contratos`, `servicos`, `orcamentos`, `recrutamento`, `medicina_trabalho`, `cargos_salarios`, `aprovacoes` e `relatorios`, com as ações `visualizar`, `criar`, `editar`, `excluir`, `aprovar` e `administrar`.
- Registrar as rotas com autenticação. Exemplo: `app.register(enterprisePackRoutes, { prefix: "/api/enterprise" })` dentro de um contexto que aplica `app.authenticate` a todas as rotas.
- Confirmar que `req.user` contém `id` e `empresaId` no formato usado pelo Nexus.
- Adicionar as chaves estrangeiras para `Empresa` no `schema.prisma` (ainda pendente, ver `schema.additions.prisma`).
- Rodar `npx prisma generate` antes de compilar. Os erros de tipo restantes dependem disso.

## O que NÃO foi verificado

- Não foi executado. Não houve instalação de dependências, geração do cliente do banco, migração nem chamadas reais.
- A checagem de sintaxe com o compilador TypeScript passou (zero erros de sintaxe). Os erros de módulo ausente são esperados sem as dependências.
- Não há testes automatizados. A lista em `enterprise-pack.test-notes.md` continua sendo uma verificação manual.

## O que continua faltando para ser equivalente a um sistema de gestão completo

- Regras de negócio por módulo: baixa de contas, conciliação bancária, fluxo de caixa, plano de contas com partidas dobradas, depreciação, apuração de consumo de produção, renovação de contratos, previsto x realizado.
- Integração entre módulos: uma compra aprovada deve gerar conta a pagar e entrada no estoque; uma venda deve gerar receita.
- Emissão fiscal real: depende de provedor ou de comunicação com o órgão fiscal, certificado digital e homologação.
- Telas de formulário próprias, no lugar do editor de texto em formato de dados.

## Revisão 2 (o que foi corrigido após a análise do pacote unificado)

1. **Autenticação de verdade nas rotas.** Antes, o pacote não usava o login do sistema: sem ele, todas as chamadas davam 401. Agora as rotas aplicam o decorador `authenticate` do Nexus OS.
2. **Tela envia o token como o restante do sistema.** Antes, a tela não mandava o cabeçalho `Authorization`. Agora lê `nexus_token` do navegador e envia como Bearer, igual ao `lib/api.ts` do sistema.
3. **CNPJ validado de verdade.** Antes, bastava ter 14 dígitos. Agora os dois dígitos verificadores são calculados (ver pasta `dominio`).

Limite desta revisão: os erros de tipo que sobram no TypeScript vêm da falta das dependências (Fastify, Zod, cliente do banco). Eles devem desaparecer com `npm install` e `npx prisma generate`. Nada disso foi executado contra o banco.

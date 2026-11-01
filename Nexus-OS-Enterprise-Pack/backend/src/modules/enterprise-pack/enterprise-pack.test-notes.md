# Checklist de homologação manual

- [ ] Usuário sem empresa no contexto recebe 401.
- [ ] Usuário da empresa A não consegue consultar/editar registros da empresa B.
- [ ] Criar registro em cada um dos 14 módulos.
- [ ] Campos obrigatórios e validações numéricas retornam 400.
- [ ] Busca, filtro de status e paginação funcionam.
- [ ] Enviar para aprovação cria uma aprovação pendente.
- [ ] Aprovar/rejeitar muda status e grava decisão.
- [ ] Arquivar usa soft delete e não remove fisicamente o histórico.
- [ ] Ações relevantes criam auditoria.
- [ ] O resumo financeiro soma apenas valores em aberto.
- [ ] Dados do módulo medicina_trabalho só são acessíveis por perfis autorizados (implementar autorização RBAC do Nexus antes de produção).
- [ ] Fiscal não indica autorização SEFAZ sem resposta real do provedor.
- [ ] Rodar testes automatizados e verificação TypeScript com o ambiente real do Nexus.

## Itens adicionados nesta correção
- [ ] Usuário sem permissão `<modulo>:visualizar` não vê o módulo na listagem nem consegue abrir registros dele (403).
- [ ] Usuário sem `medicina_trabalho:administrar` não recebe `observacaoRestrita` em nenhuma resposta.
- [ ] POST ou PATCH com `status: "aprovado"`, `"aguardando_aprovacao"` ou `"arquivado"` retorna 400.
- [ ] POST ou PATCH com `situacao: "autorizada"` ou `status: "autorizada"` em fiscal retorna 400.
- [ ] Quem enviou uma solicitação recebe 403 ao tentar aprová-la ou rejeitá-la.
- [ ] Data inválida (ex.: 2026-13-45) retorna 400.
- [ ] Contrato com fim anterior ao início retorna 400.
- [ ] Campo não reconhecido retorna 400.
- [ ] Registro em `aguardando_aprovacao` retorna 409 ao tentar editar.

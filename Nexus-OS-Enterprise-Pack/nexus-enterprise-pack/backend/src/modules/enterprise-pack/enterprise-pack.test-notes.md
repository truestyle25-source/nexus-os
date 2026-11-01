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

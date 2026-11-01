# Integration Core e piloto Shopee

## Estado implementado

- Contratos tipados e registro estático de capacidades em `backend/src/modules/integracoes/core/`.
- Assinatura HMAC-SHA256 para chamadas públicas e de loja, com construção de autorização e cliente HTTP em `backend/src/modules/integracoes/shopee/`.
- OAuth com `state` aleatório, hash persistido, validade curta, uso único e vínculo à empresa e ao usuário iniciadores.
- Tokens de acesso e renovação cifrados pelo serviço de segredos já usado pelo NEXUS. Renovação serializada por lease no banco.
- Validação da identidade da loja após o OAuth, testes reais de conexão quando houver credenciais e isolamento pelo `empresaId` da sessão autenticada.
- Consulta paginada de pedidos e catálogo. A sincronização automática consulta mudanças de pedidos a cada cinco minutos, persiste apenas identificador, status e datas e retoma grandes lotes pelo cursor persistido.
- Agendador independente da integração Mercado Livre, com lease para múltiplas instâncias, espera progressiva e marcação de reautorização para falhas 401/403.
- Desconexão local auditada. A API não afirma revogar tokens no lado Shopee.
- Interface da Central mantém a estrutura existente e apresenta ações específicas da Shopee.

## Limites funcionais atuais

O sincronizador monitora e reconcilia **status externo de pedidos**. Não converte pedidos em `Venda` NEXUS, não baixa estoque, não atualiza anúncios e não processa pagamento. A consulta de produtos é leitura paginada; não existe ainda associação de `item_id/model_id` Shopee com o catálogo interno. Webhooks não foram ativados. Essas operações dependem de mapeamento e regras de negócio próprios, além das permissões confirmadas para o aplicativo.

O endpoint de detalhes de pedidos expõe informações opcionais, mas o fluxo automático deliberadamente não persiste payload bruto, dados pessoais, itens nem valores financeiros.

## Configuração necessária

O exemplo de ambiente lista `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URI`, bases opcionais e `SHOPEE_SYNC_AUTO`. Configure os valores no ambiente privado do backend, nunca no frontend ou em commits. `JWT_SECRET` também precisa atender ao requisito do backend de 32 caracteres para cifrar tokens.

O callback registrado no Developer Console deve corresponder exatamente a `SHOPEE_REDIRECT_URI`. Em produção, o código exige HTTPS. As credenciais podem ser inseridas depois: sem elas, o botão de autorização permanece indisponível; nenhuma chamada à Shopee foi realizada nesta etapa.

## Persistência e implantação

A migration `backend/prisma/migrations/202610181200_shopee_connections/migration.sql` cria conexões multi-loja, estados OAuth e snapshots mínimos de pedidos, incluindo cursor e leases do sincronizador. O schema foi validado, mas a migration **não foi aplicada**: não havia um banco descartável disponível nesta execução. Aplicar primeiro em ambiente de desenvolvimento com backup/rollback operacional definido antes de habilitar o serviço.

## Pendências externas e homologação

- Confirmar no Developer Console categoria/tipo de aplicação, região, permissões aprovadas, URL de callback, limites e acesso de produção.
- Revisar os contratos/versões dos endpoints no console para as credenciais e região da conta. A documentação pública não esteve acessível diretamente ao agente; endpoints implementados não foram chamados em ambiente real.
- Depois de configurar credenciais, autorizar loja de teste, verificar `get_shop_info`, renovação de token, lista/detalhes de pedidos, paginação e tratamento de rate limit.
- Só depois definir e implementar importação como venda, mapeamento de produtos, operação segura de estoque e eventual recebimento de notificações.

## Validações

Os testes unitários HTTP/assinatura não dependem de banco ou credenciais reais. A migration, o worker contra PostgreSQL real e a homologação com Shopee continuam pendentes. Nenhuma execução deve ser descrita como chamada real à API enquanto não houver log/evidência de uma conta de teste.

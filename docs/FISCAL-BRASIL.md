# Fiscal Brasil — auditoria e continuação

Data da avaliação de provedores: 08/10/2026.

## Situação atual

**O módulo fiscal não está concluído e não emite documentos.** A única capacidade fiscal ativa é `GET /fiscal/status`, que apresenta diagnóstico cadastral informativo. Emissão, consulta de documentos fiscais, cancelamento e persistência de documentos permanecem desabilitados.

O produto atual é orientado à venda de mercadorias, então NF-e modelo 55 e NFC-e modelo 65 são candidatas iniciais. Não se pode tratar os dois modelos como um único fluxo: finalidade, destinatário, credenciamento e autorização diferem. PIX e boleto são cobranças, não documentos fiscais. NFS-e não faz parte do fluxo de venda de produtos auditado.
## Reconciliação de migrations — investigação adicional

### Escopo seguro e estado do Git

Revisei git status, branches e objetos alcançáveis. O working tree contém muitas alterações preexistentes de origem não identificável; preservei tudo. Nesta etapa editei somente este documento. Não executei db push, migrate deploy, migrate resolve, reset, DDL ou operações de escrita.

O único banco acessível aponta para localhost:5432/nexus_os, mas não há informação se é desenvolvimento, homologação ou produção. Fiz somente consultas ao catálogo PostgreSQL e ao ledger _prisma_migrations em transação READ ONLY. Não consultei dados de negócio, exportei registros nem tentei alcançar serviços externos. Outros ambientes não estão configurados.

### Importacao

A migration 202609130001_importacao cria a tabela, PK, FKs para Empresa e Usuario e índice Importacao_empresaId_createdAt_idx; o ledger local registra essa migration como concluída. O módulo backend/src/modules/importacao/importacao.routes.ts insere e consulta essa tabela com SQL bruto parametrizado, e as rotas estão registradas em backend/src/server.ts. Migrations posteriores 202609261100, 202609261200, 202609261400, 202609261500 e 202609261600 registram a decisão deliberada de preservar tabela e FKs, embora não haja model Prisma.

O catálogo atual mostra 13 colunas, PK e FKs para Empresa/Usuario, sem FK apontando para Importacao. Só o índice da PK aparece; o índice secundário documentado não existe. A causa não foi determinada. Não li quantidade nem conteúdo de linhas. O diff consultivo que propunha DROP TABLE Importacao foi descartado sem execução. A tabela é dependência ativa; não pode ser removida para alinhar o Prisma. Classificação: INVESTIGADO, MAS NÃO RESOLVIDO para a ausência do índice e a representação futura no Prisma.

### Checksums: retificação da comparação anterior

A auditoria anterior contou diferenças SHA-256 dos bytes Windows como diferenças de conteúdo. A comparação normalizada refinou esse resultado:

- 202609110001_integrity_security: checksum do banco 02edc94db4dd808ae4ceb4a37cc8e263c6d2025c0389d57eea2b41a0dce6ec26. O hash local bruto difere por finais CRLF; após normalizar CRLF para LF, o hash bate exatamente com o banco. Quatro cópias alcançáveis no Git também têm o hash e conteúdo exatos. Não há diferença SQL comprovada.
- 202609261400_rh_verbas_arquivamento: checksum do banco fa06249462d24fe1acc579f4271ea4ca19634a375475702a83b4b20f343727cb. O hash local permanece diferente após normalização. Não encontrei a versão original em históricos/objetos Git, refs, stash ou arquivos de backup do workspace. A versão aplicada não pode ser reconstruída com segurança; solicite-a ao workspace/backup que a aplicou.
- Não validei como a versão instalada do Prisma compara checksums sob CRLF/LF. Não alterei nenhum arquivo histórico.

### Migrations do banco configurado

O status reportou 34 migrations: 33 concluídas e uma pendente. Concluídas: 202609110001_integrity_security; 202609111200_fundacao_auth_empresa; 202609121000_estoque_filial_produtos; 202609121600_compra_filial_e_snapshot_estoque; 202609130001_importacao; 202609130002_fix_empresa_status_type; 202609131200_alerta_compra_pendente; 202609131300_api_publica_chaves; 202609201000_pdv_caixa; 202609240001_pix_universal; 202609240002_relatorio_gerado; 202609240003_fornecedores_v2; 202609261000_rh_desligamento; 202609261100_sync_schema_banco; 202609261200_sync_schema_banco_2; 202609261300_corrige_sync_schema; 202609261400_rh_verbas_arquivamento; 202609261500_documentos_bucket; 202609261600_rh_folha_pagamento; 202609270900_funcionario_beneficios; 202609271200_ponto_fuso_empresa; 202609271400_funcionario_horarios_previstos; 202609280900_radar_inteligencia; 202609281200_plano_desenvolvimento_disc; 202609290900_treinamentos_participantes; 202609291200_feedback_lideranca; 202609300900_loja_recompensas; 202609301000_pontuacao_configuravel; 202609301100_pontuacao_presente; 202609301200_sessao_inventario; 202609301300_venda_parcelas; 202610021000_produtos_metadata_promocao; 202610070900_pdv_pro_fase1_nucleo.

Pendente: 202610081000_backfill_venda_data_operacional.

Sete tentativas revertidas, embora cada migration depois tenha uma aplicação concluída: cinco de 202609261100_sync_schema_banco iniciadas em 2026-09-26 entre 13:26 e 13:31 UTC e revertidas às 13:32 UTC; uma de 202609301000_pontuacao_configuravel iniciada em 2026-09-29 20:57 UTC e revertida às 20:58 UTC; uma de 202609301100_pontuacao_presente iniciada em 2026-09-29 21:16 UTC e revertida às 21:17 UTC. Erros do ledger: coluna Funcionario.origem já existia; empresaId inexistente (duas tentativas); constraint Caixa_empresaId_fkey já existente (duas); coluna ativa inexistente; erro de sintaxe perto de //.

Banco vazio continua bloqueado: o teste isolado anterior falhou em P3018/42P01 porque a primeira migration usa VendaItem antes de sua criação; também requer tabelas anteriores como IntegracaoPonto. O ledger do único banco acessível não prova que outros ambientes executaram os mesmos bytes ou a mesma sequência.

### Ambientes

| Ambiente | Disponibilidade | Estado conhecido | Falta |
|---|---|---|---|
| localhost:5432/nexus_os | Metadados somente leitura | 33 aplicadas, 7 tentativas revertidas, backfill pendente; Importacao presente; checksum RH sem origem recuperada | Proprietário confirmar se é dev/homologação/produção e fornecer backup conhecido |
| PostgreSQL descartável de teste | Removido após uso anterior | Não é ambiente implantado | Nenhuma |
| Outros desenvolvedores, homologação e produção | Não configurados/acessíveis | Desconhecido | Lista de ambientes, versão/commit implantado e saída de migrate status/checksums obtidas sem expor credenciais |

### Estratégias comparadas (nenhuma executada)

| Estratégia | Benefício | Riscos/impacto | Pré-requisitos, testes e reversão |
|---|---|---|---|
| Baseline de instalação nova + cadeia legada preservada | Bootstrap reproduzível para instalações limpas | Baseline integral seguido de replay antigo duplica DDL; uma segunda linha exige manutenção paralela; não corrige bancos existentes | Congelar snapshot pré-primeira migration e ferramenta oficial, inventariar ambientes, testar instalação/upgrade em clones. Abandonar antes de deploy; após deploy, snapshot/restore ou correção aditiva, nunca reset |
| Recuperar migrations históricas originais | Mantém integridade do ledger | Primeira migration ainda falha em vazio; migration RH original não está disponível localmente | A primeira tem cópia Git equivalente após normalização; obter versão RH do executor/backup e comparar. Não usar sem confirmar |
| Criar migrations corretivas novas | Corrige diferenças a partir de estados legados comprovados sem reescrever histórico | Não resolve dependências que antecedem a primeira migration; pode divergir entre ambientes ou remover Importacao se gerada cegamente pelo Prisma | Resolver checksums, índice e modelo Importacao; testar por snapshot de cada ambiente. Reversão por migration compensatória ou restore verificado |
| Procedimento específico por ambiente | Preserva históricos distintos | Operação e recuperação mais complexas, risco de drift | Inventário e backup por ambiente; ensaiar restore e atualização em clones. Reversão conforme o snapshot/procedimento de cada ambiente |

**Recomendação: INVESTIGADO, MAS NÃO RESOLVIDO.** Não selecionar estratégia ainda. O proprietário precisa: identificar o ambiente local; obter o arquivo original 202609261400_rh_verbas_arquivamento; fornecer inventário de outros ambientes; confirmar a decisão de Importacao e investigar o índice ausente. Depois, definir snapshot anterior à primeira migration e comparar baseline único versus caminhos separados. Testar instalação, upgrade, Prisma e recuperação somente em PostgreSQL descartável/clones. Nenhuma alteração em banco existente nesta fase.

### Próximos passos

1. Obter a lista e classificação dos ambientes e seus migration names/checksums/versão implantada.
2. Recuperar do executor ou backup a migration RH aplicada e confirmar o checksum completo.
3. Confirmar com o responsável pela Importação a manutenção da tabela e investigar o índice secundário ausente.
4. Projetar a cadeia inicial para incluir as tabelas exigidas pela primeira migration, sem replay duplicado de histórico.
5. Após aprovação, testar do zero e upgrades em clones de cada estado conhecido, incluindo backup/restore e comparação do schema.
6. Só então propor alterações versionadas e solicitar autorização própria para qualquer operação de escrita em ambientes existentes.

Classificação desta etapa: metadados e referências de Importacao — INVESTIGADO, MAS NÃO RESOLVIDO quanto ao índice/modelo; checksum da primeira migration — INVESTIGADO, MAS NÃO RESOLVIDO até validar ferramenta Prisma; checksum RH e ambientes remotos — BLOQUEADO POR DEPENDÊNCIA; cadeia em banco vazio — BLOQUEADO POR DEPENDÊNCIA; migration 202610081000 — pendente no banco observado; correção de migrations — NÃO IMPLEMENTADO.

## Situação do Fiscal Brasil

O Fiscal Brasil permanece sem emissão, consulta/cancelamento ou persistência fiscal. Não alterei código fiscal, PDV, PIX ou RH nesta investigação.

## Fase 1 — infraestrutura validada

### Docker

- A chamada dentro do sandbox foi bloqueada pela leitura negada de `C:\Users\samue\.docker` e pelo acesso ao pipe do daemon.
- Uma consulta read-only com configuração Docker temporária vazia confirmou daemon Docker 29.8.0 ativo e imagem local `postgres:15`. O container existente `nexus_postgres` não foi usado nem modificado.
- Com acesso autorizado ao daemon, subi um container PostgreSQL 15 descartável, sem volume persistente, publicado somente em loopback e com credencial aleatória temporária. O container foi parado/removido ao final. Nenhuma conexão foi feita ao banco configurado pelo app.

### Node/tsx

- `node:os.userInfo()` falha diretamente neste host Windows/Node 24.19.0 com `uv_os_get_passwd returned ENOMEM`. A exceção ocorre ao consultar a identidade do usuário do sistema e é reproduzida fora do runner; portanto, a mensagem `ENOMEM` não foi tomada como prova de falta de RAM.
- Para rodar `tsx`, usei um preload CommonJS temporário via `NODE_OPTIONS` que substitui somente `os.userInfo()` para dar ao `tsx` um nome de diretório temporário. O preload foi apagado, não mudou permissões do Windows e não alterou o código testado.

### Migrations e Prisma

- `prisma validate`: passou.
- `prisma db push` contra banco isolado vazio: passou e sincronizou o schema Prisma atual. Isso validou o schema/client, mas **não valida a cadeia de migrations**.
- `prisma migrate deploy` contra banco isolado vazio: falhou com P3018 na migration `202609110001_integrity_security`, erro PostgreSQL `42P01`: relação `VendaItem` não existe.
- A migration inicial tenta alterar `VendaItem` e `IntegracaoPonto` antes da cadeia criar essas tabelas. A auditoria estática também não encontrou `CREATE TABLE "VendaItem"`, `"Produto"`, `"Empresa"` ou `"Usuario"` nas migrations atuais. A cadeia pressupõe tabelas preexistentes criadas por outro mecanismo.
- Não corrigi nem reordenei migrations antigas. Isso poderia divergir de bancos que já aplicaram arquivos/checksums. Não há inventário dos históricos `_prisma_migrations` de todos os ambientes, então uma estratégia de baseline compartilhada ainda não é segura.
- Próxima ação de banco: completar o inventário read-only dos ambientes remotos não acessíveis; o banco local configurado já foi inventariado nesta continuação. Depois aprovar um fluxo distinto e documentado para banco legado e instalação limpa. Não executar `migrate resolve`, reset ou baseline em produção sem esse inventário.

### Testes reais da rota

No container PostgreSQL descartável, apliquei o schema com `db push`, inseri fixtures temporárias e testei `GET /fiscal/status` via Fastify `inject`:

- sem JWT: HTTP 401;
- JWT sem `fiscal.visualizar`: HTTP 403;
- usuário associado a filial: retorno limitado à filial vinculada;
- usuário sem filial vinculada: retorno limitado às filiais da empresa;
- JWT com tenant forjado para outra empresa: HTTP 403;
- fixture autorizada: status retornado a partir das tabelas PostgreSQL reais;
- as fixtures foram removidas e o banco/container descartável foi removido.

O arquivo [fiscal-status.integration.test.ts](../backend/tests/fiscal-status.integration.test.ts) só executa contra loopback, porta explícita e banco `nexus_fiscal_status_test`, com flag adicional de isolamento. Não usa o `.env` normal como banco de teste.

Também testei o erro de banco em processo separado, apontando apenas para `127.0.0.1:1/fiscal_unavailable_test`: o Fastify respondeu HTTP 500 sem expor `ECONNREFUSED`, `DATABASE_URL` ou detalhes do Prisma. Ver [fiscal-status-db-error.integration.test.ts](../backend/tests/fiscal-status-db-error.integration.test.ts).

Resultado: autenticação, autorização, isolamento de tenant/filial e resposta segura a erro de banco **IMPLEMENTADOS E TESTADOS** neste endpoint. Isso não comprova persistência de documentos fiscais, pois ainda não há modelo fiscal.

## Fase 2 — comparação de provedores

### Focus NFe — candidata ativa

- A documentação afirma emissão de NF-e via API para todos os estados. A emissão NF-e usa `POST /v2/nfe` com `ref` única e, por padrão, é assíncrona (`201` síncrona ou `202` em processamento); o resultado pode ser acompanhado por `GET /v2/nfe/{referencia}` ou webhook. A consulta fornece status e caminhos de XML/DANFE. [Referência NF-e](https://doc.focusnfe.com.br/reference/nfe), [emissão NF-e](https://doc.focusnfe.com.br/reference/emitir_nfe), [consulta NF-e](https://doc.focusnfe.com.br/reference/consultar_nfe).
- A NFC-e tem API/documentação própria (`POST`, consulta e cancelamento em `/v2/nfce`); a emissão documentada é síncrona. A documentação do provedor indica janela de cancelamento de até 30 minutos para NFC-e. Para NF-e, indica normalmente até 24 horas, admitindo prazo maior em alguns estados. Estes prazos precisam ser confirmados para a UF e operação concretas, não codificados como regra nacional universal. [Emissão NFC-e](https://doc.focusnfe.com.br/reference/emitir_nfce), [consulta NFC-e](https://doc.focusnfe.com.br/reference/consultar_nfce), [cancelamento NFC-e](https://doc.focusnfe.com.br/reference/cancelar_nfce), [cancelamento NF-e](https://doc.focusnfe.com.br/reference/cancelar_nfe).
- Há webhook por POST para URL configurada; a documentação descreve retentativas em 1 min, 30 min, 1 h, 3 h e 24 h. O método de autenticação/assinatura do callback precisa ser esclarecido antes de aceitar eventos. [Webhooks](https://doc.focusnfe.com.br/reference/webhooks).
- A autenticação documentada é HTTP Basic usando token. Para empresa cadastrada, a API recebe cadastro fiscal, certificado e configuração por documento/ambiente. NFC-e de produção também exige CSC e ID do CSC gerados na SEFAZ da UF. [Cadastro de empresa](https://doc.focusnfe.com.br/reference/criar_empresa).
- O site informa que aceita certificado e-CNPJ/e-CPF A1, não A3. O credenciamento e o certificado ICP-Brasil permanecem obrigações do contribuinte/estabelecimento conforme a UF. A NFC-e exige verificar também CSC/ID e regras locais.
- Preços públicos consultados: Solo R$ 94,90/mês (1 CNPJ/100 documentos); Start R$ 119,90/mês (3 CNPJs/100 documentos por CNPJ); Growth R$ 572/mês (4.000 documentos); plano Retail NFC-e R$ 62,90/mês (500 NFC-e + 100 NF-e). Valores adicionais e condições estão sujeitos à página comercial vigente, volume e contrato; não são aprovação de compra. [Preços Focus](https://2025.focusnfe.com.br/precos/).
- A Focus documenta ambientes separados: homologação não tem validade fiscal; produção tem. [Ambientes](https://doc.focusnfe.com.br/reference/ambiente).

### TecnoSpeed PlugNotas — alternativa ativa

- A documentação oficial declara suporte a NF-e e NFC-e por API REST. O fluxo documentado retorna ID, consulta status (`AGENDADO`, `PROCESSANDO`, `CONCLUÍDO`, `REJEITADO`), disponibiliza XML/PDF após autorização e permite fluxo por consulta ou webhook. Cancelamento NFC-e é assíncrono e tem endpoint próprio para consultar o status. [Primeiros passos](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/23715383551767-Primeiros-Passos-com-o-PlugNotas), [operações NFC-e](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/24932236431255-Sobre-a-Nota-Fiscal-de-Consumidor-Primeiros-Passos-NFC-e), [operações NF-e](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/24725044940951-Sobre-a-Nota-Fiscal-de-Produto-Primeiros-Passos-NF-e).
- A documentação de onboarding informa sandbox, homologação e produção e exige certificado A1 para NF-e/NFC-e. A cotação depende de negociação; não encontrei tabela pública de preços comparável na documentação oficial consultada. Pedir proposta comercial e SLA por escrito. [Ambientes, cadastro e fluxo](https://atendimento.tecnospeed.com.br/hc/pt-br/articles/23715383551767-Primeiros-Passos-com-o-PlugNotas).
- O sandbox do fornecedor pode usar respostas simuladas; eventual validação nesse ambiente deve ser classificada como teste de contrato/sandbox, não como autorização fiscal real.

### Opções descartadas ou de maior operação própria

- Nuvem Fiscal anunciou oficialmente o desligamento do serviço em **31/07/2026**; não deve ser escolhida para nova integração operacional. [Comunicado de desativação](https://www.nuvemfiscal.com.br/termos-de-uso-politica-privacidade/).
- Integração direta SEFAZ/ACBrLib evita API fiscal gerenciada, mas transfere ao NEXUS manutenção de XML, assinatura, comunicação estadual, contingência, certificados e atualizações técnicas. A ACBrLib Node documenta emissão, consulta e cancelamento de NF-e, porém requer biblioteca nativa por sistema operacional. Não há análise de licenciamento, operação, suporte e distribuição concluída. [ACBrLib NFe Node](https://github.com/Projeto-ACBr-Oficial/ACBrLib-Nodejs/blob/main/acbrlib-nfe-node/README.md).
- Credenciamento não é uniforme para todos os estabelecimentos: deve ser verificado para cada IE/UF e modelo. O portal nacional mantém manuais e credenciamento; páginas estaduais indicam exigências específicas. Homologação não possui validade fiscal. [Portal NF-e](https://www.nfe.fazenda.gov.br/portal/), [FAQ de credenciamento e ambientes](https://hom.nfe.fazenda.gov.br/Portal/perguntasFrequentes.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=4figqHYhYho%3D).

**Decisão pendente do proprietário:** escolher entre obter proposta/conta de homologação da Focus ou da TecnoSpeed; ou aprovar a operação própria ACBr/SEFAZ. Comparar custo para número real de CNPJs e documentos, SLA, cobertura exata das UFs/modelos, política de armazenamento/retention e requisitos de certificado. Nenhuma credencial foi solicitada ou armazenada.

## Fase 3 — proposta técnica de persistência

Nenhum modelo ou migration fiscal foi criado. O schema existente não possui domínio fiscal e não permite construir payload válido:

- `Produto` tem NCM, mas não CFOP, CST/CSOSN, CEST nem regra tributária validada;
- `Empresa` e `Filial` não possuem regime tributário e endereço cadastral completo por estabelecimento;
- `Venda` tem empresa/filial, cliente, valores, itens/pagamentos, mas não guarda snapshot fiscal/impostos; `VendaItem` não tem relação Prisma com Produto;
- `Documento` guarda metadata de arquivos, mas está operacionalmente integrado ao RH, sem relação fiscal FK, filial ou autorização/download fiscal. O storage privado existente também não permite extensão `.xml` na allowlist atual.
- `Auditoria` existe e é genérica.

Modelo proposto após a decisão do provedor e correção do baseline:

1. `FiscalDocumento`: empresa, filial, tipo/modelo, ambiente, origem opcional em Venda, referência idempotente local, provedor e referência externa, status persistido, número/série/chave/protocolo/autorizadoEm e snapshot/hash fiscal minimizado. Restrições únicas por chave idempotente e referência externa; integridade cruzada empresa/filial/venda validada em transação e reforçada por constraints compostas quando compatível.
2. `FiscalEvento`: documento FK, ID/idempotency key do evento, tipo/status/protocolo/ocorridoEm e payload de resposta redigido sem segredos. Evento repetido não aplica transição duas vezes.
3. `FiscalArtefato`: metadados e hash de XML autorizado/XML de cancelamento/DANFE, associado ao documento. Conteúdo em bucket privado; rota autenticada e autorizada, sem URL pública. Avaliar reutilização das funções de objeto existentes, ampliando allowlist/testes para XML, mas não reutilizar o modelo RH `Documento` como relação fiscal sem mudança explícita de semântica.
4. Registrar operações administrativas/emissão/cancelamento na `Auditoria` já existente, sem gravar certificados, tokens ou XML integral no log.

Estado inicial a validar com o provedor: rascunho, aguardando envio, processando, autorizado, rejeitado, comunicação desconhecida, cancelamento solicitado, cancelado. Nunca inferir rejeição/autorização por timeout.

## Fase 4 — fluxo de emissão proposto

1. Autorizar usuário, empresa e filial no backend; consultar venda finalizada e seus itens do banco, sem aceitar empresaId/valores tributários do cliente.
2. Rejeitar antes do envio se cadastro fiscal, classificação, credenciamento ou ambiente estiverem incompletos; sem cálculo improvisado.
3. Em uma transação PostgreSQL, criar documento e chave de idempotência única vinculada à origem. Não tocar em estoque/financeiro durante autorização fiscal.
4. Enviar uma única vez usando referência estável do provedor. Persistir ID/referência antes de qualquer repetição. Timeout vira resultado desconhecido e provoca consulta pela referência, nunca reenvio cego.
5. Receber webhook autenticado ou consultar status. Deduplicar evento, validar tenant/documento e aplicar transições permitidas; guardar protocolo e metadados dos XMLs autorizados.
6. Cancelamento é operação fiscal separada, com justificativa e janela da UF/modelo; só marcar cancelado após confirmação do provedor/SEFAZ. Não cancelar venda, estornar financeiro ou repor estoque automaticamente sem fluxo comercial explícito.
7. Download do XML/DANFE só após autorização e checagem de empresa/filial/permissão; conteúdo em storage privado, com hash, retenção e auditoria.

Não foi codificado um adaptador abstrato ainda: contrato de callback, idempotência, estados, certificado e diferenças de emissão/cancelamento dependem do provedor escolhido.

## Implementações e classificação

| Item | Classificação | Situação |
|---|---|---|
| `GET /fiscal/status`, autenticação, permissão e escopo empresa/filial | IMPLEMENTADO E TESTADO | Testado com PostgreSQL 15 descartável, Fastify e tokens de teste. |
| Resposta segura quando PostgreSQL indisponível | IMPLEMENTADO E TESTADO | HTTP 500 sem detalhes internos no corpo. |
| Diagnóstico puro dos campos cadastrais | IMPLEMENTADO E TESTADO | Casos com campos ausentes e completos testados. |
| Build, TypeScript e Prisma schema | IMPLEMENTADO E TESTADO | Backend build/typecheck e `prisma validate` passaram nesta etapa. |
| Migrations em instalação limpa e banco configurado | BLOQUEADO POR DEPENDÊNCIA | Banco vazio falha na primeira migration; banco configurado tem divergências de checksum, migration local pendente e tabela que seria descartada pelo diff. Exige reconciliação e decisão de linha de migrations. |
| NF-e/NFC-e emissão/consulta/cancelamento | NÃO IMPLEMENTADO | Provedor, homologação, cadastro tributário e credenciamento pendentes. |
| Persistência de documentos/eventos/XML | NÃO IMPLEMENTADO | Contrato/provider pendente e migration base quebrada. Nenhum dado fiscal fictício foi inserido. |
| Ponta a ponta venda→autorização→XML | BLOQUEADO POR DEPENDÊNCIA | Não pode ser validado até provedor, cadastro fiscal e ambiente de homologação estarem disponíveis. |
| Interface/listagem de documentos fiscais | NÃO IMPLEMENTADO | Não existe consulta de documentos; modelo/endpoint fiscal ainda não foram criados. A tela atual mantém o estado informativo existente. |

## Arquivos desta continuação

- Atualizado: `docs/FISCAL-BRASIL.md`.
- Criado: `backend/tests/fiscal-status.integration.test.ts` (fixtures PostgreSQL descartáveis, com guardas explícitas).
- Criado: `backend/tests/fiscal-status-db-error.integration.test.ts` (somente loopback fechado explicitamente habilitado).
- Nenhum arquivo do frontend, schema Prisma, migration ou outro módulo foi alterado nesta continuação.

## Resultados desta execução

- Regressão final backend: `npm run build` passou; `npx tsc --noEmit` passou; `npx prisma validate` passou.
- O comando de testes sem workaround reproduziu `uv_os_get_passwd returned ENOMEM` em `tsx`; com preload temporário de `os.userInfo()` rodou sem alteração de permissões.
- Regressão local final: 2 testes unitários passaram; 2 testes PostgreSQL foram pulados porque as flags/URLs de banco descartável não foram configuradas nesta repetição. Essa última repetição, sozinha, não revalidou PostgreSQL.
- Execução PostgreSQL descartável anterior: 3 testes da rota/diagnóstico passaram (401, 403, escopo empresa/filial e status bloqueado); 1 teste de banco indisponível passou, HTTP 500 sem vazamento.
- `prisma migrate deploy` em banco limpo: falhou como descrito acima.
- `prisma db push` em banco descartável: passou; usado apenas para viabilizar teste de rota, não como substituto de migration.
- Nenhum browser E2E ou homologação fiscal foi executado.
- No banco configurado do app foram feitas somente consultas de metadados em transação `READ ONLY`; nenhum registro de negócio foi lido/escrito, e nenhum reset ou migration foi executado nele.

## Próximas dependências objetivas

1. Proprietário escolher Focus, TecnoSpeed ou aprovar operação própria e obter cotação, termos, acesso de homologação e especificação do webhook.
2. Contabilidade/empresa informar UFs, estabelecimentos/CNPJs/IEs, modelos de documento, regime tributário e classificação fiscal de produtos.
3. Engenharia mapear históricos e checksums das migrations em cada ambiente sem escrita; aprovar estratégia para instalações limpas sem reescrever migrations já aplicadas.
4. Definir armazenamento fiscal e chave de criptografia dedicada/rotacionável (o helper atual deriva de `JWT_SECRET` e não serve para segredo fiscal persistente).
5. Só então fechar schema/migration e implementar o adaptador; homologar cada modelo/UF antes de liberar emissão.








# Nexus OS — Enterprise Pack (módulos complementares)

Pacote de integração para o Nexus OS (backend Fastify + Prisma/PostgreSQL; frontend Next.js 14/React/TypeScript/Tailwind).

## O que inclui
- Financeiro: contas a pagar/receber, vencimentos, status e conciliação manual.
- Contabilidade: plano de contas e lançamentos contábeis básicos.
- Fiscal: cadastro/controle de documentos fiscais e status de transmissão; **não transmite NF-e à SEFAZ sozinho**.
- Ativo fixo e patrimônio.
- Compras: solicitações, cotações e fluxo de aprovação.
- Ordem de produção.
- Contratos.
- Ordens de serviço.
- Orçamentos e centros de custo.
- Recrutamento e seleção.
- Medicina do trabalho: controle restrito de exames/atestados.
- Cargos e faixas salariais.
- Aprovações genéricas.
- Relatórios salvos pelo usuário.
- Auditoria de alterações.
- Tela Next.js genérica para consultar/criar/editar registros dos módulos.

## Importante: integração e limites
Este é um **pacote de extensão**, não uma cópia completa do seu repositório. O conteúdo do repositório Nexus OS não estava anexado como fonte editável nesta conversa; por isso, os pontos de integração estão isolados e documentados. Antes de mesclar em produção, adapte o middleware de autenticação/empresa e valide nomes de imports/versões com o seu código real.

O modelo usa `NexusErpRecord` com dados JSON validados por módulo para permitir evoluir sem criar dezenas de tabelas imediatamente. É persistência real no PostgreSQL, com isolamento por empresa, paginação, trilha de auditoria e fluxo de aprovação. Não é um sistema contábil/fiscal certificado por si só.

### Fiscal brasileiro
Para emitir NF-e/NFC-e de verdade, é necessário integrar um provedor fiscal ou implementar comunicação SEFAZ, certificado digital A1/A3, assinatura, XML, regras tributárias, contingência, numeração, cancelamento e eventos conforme UF/modelo. O pacote registra documentos e estados, mas bloqueia a falsa impressão de que houve transmissão autorizada.

### Dados sensíveis de medicina do trabalho
Restringir esse módulo a perfis autorizados, aplicar política de retenção, logs de acesso e controles LGPD. Não armazene laudos clínicos completos sem uma avaliação jurídica/de segurança.

## Instalação
1. Faça backup do banco e do repositório.
2. Mescle `backend/prisma/schema.additions.prisma` no schema real (não substitua o schema existente).
3. Adicione os modelos ao `schema.prisma` e rode:
   ```bash
   npx prisma format
   npx prisma migrate dev --name nexus_enterprise_pack
   npx prisma generate
   ```
   Em produção, gere a migration em ambiente de desenvolvimento e aplique com `prisma migrate deploy`.
4. Copie `backend/src/modules/enterprise-pack/` para o backend e registre o plugin no bootstrap Fastify.
5. Ajuste `getCompanyId()` em `routes.ts` para usar o objeto de autenticação real do Nexus.
6. Copie `frontend/app/enterprise-pack/` para o frontend e ajuste `NEXT_PUBLIC_API_URL`.
7. Rode os testes e confira permissões multiempresa antes de publicar.

## Registro do plugin
Exemplo (ajuste ao bootstrap existente):
```ts
import enterprisePackRoutes from "./modules/enterprise-pack/routes";
await app.register(enterprisePackRoutes, { prefix: "/api/enterprise" });
```

## Endpoints
- `GET /api/enterprise/modules`
- `GET /api/enterprise/records?module=financeiro&search=&status=&page=1&pageSize=20`
- `POST /api/enterprise/records`
- `GET /api/enterprise/records/:id`
- `PATCH /api/enterprise/records/:id`
- `DELETE /api/enterprise/records/:id` (soft delete)
- `POST /api/enterprise/records/:id/submit`
- `POST /api/enterprise/records/:id/approve`
- `POST /api/enterprise/records/:id/reject`
- `GET /api/enterprise/approvals`
- `GET /api/enterprise/reports/summary`

## Formato de registro
```json
{
  "module": "financeiro",
  "title": "Conta de fornecedor",
  "status": "rascunho",
  "data": {
    "tipo": "pagar",
    "fornecedor": "Fornecedor Exemplo",
    "valor": 1250.5,
    "vencimento": "2026-11-10",
    "centroCusto": "Administrativo"
  }
}
```
Os campos específicos são validados no backend conforme o módulo. Veja `MODULES` em `routes.ts`.

# Nexus OS — Enterprise Pack (versão corrigida)

Pacote de extensão para o Nexus OS. Leia primeiro `CORRECOES.md`: ele lista o que foi corrigido, o que é obrigatório integrar e o que não foi verificado.

## Conteúdo
- `backend/src/modules/enterprise-pack/routes.ts`: rotas com controle de permissão, segregação de funções e validação de datas e status.
- `backend/src/modules/enterprise-pack/validation.ts`: regras compartilhadas (status permitidos, campos de data, situações fiscais proibidas).
- `backend/prisma/schema.additions.prisma` e `migration.sql`: tabelas do pacote. Adicionar as chaves para `Empresa` antes de aplicar.
- `frontend/app/enterprise-pack/page.tsx`: tela genérica de registros (ainda sem formulários próprios por módulo).

## Instalação resumida
1. Faça backup do banco e do repositório.
2. Mescle `schema.additions.prisma` no `schema.prisma` e rode `npx prisma format`, `npx prisma migrate dev --name nexus_enterprise_pack`, `npx prisma generate`.
3. Adicione os módulos e ações ao catálogo de permissões do Nexus (ver `CORRECOES.md`).
4. Copie as pastas para o projeto e registre o plugin com autenticação.
5. Confirme o formato de `req.user` no seu código e rode o checklist de `enterprise-pack.test-notes.md`.

## Endpoints
- `GET /api/enterprise/modules`
- `GET /api/enterprise/records`
- `POST /api/enterprise/records`
- `GET /api/enterprise/records/:id`
- `PATCH /api/enterprise/records/:id`
- `DELETE /api/enterprise/records/:id` (arquivamento)
- `POST /api/enterprise/records/:id/submit`
- `POST /api/enterprise/records/:id/approve`
- `POST /api/enterprise/records/:id/reject`
- `GET /api/enterprise/approvals`
- `GET /api/enterprise/reports/summary`

## Limites
Este pacote registra, valida e controla aprovações. Ele não emite documentos fiscais, não faz conciliação bancária, não calcula depreciação e não integra os módulos existentes do sistema. Esses pontos estão listados em `CORRECOES.md`.

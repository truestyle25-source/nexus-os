# NEXUS OS

Sistema de gestão empresarial multiempresa (SaaS): PDV, vendas, produtos, estoque, compras, fornecedores,
clientes, financeiro, fluxo de caixa, DRE, RH e ponto, metas, indicadores, relatórios, IA (Google Gemini) e
integrações (Mercado Livre, Shopee, PIX, API pública).

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| `backend/` | API Fastify 5 + Prisma 5 (PostgreSQL 17 no Supabase). Publicado no Render (Docker). |
| `frontend/` | Next.js 14 (App Router) + React 18. Publicado na Vercel (pasta raiz do projeto: `frontend`). |
| `docs/` | Documentação viva: segurança/RLS, deploy, drift do schema, integrações, débito técnico. |
| `docs/relatorios/` | Relatórios de auditoria e execução mais recentes. |
| `docs/historico/` | Relatórios e auditorias antigos, mantidos só como registro. |
| `dominio/` | Pacote isolado de regras de negócio puras (sem banco), com testes próprios. Ainda **não** ligado ao app. |
| `Nexus-OS-Enterprise-Pack/` | Módulos complementares entregues à parte. Ainda **não** integrados ao backend. |
| `.github/workflows/ci.yml` | CI: tipos, build, migrações, testes (como `postgres` e como `nexus_app` com RLS) e busca de segredos. |

## Backend (`backend/`)

- **Framework:** Fastify 5, TypeScript, Zod.
- **Banco:** Prisma 5.22, 85 modelos, 51 migrações em `prisma/migrations/`.
- **Multiempresa:** isolamento por RLS no Postgres (`prisma/seguranca/`), com o contexto da empresa enviado em cada
  transação (`src/lib/tenant-context.ts` e `src/lib/prisma.ts`). Em produção o backend conecta como `nexus_app`
  (sem BYPASSRLS). Ver `docs/SEGURANCA_RLS_RUNBOOK.md`.
- **Autenticação:** JWT (`@fastify/jwt`), revogação por `jti` e permissões por módulo e ação.
- **Módulos (`src/modules/`):** `api-publica`, `assinatura`, `auditoria`, `auth`, `compras`, `dashboard`, `empresa`,
  `estoque`, `fiscal`, `fornecedores`, `gestao`, `ia`, `importacao`, `integracoes`, `lgpd`, `payments`, `pdv`,
  `produtos`, `radar`, `relatorios`, `rh`, `tts`, `usuarios`, `vendas`.

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor com recarga automática (`http://localhost:3333`) |
| `npm run build` / `npm start` | Compila para `dist/` e inicia |
| `npm test` | Testes (`tsx --test`); exigem o banco local `localhost:5432/nexus_os_test` |
| `npm run db:migrate` | `prisma migrate deploy` (use a `DIRECT_URL`, do dono das tabelas) |
| `npm run estoque:snapshot` | Snapshot diário de estoque manual |
| `npm run backup` / `npm run backup:restaurar` | Backup e restauração com `pg_dump`/`pg_restore` |

## Frontend (`frontend/`)

- **Framework:** Next.js 14.2 (App Router), React 18, TypeScript, Tailwind CSS 3.4.
- **Gráficos:** Chart.js 4 e Recharts 2. **Ícones:** lucide-react.
- **PDV offline:** fila e persistência em IndexedDB com Dexie 4.
- **API:** cliente próprio em `lib/api.ts` (`fetch`), apontando para `NEXT_PUBLIC_API_URL`.

| Script | O que faz |
|---|---|
| `npm run dev` | `http://localhost:3000` |
| `npm run build` / `npm start` | Build e servidor de produção |
| `npm test` | Testes unitários (`tsx --test`) |
| `npx playwright test` | Testes de navegador (`tests/e2e/`); exigem `NEXUS_AUDIT_EMAIL` e `NEXUS_AUDIT_PASSWORD` de uma conta **exclusiva de teste** |

## Como rodar localmente

```bash
# Banco local para desenvolvimento e testes (Postgres em Docker)
cd backend
docker compose up -d

# Backend
cp .env.example .env        # preencha DATABASE_URL, JWT_SECRET e o que for usar
npm install
npx prisma migrate deploy
npm run dev

# Frontend (outro terminal)
cd ../frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:3333
npm install
npm run dev
```

## Produção

Variáveis, passos de publicação e cuidados de segurança: `README-PRODUCAO.md`, `docs/DEPLOY_SEGURANCA_PRODUCAO.md`
e `docs/RELATORIO_CONFIGURACAO_INFRAESTRUTURA.md`. Nunca versione `.env` com valores reais.

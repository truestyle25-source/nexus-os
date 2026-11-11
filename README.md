# NEXUS OS - Technical Documentation

## Overview

**NEXUS OS** is a comprehensive business management platform designed for medium to large enterprises needing integrated operations across sales, inventory, financials, HR, and supply chain. The system is built on a modern full-stack architecture with a Fastify backend and a Next.js 14 frontend.

This is **not** a generic CRUD application. It is a mission-critical business system with:

- **85 Prisma models** covering every business domain
- **38 route modules** in the backend
- **PWA capabilities** with offline data persistence via IndexedDB
- **Complex HR & payroll modules** with scoring, rewards, and attendance tracking
- **External integrations** (Shopee, Mercado Livre, PDV, PIX, APIs)
- **Financial reporting** (DRE, indicators, daily tickets)

## Architecture

### Backend (`backend/`)

**Framework:** Fastify (Node.js) with Prisma ORM  
**Database:** PostgreSQL  
**Authentication:** JWT @fastify/jwt with cookie-based session management  
**Structure:** Modular route system under `backend/src/modules/` and `backend/src/auth/`

**Key Modules:**

| Module | Description |
|--------|-------------|
| `auth` | JWT authentication, cookie sessions, password recovery |
| `usuarios` | User management, profiles, permissions |
| `empresa` | Company config, filiais (branches), responsible persons |
| `produtos` | Product catalog, kits (production formulas), conversion factors |
| `estoque` | Stock tracking, inventory movements, loss/avaria control |
| `compras` | Purchase orders, suppliers, receipt workflow |
| `vendas` | Sales orders, customer management, invoice generation |
| `pdv` | Point-of-Sale integration, PDV connections, sync status |
| `rh` | **Extensive HR module** with 6 sub-cycles:
| | - `plano-desenvolvimento` - Employee development plans
| | - `treinamentos` - Training courses and participants
| | - `lideranca` - Empathetic leadership & feedback
| | - `gestao-tempo` - Point reading (NOT time recording)
| | - `loja` - Rewards shop (points calculated, never written)
| | - `inventario` - Inventory counts, frozen system snapshot
| | - `pontuacao` - Configurable scoring criteria per company
| | - `folha` - Payroll, separate from RH prefix
| `ia` | AI integration module |
| `importacao` | CSV/API data import with error tracking |
| `assinatura` | Subscription management |
| `integracoes` | Shopee, Mercado Livre external connections |
| `pix` | PIX payments instant settlement |
| `lgpd` | LGPD compliance, data protection |
| `api-publica` | Public API endpoints |
| `relatorios` | Business reports and analytics |
| `fornecedores` | Supplier management |
| `fiscal` | Fiscal/tax module |
| `radar` | Organizational radar — single `/radar/resumo` feeds the dashboard |

**Critical Conventions:**

## Frontend (`frontend/`)

**Framework:** Next.js 14 (App Router) with React 18  
**Language:** TypeScript  
**Styling:** Tailwind CSS 3.4  
**State:** Zustand  
**DB (PWA):** Dexie.js (IndexedDB) for offline-first experience  
**Charts:** Chart.js 4 + Recharts 2  
**HTTP:** Axios  
**Forms:** Zod validation

**Key Features:**

- **Theme system** with persistent localStorage preference (theme, density, primary color) — injected via blocking `<script>` in `<head>` to avoid FOUC
- **Language preference** (pt-BR/en-US/es-ES) stored in localStorage, set on `<html lang>`
- **PWA-ready** with `manifest.json`, icons, and offline cache strategy
- **DataTable**, **KpiCard**, **LineChart**, **BarChart**, **PieChart** components
- **EmptyState** UX for when no data exists
- **Modular components** under `components/ui/`, `components/relatorios/`, `components/rh/`, `components/formulas.ts`

**Build Scripts:**

| Script | Description |
|--------|-------------|
| `dev` | `next dev -p 3000` — development with hot reload |
| `build` | `next build` — production build |
| `start` | `next start` — production server |
| `test` | `tsx --test tests/*.test.ts` — Vitest-based tests

## What Works (as of Code Analysis)

✅ **Core CRUD operations** for Empresa, Usuario, Produto, Estoque, Filial  
✅ **Authentication flow** with JWT + cookies  
✅ **Prisma schema** fully defined with 85 models  
✅ **Fastify server** starts with valid JWT_SECRET  
✅ **Health endpoint** `/health`  
✅ **Next.js frontend** renders without errors  
✅ **Theme system** with localStorage persistence  
✅ **DataTable** and **KPI card** components functional  
✅ **Chart.js/Recharts** integration for dashboards  
✅ **API pública** module registered and ready  
✅ **PIX payments** module structure in place  
✅ **Shopee/Mercado Livre** integration frameworks  
## Known Gaps / Incomplete

⚠️ **Full business logic not yet implemented** — many routes exist but delegate to services that may have stub logic  
⚠️ **Payroll (`folha`)** module structure exists but salary calculation logic needs validation  
⚠️ **Gestão de tempo** reads ponto but does NOT write jornada (as noted in `server.ts:28-29` comments)  
⚠️ **Loja de recompensas** — points are calculated but never persisted (deliberate design per `loja.routes.js` comments)  
⚠️ **Inventario** — system snapshot freezes counts at session open; no real-time sync detailed  
⚠️ **AI module** (`ia`) — scaffolded but actual LLM integration not visible in code  
⚠️ **External API syncs** (Shopee, Mercado Livre) — routes registered but webhook/credential handling needs review  
⚠️ **Dexie PWA offline** — IndexedDB schema exists but full CRUD offline support needs testing  
⚠️ **Migration synchronization** — `schema.prisma` has 200+ models; ensure all migrations are up to date (`prisma migrate diff` recommended)  
⚠️ **TypeScript strictness** — some `.tsx` files in frontend may have `any` types or incomplete typings

## Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Backend** | Node.js + Fastify | 20.x, 4.x |
| **ORM** | Prisma Client | 5.x |
| **Database** | PostgreSQL | 15+ |
| **Authentication** | @fastify/jwt, cookies | — |
| **Frontend** | Next.js 14 | 14.2.5 |
| **UI** | React 18, TypeScript | 18.3.1, 5.5.4 |
| **Styling** | Tailwind CSS | 3.4.10 |
| **State** | Zustand | 4.5.4 |
| **DB (PWA)** | Dexie.js | 6.4.6 (implied) |
| **Charts** | Chart.js, Recharts | 4.5.1, 2.15.4 |
| **HTTP** | Axios | 1.7.2 |
| **Validation** | Zod | 3.23.8 |
| **Deploy** | Vercel (configured) | — |
| **Testing** | Vitest, TSX | — |

## Quick Start (Minimal)

```bash
# 1. Clone & install
git clone <repo>
cd nexus-os
npm install  # installs root deps
cd backend && npm install
cd frontend && npm install

# 2. Configure environment
cp .env.example .env  # edit DATABASE_URL and JWT_SECRET

# 3. Database
cd backend
npx prisma migrate deploy  # creates all tables
npx prisma generate

# 4. Start backend
npm run dev  # http://localhost:3333

# 5. Start frontend
cd ../frontend
npm run dev  # http://localhost:3000
```

Access the full platform at `http://localhost:3000` with the backend API at `http://localhost:3333`.
# NEXUS OS — Fase 1 Corrigida: Fundação

Plataforma de gestão empresarial multi-tenant. Este pacote contém a **Fase 1**
do desenvolvimento por fases definido no projeto: arquitetura, banco de dados,
backend, frontend, autenticação, usuários, permissões granulares e auditoria.

---

## ⚠️ Leia isto primeiro — estado de validação

Esta versão contém as correções solicitadas para a Fase 1. O código foi
revisado estaticamente e o diagnóstico do editor não apresenta erros em
`backend/src` e `backend/tests`.

Validação executável do backend nesta versão:

```text
typecheck: aprovado (npm.cmd run typecheck)
tests: 39
pass: 39
fail: 0 (npm.cmd test)
```

A validação com PostgreSQL real e a validação completa do frontend ainda
dependem do ambiente de execução, das dependências instaladas e da internet.

Isso segue exatamente a regra que você definiu: **nunca fingir que algo foi
testado quando não foi.**

---

## Estrutura do projeto

```
NEXUS_OS_FASE_1/
├── backend/                  # API Node.js + TypeScript + Express + PostgreSQL
│   ├── src/
│   │   ├── auth/              # hash de senha (scrypt) e JWT — só node:crypto
│   │   ├── domain/             # tipos, regras de permissão, validação de CNPJ
│   │   ├── repositories/
│   │   │   ├── interfaces.ts   # contratos (abstração de banco)
│   │   │   ├── memory/         # implementação em memória (usada nos testes)
│   │   │   └── postgres/       # implementação real em PostgreSQL (produção)
│   │   ├── services/           # AuthService (registro de empresa + login)
│   │   ├── middleware/         # auth JWT, permissões granulares, rate limit
│   │   ├── routes/             # /api/auth, /api/me
│   │   ├── config/             # variáveis de ambiente
│   │   ├── app.ts              # montagem do Express
│   │   └── server.ts           # ponto de entrada
│   ├── scripts/migrate.ts      # aplica database/schema.sql no Postgres
│   ├── tests/                  # testes automatizados (rodam com tsx --test)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/                  # Next.js 14 + TypeScript + Tailwind
│   ├── app/
│   │   ├── page.tsx             # tela de login/criar conta
│   │   ├── dashboard/page.tsx   # dashboard protegido (base para Fase 2)
│   │   ├── layout.tsx
│   │   └── globals.css          # tema visual (dark mode, roxo, glass)
│   ├── components/AuthForm.tsx  # formulário de login/cadastro completo
│   ├── lib/api.ts                # cliente da API do backend
│   ├── lib/cnpj.ts               # máscara/validação de CNPJ no frontend
│   ├── package.json
│   └── .env.local.example
├── database/
│   └── schema.sql              # schema completo: empresas, filiais, setores,
│                                 # papéis, permissões, usuários, sessões, auditoria
└── README.md                   # este arquivo
```

---

## Como instalar e rodar

### Pré-requisitos

- Node.js 18 ou superior
- PostgreSQL 14 ou superior (pode ser local ou na nuvem — você já tem um
  banco na nuvem conectado ao NEXUS OS, pode reutilizá-lo ou criar um banco
  novo só para testar esta Fase 1 antes de migrar o banco de produção)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edite o `.env` e preencha:

- `DATABASE_URL` — string de conexão do seu PostgreSQL
- `JWT_SECRET` — gere um valor forte com `openssl rand -hex 32`

Aplique o schema no banco:

```bash
npm run migrate
```

Rode os testes (não dependem do banco — usam repositórios em memória):

```bash
npm test
```

Rode o backend em desenvolvimento:

```bash
npm run dev
```

O backend sobe em `http://localhost:3333` (configurável via `PORT`).
Endpoint de verificação: `GET /health`.

Para gerar o build de produção:

```bash
npm run build
npm start
```

### 2. Frontend

Em outro terminal:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

O frontend sobe em `http://localhost:3000`. A tela de login/criar conta
aparece na raiz (`/`); depois de autenticar, você é redirecionado para
`/dashboard`.

Para build de produção:

```bash
npm run build
npm start
```

---

## Funcionalidades concluídas (Fase 1)

- ✅ Estrutura organizacional: Empresa → Filiais → Setores → Usuários
- ✅ Cadastro de empresa com CNPJ validado (algoritmo oficial de dígitos
  verificadores, aceita com ou sem pontuação) e trial automático de 7 dias
- ✅ Autenticação: registro, login, hash de senha seguro (scrypt), JWT de
  acesso (15 min), refresh (7 dias), persistência de sessão, rotação e
  revogação no logout
- ✅ Mensagens de erro corretas: senha errada, usuário inexistente, e-mail
  já em uso, CNPJ inválido/duplicado — sem revelar informação sensível
  (mensagens genéricas em login, para evitar enumeração de e-mails)
- ✅ 7 papéis padrão criados automaticamente por empresa (admin, gestor, rh,
  financeiro, estoque, operador, funcionario), cada um com um conjunto de
  permissões coerente com o princípio de menor privilégio
- ✅ Permissões granulares por módulo + ação (visualizar/criar/editar/
  excluir/exportar) — não é "tudo ou nada" por perfil
- ✅ Middleware de autenticação e de permissão prontos para proteger
  qualquer rota das próximas fases
- ✅ Auditoria: login, tentativa de login falha e criação de empresa já
  são registrados; a tabela `audit_log` está pronta para todos os módulos
  futuros
- ✅ Rate limiting básico em login/registro (proteção contra força bruta)
- ✅ Tela de login e criar conta no visual aprovado (dark mode, roxo,
  glass), conectada de verdade ao backend (sem dados fake)
- ✅ Dashboard mínimo, protegido por sessão, mostrando usuário e permissões
  reais vindas da API
- ✅ APIs administrativas protegidas por `configuracoes`: usuários, papéis e
  auditoria, sempre isoladas pelo `companyId` do token
- ✅ Sessão do frontend com refresh token, renovação automática após expiração
  do access token e logout que solicita revogação no backend
- ✅ Frontend oficial definido como Next.js; o frontend Vite legado fica fora
  do build para evitar dois contratos de autenticação concorrentes
- ✅ Primeira vertical da Fase 2: produtos e movimentações de estoque com
  persistência PostgreSQL, modo de desenvolvimento em memória, permissões,
  validações e auditoria

## Funcionalidades ainda pendentes (próximas fases)

- ⏳ Recuperação de senha ("esqueci minha senha") — mencionada no prompt
  mestre, ainda não implementada nesta fase
- ⏳ Tela de administração visual de usuários/papéis (as APIs da fundação já
  existem; a interface administrativa será adicionada sem dados fictícios)
- ⏳ Módulos de operação restantes: Compras, Fornecedores, Clientes, Vendas e
  PDV (Fase 2), Financeiro/DRE/ROI/Ticket Médio/Metas
  (Fase 3), RH/Ponto (Fase 4), Dashboard avançado/IA/Intelligence Center/
  Alertas/Integrações (Fase 5)
- ⏳ Central de Integrações, InfinitePay, OpenAI — arquitetura ainda não
  iniciada (chegam nas fases correspondentes)
- ⏳ Backup automatizado e princípios de LGPD — previstos para a Fase 6
- ⏳ Testes de carga/performance e testes de integração ponta a ponta
  (rodando o Postgres real) — precisam ser feitos no seu ambiente com
  internet

## O que foi efetivamente testado

Executado no backend desta versão, com resultado real:

```
# typecheck aprovado
# tests 39
# pass 39
# fail 0
```

Cobrindo:
- Hash de senha: salting aleatório, verificação correta/incorreta, rejeição
  de senha curta, rejeição de hash malformado
- JWT: emissão, verificação, expiração, adulteração de assinatura,
  adulteração de payload, uso de segredo errado
- CNPJ: validação de dígitos verificadores, normalização, formatação,
  geração aleatória sempre válida
- Permissões: checagem granular módulo+ação, todos os 7 papéis padrão
  batendo com as regras de negócio descritas no prompt original (ex: RH não
  acessa financeiro, gestor não exclui, funcionário só vê o básico)
- **Fluxo completo de autenticação** (o mais importante): registro de
  empresa cria os 7 papéis corretamente, rejeita CNPJ inválido/duplicado,
  rejeita senha divergente, login aceita credenciais corretas e rejeita
  incorretas, tentativas de login falho e login bem-sucedido geram registro
  de auditoria
- Persistência de sessão por hash do refresh token
- Rotação do refresh token com rejeição do token anterior
- Revogação no logout com rejeição de uso posterior
- Validação de tipo, algoritmo, claims e expiração dos JWTs
- Verificações de consistência entre usuário, empresa e sessão

O diagnóstico do editor também não aponta erros em `backend/src` e
`backend/tests`. Isso não substitui a execução completa do sistema.

## O que não pôde ser testado neste ambiente

- `npm install` e a instalação completa das dependências do frontend
- Conexão real com PostgreSQL (a implementação em `src/repositories/
  postgres/` segue exatamente o `database/schema.sql`, mas não foi
  executada contra um banco real)
- `next build` completo do frontend
- Testes de integração HTTP reais (subir o Express e fazer requisições)
- Renderização real das telas no navegador

**Recomendação:** depois de rodar `npm install` nos dois projetos e
`npm run migrate`, faça um teste manual do fluxo completo (criar conta →
login → ver dashboard) antes de seguir para a Fase 2. Se algo não bater
exatamente com o esperado, me mostre o erro e eu corrijo antes de avançar.

---

## Segurança implementada

- Senhas nunca armazenadas em texto puro (scrypt com salt aleatório)
- JWT assinado com HMAC-SHA256, com expiração curta para access token
  (15 min) e refresh token separado (7 dias)
- Comparação de hash/assinatura com `timingSafeEqual` (evita timing attacks)
- Mensagens de erro de login genéricas (não revelam se o e-mail existe)
- Rate limiting em rotas de autenticação
- `helmet` habilitado no Express (cabeçalhos de segurança HTTP)
- CORS restrito à origem configurada
- Nenhuma credencial real neste repositório — apenas `.env.example`
- Nenhuma chave de API exposta no frontend (arquitetura já preparada para
  a IA NEXUS via backend, quando essa fase chegar)

## Próximo passo

Fase 2: Produtos, Estoque, Compras, Fornecedores, Clientes, Vendas e PDV —
construída sobre esta mesma base de autenticação/permissões/auditoria, sem
recriar nada do que já está pronto aqui.

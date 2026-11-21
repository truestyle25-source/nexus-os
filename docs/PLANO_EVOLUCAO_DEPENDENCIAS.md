# Plano de evolução de dependências e runtime — NEXUS OS

Atualizado em 2026-11-21.

## 1. Situação (`npm audit --omit=dev`)
| Pacote | Gravidade | Correção | Plano |
|---|---|---|---|
| `next` 14.2.35 (frontend) | **Crítica** | Só no Next 15.5+/16 (major) | Seção 2. Exceção explícita e temporária no CI |
| `postcss` (dentro do `next`) | Alta | Junto com o Next | Idem |
| `exceljs` → `uuid` (backend) | Moderada | Só com troca de major | Avaliar `exceljs` 4.x mais novo ou alternativa; o uso é só exportação de planilha |

O CI agora **bloqueia** qualquer outra vulnerabilidade alta ou crítica (`frontend/scripts/verificar-auditoria.cjs`).

## 2. Next 14 → 15.5+ (ou 16)
Mudanças que afetam o projeto:
1. **React 19** obrigatório para o App Router do Next 15. Revisar as bibliotecas que dependem do React: `recharts` 2
   (validar a compatibilidade ou subir para 3), `lucide-react` e `dexie` (não depende do React).
2. APIs de request **assíncronas** (`cookies()`, `headers()`, `params`, `searchParams`) no `middleware.ts` e nas páginas.
3. Cache: `fetch` deixa de ser cacheado por padrão (o app é quase todo `'use client'`, então o impacto é baixo).
4. `next.config.js`: os cabeçalhos de segurança continuam iguais.

Procedimento: branch própria → `npm install next@15 react@19 react-dom@19 @types/react@19 @types/react-dom@19` →
`tsc` → testes → `next build` → varredura das 31 telas com o script de navegador usado nesta entrega (CSP e erros) →
Preview da Vercel → merge com autorização.

## 3. Node.js
- O Node 20 está fora de suporte desde abril de 2026. **Feito nesta entrega:** o Dockerfile passou para
  `node:22-alpine` (LTS) e o CI para Node 22. Imagem validada: sobe, responde `/health` e `/health/ready`, e
  passou no teste de carga.
- Prisma 5.22 e Next 14.2 são compatíveis com o Node 22 (comprovado pelo build e pelos testes).

## 4. Prisma 5 → 6
Não é urgente (o 5.22 recebe correções). Quando for feito, o arquivo local não versionado
`backend/prisma.config.ts` precisa ser apagado ou reescrito, porque está num formato inválido.

## 5. Dependabot
`.github/dependabot.yml`: PRs semanais agrupados (minor e patch) para backend e frontend; mensais para Actions e
Docker. Versões major ficam de fora, porque exigem migração planejada. Correções de segurança chegam sempre.
Para receber PRs de **segurança** automáticos, ligue em Settings → Code security → "Dependabot security updates".

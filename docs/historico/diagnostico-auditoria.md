# NEXUS OS — FASE 1: AUDITORIA GLOBAL

## STATUS: CONCLUÍDO (sem modificar arquivos)

### Arquivos Auditiados
- frontend/app/globals.css (1195 linhas) — Fonte oficial de tokens
- frontend/lib/theme.ts — Preferências usuário (não alterar)
- frontend/components/ThemeScript.tsx / ThemeSync.tsx — Aplicação de tema
- frontend/app/(dashboard)/produtos/page.tsx (533 linhas)
- frontend/app/(dashboard)/rh/page.tsx (3649 linhas)
- frontend/components/rh/ (8 componentes)
- frontend/components/relatorios/ (3 componentes)
- frontend/components/ui/ (11 componentes)

### Paleta Global Atual (:root em globals.css)

| Variável | Valor (Escuro) | Valor (Claro) | Uso |
|----------|----------------|---------------|-----|
| `--nx-canvas` | `#0b0911` | (redefinido) | Fundo página |
| `--nx-surface` | `#1c1c32` | (redefinido) | Cards, painéis |
| `--nx-surface-2` | `#121221` | (redefinido) | Tabelas, headers |
| `--nx-surface-3` | `#0d0c14` | (redefinido) | Campos, inputs |
| `--nx-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.15)` | Bordas |
| `--nx-border-strong` | `rgba(255,255,255,0.16)` | `rgba(0,0,0,0.25)` | Borda forte |
| `--nx-ink` | `#f4f2fb` | `#181824` | Texto principal |
| `--nx-ink-2` | `#b8b8d4` | `#686879` | Texto secundário |
| `--nx-ink-3` | `#8a8ab0` | `#686879` | Legendas, rótulos |
| `--nx-accent` | `#7C3AED` | `#9F8CF5` | Destaque / primary |
| `--nx-accent-2` | `#a78bfa` | (variante claro) | Ícones ativos |
| `--nx-accent-ink` | `#a78bfa` | (cor contraste) | Texto sobre accent |

### Cores Fixas Conflitantes (Hardcoded)

**Produtos:**
- `page.tsx` linha 373: `background: '#1e1e36'` — deveria `--nx-surface`
- `page.tsx` linha 374: `background: '#0f2a1a'` — cor de margem não padronizada
- `page.tsx` linha 381-382: `background: 'var(--nx-surface-2)'` — OK, já usa variável
- Badges com `#d0d0e0`, `#6a6a8a`, `#0f2a1a`, `#22c55e` — cores fixas

**RH:**
- `RH BASE.html`: `background:#fff !important` (apenas impressão)
- `RH BASE.html`: `background:#15151F`, `#2A2A3A`, `#1C1C2A` — fixed dark colors
- `FeedbackLiderancaModal.tsx` linha 107: `bg-[#0f0f1e]` — `--nx-surface`
- `FeedbackLiderancaModal.tsx` linha 127: `bg-[#1e1e36]` — `--nx-surface`
- `rh3-input`: `background: #0F0F18` — `--nx-surface-3`
- `rh3-stat`: `background: #15151F` — `--nx-surface`
- Várias cores `#15151F`, `#2A2A3A`, `#1C1C2A` em componentes RH

**Outros:**
- `App.tsx`: `bg-[#7B5CFF]` — deveria `--nx-accent`/`#9F8CF5`
- `RelatorioCard.tsx` linha 266: `rgba(255,255,255,0.06)` — `--nx-ink-rgb`
- `financeiro/page.tsx`: `#0f0f24`, `#2a2a4a`, `#0f0f1e` — fixas

### Autorreferências Redundantes (configuracoes/page.tsx)
```css
--nx-surface: var(--nx-surface);  // redundante
--nx-border: var(--nx-border);    // redundante
--nx-ink: var(--nx-ink);          // redundante
--nx-accent: var(--nx-accent);    // redundante
```

### Componentes Sem Respeito de Tema
- RH: cartões, abas, tabelas, modais com cores fixas escuras
- Produtos: badges, indicadores de estoque com cores próprias
- Vários inline styles com hexadecimais em vez de `var(--nx-*)`

### Prioridades de Correção
1. **globals.css** — Ajustar paleta para matcher proposta oficial
2. **Produtos page.tsx** — Substituir cores fixas por variáveis
3. **Componentes RH** — Eliminar cores fixas `#[0-9A-Fa-f]{6}`
4. **Authorreferências** — Remover `--nx-x: var(--nx-x);`
5. **App.tsx** — Substituir `#7B5CFF` por variáveis

### Pendências para Fase 2
- Definir valores exatos do tema claro para todas as variáveis
- Validar contraste entre tema claro/escuro
- Verificar quais componentes já usam variáveis vs cores fixas
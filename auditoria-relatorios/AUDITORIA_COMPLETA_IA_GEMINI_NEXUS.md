# AUDITORIA TÉCNICA COMPLETA — IA, GEMINI E TTS/STT — NEXUS OS

**Projeto:** NEXUS OS  
**Diretório:** `c:\Users\samue\OneDrive\Documentos\GitHub\nexus-os`  
**Data da auditoria:** 11/11/2026  
**Escopo:** Mapeamento de todas as capacidades de IA, integrações Google Gemini, e funcionalidades TTS/STT  
**Restrição:** Análise somente-leitura — nenhum código-fonte foi modificado  
**Arquivo do relatório:** `auditoria-relatorios/AUDITORIA_COMPLETA_IA_GEMINI_NEXUS.md`

---

## RESUMO EXECUTIVO

O NEXUS OS implementa um ecossistema de Inteligência Artificial centrado no Google Gemini, com três frentes principais:

1. **Chat de IA** (`/ia/perguntar`) — assistente conversacional para perguntas em linguagem natural sobre negócios.
2. **Intelligence Center** (`/ia/intelligence-center`) — oportunidades e alertas gerados por IA com base em dados reais de estoque, vendas e financeiro.
3. **Relatórios por IA** (`gerarRelatorioPorIA`) — interpretação de perguntas sobre relatórios (vendas/financeiro/estoque) com estruturação via Gemini e fallback determinístico.

A camada de áudio oferece **TTS** (Text-to-Speech) via backend (`/api/v1/tts`) e **STT** (Speech-to-Text) nativo do navegador (Web Speech API), orquestrados no frontend da página IA.


---

## 1. CAPACIDADES DE IA (IA CAPABILITIES)

### 1.1 Chat de IA (`/ia/perguntar`)

| Item | Detalhe |
|------|---------|
| Arquivo backend | `backend/src/modules/ia/ia.routes.ts` |
| Serviço backend | `backend/src/modules/ia/ia.service.ts` |
| Endpoint | `POST /api/v1/ia/perguntar` (compat: `POST /ia/perguntar`) |
| Método HTTP | POST |
| Autenticação | Obrigatória (JWT via `authenticate` middleware) |
| Rate limit | Sim, configurado nas rotas de IA |
| Parâmetros | `pergunta` (string), `message` (string, alias) |
| Resposta de sucesso | `{ resposta: string, fallback: boolean }` |
| Resposta sem chave | HTTP 200, `{ resposta: "Olá! Sou a IA da NEXUS OS...", fallback: true }` |
| Persistência | Gravado em `conversaIA` apenas quando Gemini responde (sem chave → não grava) |
| Isolamento multi-tenant | Filtro por `empresaId` extraído do token JWT |

**Fluxo:** Frontend → `/ia/perguntar` → `ia.service.ts` → verifica `GEMINI_API_KEY` → se ausente, retorna fallback fixo → se presente, chama Gemini via `fetch` direto para `generativelanguage.googleapis.com` → processa resposta → retorna ao frontend → grava conversa.

### 1.2 Intelligence Center (`/ia/intelligence-center`)

| Item | Detalhe |
|------|---------|
| Endpoint | `GET /api/v1/ia/intelligence-center` (compat: `GET /ia/intelligence-center`) |
| Autenticação | Obrigatória |
| Rate limit | Sim |
| Fonte de dados | Vendas reais (Prisma), estoque real, financeiro real |
| Oportunidades geradas | `ESTOQUE_BAIXO` (giro baixo com estoque mínimo), `RESSAO_VENDAS` (queda de faturamento hoje vs ontem) |
| Isolamento | Multi-tenant por `empresaId` |
| Testes | `backend/tests/ia-nexus.test.ts` valida ausência de oportunidade inventada para empresa sem dados |

### 1.3 Relatórios por IA (`gerarRelatorioPorIA`)

| Item | Detalhe |
|------|---------|
| Arquivo | `backend/src/modules/relatorios/iaRelatorios.service.ts` |
| Função principal | `gerarRelatorioPorIA(args)` |
| Fontes suportadas | `vendas`, `financeiro`, `estoque` |
| Interpretação de pergunta | `interpretarPergunta(pergunta, tab)` — classificação determinística por palavras-chave (não usa LLM para classificação) |
| Agrupamentos | `porForma` (doughnut), `porProduto` (bar), `porDia` (line) |
| Estruturação via Gemini | `estruturarComIA()` — prompt rigoroso proibindo invenção de números; valida KPIs contra dados reais |
| Fallback determinístico | `estruturaFallback()` — título/resumo/insights calculados localmente dos mesmos números reais |
| Persistência | Tabela `RelatorioGerado` (Prisma) |
| Campo de controle | `dados.fallback: boolean` — true quando Gemini não foi consultado |

**Regras de validação do Gemini em relatórios:**
- KPIs: valor deve existir exatamente nos KPIs reais calculados
- Máximo 3 KPIs, máximo 3 insights
- Resumo limitado a 600 caracteres, título a 140
- JSON puro (sem markdown) com `responseMimeType: 'application/json'`

### 1.4 Plano de Desenvolvimento (RH — sugestões de IA)

| Item | Detalhe |
|------|---------|
| Arquivo | `backend/src/modules/rh/plano-desenvolvimento.ts` |
| Funções | `sugerirPlano()`, `validarSugestaoIA()`, `extrairJson()`, `montarContextoIA()` |
| Validação | Objetivos e competências devem pertencer a catálogos fixos (`OBJETIVOS`, `COMPETENCIAS`, `TIPOS_ACAO`) |
| Rejeição | Sugestões fora do catálogo são descartadas, não aceitas como texto livre |
| Prazo | Deve estar entre `PRAZO_MIN_DIAS` e `PRAZO_MAX_DIAS` |
| Sem chave | `sugerirPlano()` falha explicitamente com motivo contendo `GEMINI_API_KEY` |
| Testes | `backend/tests/plano-desenvolvimento.test.ts` |

---

## 2. INTEGRAÇÕES GOOGLE GEMINI

### 2.1 Configuração de variáveis de ambiente

Arquivo: `c:\Users\samue\OneDrive\Documentos\GitHub\nexus-os\.env.example`

```
# Chave da API Google Gemini (NEXUS IA)
GEMINI_API_KEY=sua_chave_gemini_aqui
GEMINI_MODEL=gemini-3.6-flash
```

| Variável | Valor padrão | Obrigatória | Descrição |
|----------|-------------|-------------|-----------|
| `GEMINI_API_KEY` | (vazio no .env.example) | Sim | Chave de API do Google Generative Language |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Não | Modelo Gemini utilizado |

### 2.2 Endpoint da API Gemini

Todas as chamadas ao Gemini usam `fetch` nativo (não o SDK `@google/generative-ai`):

```
POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent?key={apiKey}
```

**Cabeçalhos:**
- `Content-Type: application/json`

**Corpo da requisição (exemplo do chat de IA):**
```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "<prompt>" }] }],
  "generationConfig": {
    "temperature": 0.3,
    "maxOutputTokens": 900,
    "responseMimeType": "application/json"
  }
}
```

**Timeout:** 15 segundos (`AbortController` + `setTimeout`).

### 2.3 Locais de chamada ao Gemini

| Arquivo | Função | Uso |
|---------|--------|-----|
| `backend/src/modules/ia/ia.service.ts` | `perguntar()` | Chat principal, interpretação de pergunta de negócio |
| `backend/src/modules/relatorios/iaRelatorios.service.ts` | `estruturarComIA()` | Estruturação de relatórios executivos |
| `backend/src/modules/rh/plano-desenvolvimento.ts` | `sugerirPlano()` | Sugestão de plano de desenvolvimento DISC |

### 2.4 Tratamento de ausência de chave

Todas as três funções seguem o mesmo padrão:
1. Verifica `process.env.GEMINI_API_KEY`
2. Se ausente → retorna `null` / `fallback: true` / erro explícito (não lança exceção)
3. Se presente → chama Gemini com timeout de 15s

---

## 3. TTS / STT (TEXT-TO-SPEECH / SPEECH-TO-TEXT)

### 3.1 TTS — Backend (síntese de voz)

| Item | Detalhe |
|------|---------|
| Serviço | `backend/src/modules/tts/tts.service.ts` |
| Função | `gerarVozNatural(texto: string): Promise<Buffer>` |
| Controller | `backend/src/modules/tts/tts.controller.ts` |
| Rotas | `POST /api/v1/tts`, `POST /tts` |
| Autenticação | Obrigatória (`authenticate` middleware) |
| Validação | Texto obrigatório, máximo 2.000 caracteres |
| Content-Type de resposta | `audio/mpeg` |
| Cache | `Cache-Control: public, max-age=86400` |
| Erro 502 | Quando `gerarVozNatural` retorna buffer vazio |
| Erro 500 | Exceção na síntese |

### 3.2 TTS — Frontend (consumo)

Arquivo: `frontend/app/(dashboard)/ia/page.tsx`

| Item | Detalhe |
|------|---------|
| Função | `speak(texto)` |
| Endpoint consumido | `${baseUrl}/api/v1/tts` (POST, com Bearer token) |
| Processamento | Limpa markdown (`[*#_`~>]`), normaliza espaços |
| Audio playback | `URL.createObjectURL(blob)` → `new Audio(url)` → `audio.play()` |
| Voz preferida | `pt-BR-FranciscaNeural` (Edge TTS via backend) |
| Fallback | Web Speech API `speechSynthesis` com voz Google pt-BR |
| Condição de fala | Somente quando `origem === "modo_voz"` e `!semModelo` |
| Fallback não falado | Respostas com `fallback: true` não são sintetizadas em modo voz |

### 3.3 STT — Frontend (reconhecimento de fala)

Arquivo: `frontend/app/(dashboard)/ia/page.tsx`

| Item | Detalhe |
|------|---------|
| API | `window.SpeechRecognition` / `window.webkitSpeechRecognition` (navegador nativo) |
| Idioma | `pt-BR` |
| `continuous` | `false` |
| `interimResults` | `false` |
| Eventos | `onresult` → transcrição → `handleSendMessage(transcript, origem)` |
| Orígens | `"texto"` (digitação), `"audio"` (mic solto, apenas texto), `"modo_voz"` (botão azul, fala + texto) |
| Backend STT | Não existe — todo STT é client-side via Web Speech API |
| Suporte | Alerta se navegador não suportar (recomenda Chrome/Edge) |

### 3.4 Fluxo de voz completo (Modo Voz)

```
1. Usuário clica botão azul (Waves) → enterVoiceMode()
2. startListening() → SpeechRecognition.start() → status "listening"
3. Usuário fala → onresult → transcript
4. handleSendMessage(transcript, "modo_voz") → POST /ia/perguntar
5. Backend responde (Gemini ou fallback)
6. Se sucesso e !fallback → speak(respostaText) → POST /api/v1/tts → áudio tocado
7. onended do áudio → startListening() (ciclo contínuo em modo voz)
8. Se fallback → não fala, mostra texto com erro:true
```

---

## 4. ARQUITETURAS

### 4.1 Camadas do sistema de IA

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js / React)                                 │
│  - app/(dashboard)/ia/page.tsx                              │
│  - SpeechRecognition (STT nativo)                           │
│  - fetch /api/v1/tts (TTS)                                  │
│  - fetch /ia/perguntar (chat IA)                            │
└─────────────────────────────────────────────────────────────┘
                              │ HTTP/JSON
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (Fastify / Node.js)                                │
│  - ia.routes.ts          → rotas /ia/perguntar, /intelligence-center
│  - ia.service.ts         → serviço de chat, chamada Gemini
│  - tts.controller.ts     → rotas /api/v1/tts, /tts
│  - tts.service.ts        → gerarVozNatural()
│  - iaRelatorios.service.ts → relatórios por IA
│  - authenticate middleware → JWT + rate limit + multi-tenant
└─────────────────────────────────────────────────────────────┘
                              │ HTTPS/fetch
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  GOOGLE GENERATIVE LANGUAGE API                             │
│  generativelanguage.googleapis.com/v1beta/models/...        │
│  Modelo: gemini-3.6-flash                                   │
│  Chave: GEMINI_API_KEY (query param)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BANCO DE DADOS (PostgreSQL / Prisma)                       │
│  - conversaIA       (histórico de chat)                     │
│  - RelatorioGerado  (relatórios gerados por IA)             │
│  - venda, estoque, financeiro (fontes de dados reais)       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Padrões arquitetônicos identificados

| Padrão | Descrição | Onde |
|--------|-----------|------|
| **Fallback determinístico** | Quando Gemini indisponível, estrutura local a partir de dados reais (nunca inventa) | `iaRelatorios.service.ts`, `ia.service.ts` |
| **Validação estrita de saída** | KPIs do Gemini devem existir exatamente nos dados reais; senão, descartados | `normalizarKpi()` |
| **Multi-tenant por empresaId** | Todas as consultas filtradas por empresa do token JWT | Todas as rotas IA |
| **Rate limiting** | Limite de chamadas nas rotas de IA | `ia.routes.ts` |
| **Resposta 200 com fallback** | Sem chave → HTTP 200 + `fallback: true` (não é erro HTTP, é sinal de negócio) | `ia.service.ts` |
| **Timeout controlado** | 15s com `AbortController` | Chamadas ao Gemini |
| **Auth por rota** | TTS e IA exigem autenticação; outras rotas públicas | `tts.controller.ts`, `ia.routes.ts` |

---

## 5. DEPENDÊNCIAS

### 5.1 Dependências de produção (backend)

Arquivo: `backend/package.json`

| Pacote | Função no contexto IA |
|--------|----------------------|
| `@prisma/client` | ORM — acesso a `conversaIA`, `RelatorioGerado`, vendas, estoque, financeiro |
| `fastify` | Framework HTTP — rotas de IA e TTS |
| `@fastify/jwt` | Autenticação JWT para rotas protegidas |
| `zod` | Validação de entradas (ZodError handler) |
| `node:fetch` / `fetch` | Chamada direta à API Gemini (não usa `@google/generative-ai`) |

**Observação:** Apesar de menções anteriores sobre `@google/generative-ai`, o código real usa `fetch` nativo para chamar a REST API do Gemini. Não há importação do SDK oficial do Google nos arquivos analisados.

### 5.2 Dependências de produção (frontend)

Arquivo: `frontend/package.json` (arquitetura Next.js / React)

| Pacote | Função no contexto IA |
|--------|----------------------|
| `react` | UI da página IA |
| `next/navigation` | Roteamento (`useRouter`) |
| `lucide-react` | Ícones (Mic, Waves, Volume2, etc.) |
| `@/lib/api` | Cliente HTTP (`api.post`, `getToken`) |

### 5.3 Dependências de ambiente / infraestrutura

| Recurso | Variável | Obrigatório para IA? |
|---------|----------|---------------------|
| Google Gemini API | `GEMINI_API_KEY` | **Sim** (sem chave → fallback apenas) |
| Google Gemini Modelo | `GEMINI_MODEL` | Não (padrão: `gemini-3.6-flash`) |
| Banco PostgreSQL | `DATABASE_URL` | Sim (persistência conversas e relatórios) |
| JWT Secret | `JWT_SECRET` | Sim (autenticação rotas IA/TTS) |
| URL pública API | `NEXT_PUBLIC_API_URL` | Sim (frontend chama backend) |
| URL frontend | `FRONTEND_URLS` | Não (CORS) |
| Resend (e-mail) | `RESEND_API_KEY` | Não (não relacionado a IA) |

### 5.4 Dependências do navegador (cliente)

| API | Uso | Disponibilidade |
|-----|-----|-----------------|
| `window.SpeechRecognition` / `webkitSpeechRecognition` | STT | Chrome, Edge (não Firefox/Safari) |
| `window.speechSynthesis` | TTS fallback | A maioria dos navegadores modernos |
| `localStorage` | `nexus_api_url` | Todos |
| `URL.createObjectURL` / `Blob` | Reprodução áudio TTS | Todos modernos |
| `fetch` | Chamadas API | Todos modernos |
4. Se Gemini falhar (rede, cota, JSON inválido) → retorna `null` → fallback determinístico local
**Status geral:** Funcional com dependência crítica de `GEMINI_API_KEY`. Sem a chave, todas as rotas de IA retornam 200 com `fallback: true` e texto de aviso — não há chamada ao modelo Gemini. O frontend trata esse sinal corretamente na página IA (marca como erro e não sintetiza voz em fallback), mas outros módulos podem não respeitar o sinal de forma uniforme.
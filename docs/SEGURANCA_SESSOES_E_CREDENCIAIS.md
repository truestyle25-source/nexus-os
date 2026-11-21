# Sessões, proteção da aplicação e credenciais — NEXUS OS

Atualizado em 2026-11-21. Nenhum segredo neste documento.

## 1. Sessões
| Item | Situação |
|---|---|
| Emissão | JWT com 8 h de validade, `jti` único e `emitidoEmMs` (instante em ms) |
| Logout | Revoga o `jti` (`TokenRevogado`) |
| Usuário inativo ou empresa suspensa | Recusado em toda requisição (consulta ao banco) |
| **Troca ou redefinição de senha** | **Corrigido em 21/11**: antes, só a sessão atual era encerrada e qualquer outra sessão aberta (por exemplo, de quem usou uma senha vazada) continuava valendo por até 8 h. Agora `Usuario.sessoesValidasDesde` recusa **todo** token emitido antes da troca, com precisão de milissegundos. Testado em `pilares-infra.test.ts` e `configuracoes.test.ts` |
| Renovação | Não há refresh token: com 8 h, o usuário entra de novo |

### Token no `localStorage` × cookie HttpOnly
Um token no `localStorage` pode ser lido por um script injetado (XSS). A migração para cookie HttpOnly está
**bloqueada por arquitetura**: o frontend (`*.vercel.app`) e a API (`*.onrender.com`) estão em **sites diferentes**,
então o cookie seria de terceiros (`SameSite=None`). Safari e o bloqueio de terceiros do Chrome o recusam, e o
login quebraria para parte dos usuários.

**O que destrava:** servir a API sob o mesmo domínio do frontend, com um domínio próprio
(`app.seudominio.com.br` + `api.seudominio.com.br`) ou um rewrite da Vercel (`/api/*` → Render). Plano detalhado
em `docs/PROJETOS_TECNICOS_SAAS.md` (Fase 11).

**Mitigações aplicadas enquanto isso:**
1. **CSP** no frontend com `connect-src` restrito à própria origem e à API. Um script injetado não consegue
   mandar o token para outro servidor por `fetch`/XHR, nem carregar script de outro domínio.
2. A troca da URL da API pelo `localStorage` (`nexus_api_url`), que permitiria desviar o token, foi
   **desligada na produção**.
3. `frame-ancestors 'none'` / `X-Frame-Options: DENY` contra clickjacking.

## 2. Cabeçalhos de segurança
| Cabeçalho | Backend (todas as respostas) | Frontend (todas as páginas) |
|---|---|---|
| Content-Security-Policy | `default-src 'none'; frame-ancestors 'none'` (respostas JSON) | Política completa (ver `frontend/next.config.js`) |
| X-Frame-Options | DENY | DENY |
| X-Content-Type-Options | nosniff | nosniff |
| Referrer-Policy | no-referrer | strict-origin-when-cross-origin |
| Permissions-Policy | câmera, microfone, geolocalização e pagamento negados | microfone só da própria origem (voz da IA) |
| Strict-Transport-Security | 1 ano (em produção) | já enviado pela Vercel |
| X-Powered-By | — | removido |

**Validação no navegador real:** build de produção, login e visita às **31 telas** do painel: **0 violações de
CSP e 0 requisições bloqueadas**. Limitação: `script-src` precisa de `'unsafe-inline'` por causa dos scripts
inline do Next 14 e do ThemeScript. Para retirar, é preciso nonce por requisição (middleware), o que fica para
a migração do Next.

**CSRF:** não se aplica à autenticação atual, porque o token vai no cabeçalho `Authorization` e não em cookie;
um site externo não consegue enviá-lo. Passa a se aplicar se migrar para cookie (o plano da Fase 11 inclui o
token CSRF).

**Entradas e SQL:** as rotas validam o corpo com Zod. Todo SQL manual usa parâmetros (`$queryRaw` com template
ou `Prisma.sql`), o que foi auditado em 20/11. Os dois `$queryRawUnsafe` da importação também usam parâmetros
(`$1`, `$2`…); o do script de restauração interpola só nomes de tabela de uma lista fixa.

## 3. Força bruta e rate limiting
| Limite | Chave | Armazenamento |
|---|---|---|
| Login: 10 por minuto | IP + e-mail, e e-mail sozinho | Banco (`LoginAttempt`), como antes |
| Cadastro e recuperação de senha: 5/min | IP | **Banco** (`RateLimitJanela`), antes em memória |
| IA (vários módulos): 15 a 20/min | **Usuário** (antes por IP) | Banco |
| API pública: 120/min (`API_PUBLICA_LIMITE_MINUTO`) | **Chave de API** | Banco. **Antes não existia** limite nenhum, apesar de o README dizer o contrário |
| Telemetria de erro: 30/min | IP | Banco |

Contador atômico (`INSERT ... ON CONFLICT`): 50 incrementos simultâneos = 50 (testado). É compartilhado entre
instâncias (testado) e, se o banco falhar, o sistema não para (fail-open, com log).

### IP forjado (`X-Forwarded-For`)
Com `trustProxy: true` (o padrão atual), **o cliente escolhe o próprio IP**, comprovado em teste: o
`X-Forwarded-For: 6.6.6.6` forjado vira o `req.ip`. Por isso, limites por IP podiam ser contornados. Os limites por
e-mail, usuário e chave **não** dependem disso.

**Correção disponível, que exige configurar a produção:**
1. Descobrir a cadeia real de proxies do Render: num deploy, registrar `x-forwarded-for` de uma requisição sua e
   contar os saltos, ou confirmar se o cabeçalho `cf-connecting-ip` chega.
2. Definir **`TRUST_PROXY_HOPS=<n>`** (confia só nos N proxies mais próximos; testado) **ou**
   **`CLIENT_IP_HEADER=cf-connecting-ip`**, se o Cloudflare do Render sempre sobrescrever esse cabeçalho.

Sem a verificação, o valor não foi trocado às cegas: um número errado faria todos os usuários parecerem vir do
mesmo IP, e os limites por IP bloqueariam todo mundo.

## 4. Multiempresa
- Testes positivos e negativos, nos dois sentidos (A→B e B→A), em 6 módulos e no SQL cru, com RLS ativo como
  `nexus_app`: a suíte inteira roda assim no CI. Localmente, em 21/11: **401 aprovados, 0 falhas**.
- Validação SQL 10/10 (`04_validacao_rls.sql`), incluindo as 2 tabelas novas (RLS só de sistema).
- Isolamento **por filial**: não existe; um usuário vê todas as filiais da própria empresa. PDV e caixa já são
  por usuário e filial. O projeto (Fase 12 de `PROJETOS_TECNICOS_SAAS.md`) depende de decisões de negócio.

## 5. Credenciais expostas e plano de rotação
Varredura do **histórico completo** do Git (todas as refs), comparando o valor real de cada segredo local:

| Credencial | Onde aparece | Situação | Ação |
|---|---|---|---|
| Senha do usuário de produção | 2 scripts de teste, públicos no GitHub desde 09/11 | Removida do código em 20/11 e **trocada por você em 20/11** (confirmado: a senha antiga não abre mais a conta) | Encerrado |
| Senha do `postgres` (administrador do Supabase) | Commit **local** `aa0bd44` (checkpoint do Cline, `refs/cline/checkpoints/...`, **nunca enviado ao GitHub**) e 14 arquivos de histórico de assistentes de IA | **Ainda é a senha atual** | **Trocar** no Supabase (Database → Settings → Reset password) e atualizar `backend/.env`. Depois, apagar o ref local: `git update-ref -d refs/cline/checkpoints/1794718369141_io9sw/2` |
| Credencial de auditoria (`frontend/.env.test`) | 2 commits públicos | Não confere com nenhum usuário da produção | Se a conta existir em algum ambiente, trocar a senha |
| `JWT_SECRET`, Gemini, Resend, service role do Supabase, senhas de `nexus_app`/`nexus_migrator`, `CREDENTIALS_ENCRYPTION_KEY` | Nenhum commit | Limpos | — |
| `OPENAI_API_KEY` e `JWT_SECRET` antigos (estavam na Vercel até 20/11) | Painel da Vercel | Removidos da Vercel | Se eram os mesmos da produção, trocar (pendência de 20/11) |

Apagar o código atual **não** apaga a exposição do histórico. Para um repositório público, o que resolve é a
**rotação**. Reescrever o histórico (`git filter-repo`) é destrutivo e não remove cópias já baixadas.

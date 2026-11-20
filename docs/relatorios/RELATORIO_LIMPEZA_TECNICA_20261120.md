# Relatório — Limpeza técnica do NEXUS OS (2026-11-20)

Branch `chore/limpeza-tecnica`. Nada foi aplicado em produção: sem merge, sem deploy, sem migração na produção.
No banco de produção só houve consultas de leitura. Segredos não aparecem neste documento.

## 1. Diagnóstico inicial
- O repositório tinha **703 arquivos versionados**, e cerca de 1/3 era resíduo: cópias `.bak`/`backup-*`, saídas de
  build e de teste (`*.txt`), listagens geradas (`filelist.txt` com 5 MB), scripts avulsos de correção
  (`corrigir-*-v1..v7.ps1`) e arquivos com nomes quebrados por comandos PowerShell mal digitados.
- Código morto no backend: 7 arquivos sem nenhum import, entre eles 2 rotas de vendas **sem filtro de empresa**
  (`vendas-status.routes.ts` e `vendas-historico.routes.ts`), que seriam inseguras se alguém as ligasse.
- Texto corrompido (UTF-8 lido como Windows-1252) em 10 arquivos de código. Isso causava **mensagens quebradas para
  o usuário** ("Venda nÃ£o encontrada") e **um bug funcional em Fornecedores** (ver 7.2).
- **Senha real da produção** escrita em 2 scripts de teste versionados, num repositório **público**.
- 8 dependências sem uso no backend e 5 no frontend.
- README com informações falsas: Zustand, Axios e Zod no frontend, Fastify 4, Postgres 15 e um `npm install` na
  raiz que não fazia nada.
- 4 tabelas sem índice em `empresaId`, coluna que a policy RLS filtra em toda consulta.

## 2. Arquivos analisados
- Os **703 arquivos versionados**, incluindo 274 rotas declaradas no backend.
- **85 modelos** do Prisma e **51 migrações**.
- **563 colunas de texto** da produção, verificadas só por leitura.
- Grafo de imports de todo o código do backend (`src`, `scripts`, `tests`) e do frontend (`app`, `components`, `lib`, `src`).

## 3. Arquivos removidos — 253, todos recuperáveis pelo histórico do Git

| Grupo | Qtde | Evidência de que eram desnecessários |
|---|---|---|
| Cópias de segurança (`backups/`, `backup-*` na raiz, `backend/backup-*`, `*.bak`, `pdv/page.tsx.bak-encoding`) | ~85 | Nenhum import nem referência em scripts, CI ou Dockerfile; o histórico do Git já guarda as versões |
| Saídas de build/teste/diagnóstico (`*-test*.txt`, `test-output*.txt`, `tsc-errors*.txt`, `diagnostico*/`, `git_diff*.txt`, `npm_ls.txt`, `vitest_*.txt`, `filelist.txt`, `cores-fixas.csv` etc.) | ~75 | São arquivos gerados; nada os lê |
| Nomes quebrados (`t "…" -ForegroundColor Cyan`, `cal-visual…page.tsx"`, `hboard)…`) e `backend/$null` | 6 | Saídas acidentais de comandos PowerShell |
| Scripts avulsos de correção (`corrigir-*.ps1` ×12, `fix-*.ps1/.js/.py`, `prisma/fix*.ps1`, `check*.ps1`, `temp.js`, `tmpchk.js`, `write_readme.py` etc.) | ~30 | Edições pontuais já aplicadas; sem referência |
| Scripts ad hoc de banco no backend (`setup_units.js`, `list_units.js`, `fix_enum.js`, `query-db.js`, `test-db.js`, `test_*.js/.mjs`, `verificar-venda.sql`) | 10 | Sem referência; criavam um `PrismaClient` próprio, sem o contexto de RLS |
| `backend/tmp/mod3..mod6` (experimentos de teste isolados) | 15 | Fora do padrão `tests/*.test.ts`; nunca rodam |
| `backend/scripts/migrate.ts` | 1 | Importa `pg`, que não é dependência, e lê `database/schema.sql`, que não existe. Quebrado |
| `package.json` e `package-lock.json` da raiz | 2 | Vercel usa `frontend/`, Render usa `backend/`, o CI usa os dois; o lock da raiz nem batia com o `package.json` |
| `vercel.json` da raiz e `backend/vercel.json` | 2 | A Vercel usa a pasta `frontend` como raiz. O do backend apontava para `Frontend/dist` com Vite, coisas que não existem |
| `.env.example` da raiz e `frontend/.env.local.example` | 2 | Duplicados de `backend/.env.example` e `frontend/.env.example`; o backend lê `backend/.env` |
| `nexus-auditoria-enterprise/` e `.zip`; `Nexus-OS-Enterprise-Pack/nexus-enterprise-pack/` | ~12 | Cópias idênticas (mesmo md5) ou versão anterior do pacote do nível acima |
| Código morto do backend: `config/env.ts`, `config/prisma.ts`, `modules/chat/chat.service.ts`, `modules/enterprise-pack/routes.js`, `vendas/vendas.service.ts`, `vendas/vendas-status.routes.ts`, `vendas/vendas-historico.routes.ts` | 7 | Zero imports (grafo de imports). O `routes.js` tinha sintaxe TypeScript num `.js` e não compilava. O `vendas.service.ts` duplicava funções que existem em `vendas.routes.ts`. O `chat.service.ts` duplicava a IA de `modules/ia` |
| Frontend: `src/App.tsx` (protótipo), `TODO_SNIFFER_ENTIDADES.cjs`, `fix-encoding.js`, `run_tsc.bat`, `tsconfig.tsbuildinfo` | 5 | Zero imports; o `src/App.tsx` declara ser protótipo e não é rota do Next |
| `test-results/.last-run.json`, `RELATORIO_REVISAO_PDV.md` (vazio) | 2 | Saída do Playwright e arquivo vazio |
| `frontend/.env.test` | 1 | **Só saiu do Git**; o arquivo local foi mantido. Tinha uma credencial de teste, e o Playwright não o carrega |

**Restaurado durante a revisão:** `frontend/auditoria-rotas.json`. A segunda auditoria mostrou que
`tests/e2e/auditoria-enterprise.spec.ts` lê esse arquivo.

## 4. Arquivos movidos (nada perdido)
- `docs/historico/`: os relatórios antigos da raiz (auditorias de produtos, estoque e build, a pasta
  `AUDITORIA-IA-NEXUS/` e o `RH BASE.html`).
- `docs/relatorios/`: os três relatórios de segurança de hoje, mais este.
- `docs/DEBITO-TECNICO.md`: continua vivo, porque o código cita os itens dele nos comentários.
- `scripts/auditoria-enterprise/`: o script `auditoria-completa.ps1` e o LEIA-ME, com as instruções corrigidas.

## 5. Arquivos modificados
| Arquivo | Mudança |
|---|---|
| 10 arquivos de código¹ | Texto corrompido corrigido. **Provado que só caracteres não-ASCII mudaram** (código, aspas e nomes intactos) |
| `frontend/app/(dashboard)/fornecedores/page.tsx` | Também: a cópia local de `maskCnpj` saiu e passou a ser importada de `lib/cnpj.ts` (implementação idêntica) |
| 6 scripts de teste e2e (`erp-negocio-suite.js`, `simulacao-nexus.spec.js`, `route-check-nexus*.js`, `login-nexus-simulado.js`, `audit-test.js`) | Senhas fixas trocadas por `NEXUS_AUDIT_EMAIL` e `NEXUS_AUDIT_PASSWORD` |
| `backend/prisma/schema.prisma` | `@@index([empresaId])` em 4 modelos; comentários com acentuação corrigida |
| `backend/prisma/migrations/202611201500_indices_empresa_id/` (nova) | 4 `CREATE INDEX IF NOT EXISTS`. **Não aplicada na produção** |
| `backend/Dockerfile` | `npm install` virou `npm ci`, que instala exatamente o que está no lockfile, igual ao CI; saiu a linha morta `mv Prisma prisma`. Build Docker local OK |
| `backend/src/server.ts` | Comentário desatualizado sobre o Enterprise Pack; indentação |
| `backend/.env.example` | Entrou `DIRECT_URL` e `EMPRESA_FUSO`, saiu `CONTROLID_*` (não é lida pelo código) |
| `backend/package*.json` e `frontend/package*.json` | Dependências sem uso removidas (seção 6) |
| `.gitignore` | Passa a ignorar `*.tsbuildinfo`, `test-results/`, `playwright-report/`, `*.bak*`, `/backup-*`, `/backups/` e `relatorios-auditoria/` |
| `README.md` | Reescrito com a pilha real |
| `README-PRODUCAO.md` | Lista real de variáveis; migração com `DIRECT_URL`; 3 afirmações falsas corrigidas |

¹ `vendas.routes.ts`, `mercadolivre.service.ts`, `mercadolivre-sync.service.ts`, `cross-tenant-isolamento.test.ts`,
`schema.prisma` (só comentários), e as páginas `compras`, `dre`, `financeiro`, `fornecedores` e `produtos`.

## 6. Dependências removidas
| Pacote | Onde | Evidência |
|---|---|---|
| `edge-tts` | backend | 0 imports (o TTS usa `node-edge-tts`) |
| `qrcode`, `@types/qrcode` | backend | 0 imports |
| `ws`, `@types/ws` | backend | 0 imports diretos; continua instalado como dependência do `node-edge-tts`, que carrega normalmente |
| `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` | backend | Sem configuração nem script de lint |
| `axios`, `zod`, `zustand` | frontend | 0 imports (a API usa `fetch` em `lib/api.ts`) |
| `eslint`, `eslint-config-next` | frontend | Sem configuração; `eslint-config-next` 16 é incompatível com o Next 14 |

Lockfiles: 112 pacotes removidos no backend e 318 no frontend, **nenhum adicionado e nenhuma versão alterada**.

## 7. Problemas encontrados

### 7.1 Senha real da produção num repositório público (crítico)
`frontend/tests/e2e/erp-negocio-suite.js` e `simulacao-nexus.spec.js`, versionados desde 09/11, continham a senha que
**confere com o único usuário da produção**. A comparação foi feita por bcrypt contra o hash, só com leitura e sem
exibir nada. A senha saiu do código, mas **continua no histórico público do Git**, então trocá-la é obrigatório.

### 7.2 Status "Crítico" de fornecedor não funcionava
A tela enviava `'CrÃ­tico'`, mas o backend aceita só `z.enum(['Ativo','Crítico','Inativo'])`. Resultado: marcar um
fornecedor como crítico dava 400, e a aba "Crítico" nunca listava nada. Corrigido junto com o texto corrompido. As
categorias (`Bonés`, `Acessórios`, `Calçados`) e a condição `À vista` passam a ser gravadas corretamente.
A produção não tem nenhum valor corrompido gravado (563 colunas verificadas), então nada existente deixa de bater.

### 7.3 Mensagens de erro corrompidas
105 linhas em `vendas.routes.ts` e 9 em `mercadolivre.service.ts`, entre elas "Venda nÃ£o encontrada",
"Desconto exige autorizaÃ§Ã£o" e "CartÃ£o indisponÃ­vel". Corrigidas.

### 7.4 Rotas mortas inseguras
`vendas-status.routes.ts` atualizava o status de uma venda **sem filtrar a empresa**. Removida; não estava ligada.

### 7.5 Índices ausentes
`Auditoria`, `ConversaIA`, `IntegracaoPonto` e `RegraAutomacao` não tinham índice em `empresaId`. Migração preparada.

### 7.6 Build do Docker não reprodutível
O `npm install` ignorava o lockfile. Corrigido para `npm ci`.

## 8. Problemas corrigidos
Todos os da seção 7, exceto a troca da senha (7.1) e a aplicação da migração na produção (7.5), que dependem de você.

## 9. Problemas não resolvidos (exigem decisão, ou estão fora do escopo de limpeza)
- `next` 14.2.35 tem 1 falha crítica e 1 alta (`postcss`), que só saem com Next 15.5+/16. É uma migração major, e não
  atualizei versões em massa.
- `exceljs`: 2 falhas moderadas (`uuid`); a correção exige mudança de versão major.
- `frontend/manifest.json` fica fora de `public/`, então o Next não o serve. O README antigo dizia que o app era
  PWA. Mover o arquivo muda comportamento, por isso não mexi.
- `backend/scripts/simulacao-nexus-erp.ts` e `limpar-residuos-pdv.ts` são ferramentas manuais documentadas, e as
  mantive. O primeiro cria um `PrismaClient` próprio: nunca rode contra a produção.
- `dominio/` e `Nexus-OS-Enterprise-Pack/`: entregas ainda não integradas, mantidas.
- Uso de `(app as any).authenticate` em vários módulos: só tipagem, sem efeito de segurança (ver 10).
- O Node 20 do Dockerfile e do CI está fora de suporte. Atualizar o runtime é um projeto separado.

## 10. Segurança
- **Prova dinâmica:** com o servidor real, chamei as **274 rotas** sem token e com token inválido (548 requisições).
  As **265 rotas privadas responderam 401 em 100% dos casos**. As 9 restantes são públicas por desenho: login,
  cadastro, recuperação e redefinição de senha, os retornos OAuth do Mercado Livre e da Shopee (302), o webhook do
  Mercado Livre (200), o webhook PIX (503, não configurado) e `/health`.
- RLS e chaves estrangeiras não foram alterados. O CI volta a rodar a suíte como `nexus_app`, com RLS ativo.
- Senhas fixas retiradas do código; `frontend/.env.test` saiu do Git.
- Nenhum mecanismo de segurança foi desativado.

## 11. Banco de dados (somente leitura na produção)
- `prisma migrate diff` (produção × schema anterior a esta branch): **sem diferenças**. `migrate status`: 51 de 51 aplicadas.
- Nenhum dado corrompido nas 563 colunas de texto.
- Esta branch acrescenta a migração 52, só de índices, testada no banco local: aplicou e o schema ficou sem
  diferença. **Na produção ela só entra com `DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy`, que depende da
  sua autorização.** O Render não roda migrações sozinho.
- Nenhum `reset`, `db push`, `db pull` ou `DROP`.

## 12. Configurações de produção
- **Vercel:** usa a pasta `frontend`, com só `NEXT_PUBLIC_API_URL`; o `vercel.json` da raiz era ignorado.
- **Render:** o Dockerfile foi corrigido (`npm ci`) e o build local passou. As variáveis seguem como na revisão de hoje.
- **Supabase:** sem mudanças.
- **Resend:** sem mudanças. O domínio próprio continua pendente.
- `.env.example` e `README-PRODUCAO.md` agora listam as variáveis que o código realmente lê.

## 13. Resultado dos testes
| Execução | Resultado |
|---|---|
| Backend, Postgres local (como `postgres`), depois da limpeza | 391 testes: **380 aprovados, 0 falhas**, 11 pulados (igual à `main` no CI) |
| Backend, de novo, depois dos índices (+ `tsc`) | **380 aprovados, 0 falhas**, 11 pulados |
| Frontend (`tsx --test`) | **64 de 64** |
| Sonda de autenticação | 530 de 530 respostas 401 nas rotas privadas |
| CI do PR (como `postgres` e como `nexus_app` com RLS) | roda no GitHub ao abrir o PR |

## 14. Resultado dos builds
`prisma validate` OK · `prisma generate` OK · `tsc --noEmit` do backend e do frontend: 0 erros · `npm run build`
do backend OK · `next build` OK (todas as rotas geradas) · `docker build` do backend com `npm ci`: OK.

## 15. Riscos identificados
| Risco | Gravidade | Situação |
|---|---|---|
| Senha da produção no histórico público do Git | **Crítica** | Trocar a senha (você) |
| Next 14 com falha crítica | Alta | Migração major (projeto separado) |
| Webhook do Mercado Livre sem assinatura | Baixa | É assim por desenho do Mercado Livre; o webhook só enfileira |
| Índices ausentes (desempenho com RLS) | Média | Migração pronta; aplicar com autorização |
| Node 20 fora de suporte | Média | Projeto separado |

## 16. Pendências que exigem você
1. **Trocar agora a senha do usuário da produção** pela tela. Ela está pública no histórico do GitHub desde 09/11.
2. Autorizar o merge desta branch, depois de ver o CI verde.
3. Autorizar a migração `202611201500_indices_empresa_id` na produção (não destrutiva).
4. Apagar à mão os resíduos locais **não versionados**, que não toquei por estarem fora do Git: os 3 arquivos
   `t "…" -ForegroundColor Cyan`, `console.error(e.code`, `frontend-build*.log`, `server.log` e
   `backend/prisma.config.ts` (config inválida para o Prisma 5, gerada por outra ferramenta).
5. Decidir sobre o `manifest.json` (PWA) e a migração do Next.

# Backup e recuperação de desastres — NEXUS OS

Atualizado em 2026-11-21. Segredos não aparecem neste documento.

## 1. Situação

| Item | Antes (auditoria de 21/11) | Agora |
|---|---|---|
| Backup automático diário | Não existia | `.github/workflows/backup.yml`, todo dia às 06:17 UTC (03:17 em Brasília) |
| Onde roda | Só manual, na máquina local | GitHub Actions: fora do Render, do Supabase e da máquina local |
| Teste de restauração | Manual, eventual | **A cada backup**: restaura num Postgres descartável e confere tabela a tabela |
| Integridade | Não verificada | `pg_restore --list` + SHA-256 do dump |
| Criptografia | Nenhuma (arquivo em claro no OneDrive) | AES-256 (gpg simétrico) antes de sair do executor |
| Armazenamento | Disco local + OneDrive | S3-compatível (quando configurado) **ou** artefato cifrado do GitHub (30 dias) |
| Retenção | 30 dias só no script local | 30 dias no armazenamento externo e nos artefatos |
| Alerta de falha | Nenhum | Execução vermelha = e-mail do GitHub ao dono do repositório |
| Restauração acidental na produção | **Possível**: o script restaurava em `DATABASE_URL` com `--clean` | Recusada: destino obrigatório e explícito, bloqueio de produção e do Supabase |

**Prova (21/11, contra a produção, só leitura):** dump de 360 KB, 828 objetos, restaurado num banco
descartável com **86 tabelas, 163 chaves estrangeiras e 52 migrações, 0 tabelas com contagem divergente**.
Cifrado com 57 KB; decifrado com o SHA-256 conferindo; senha errada recusada.

## 2. Como ativar (pendência sua: os segredos)

O workflow **falha de propósito** enquanto os segredos não existem, e é essa falha que gera o alerta.

1. **Gerar a senha da cifragem** e guardar no gerenciador de senhas. **Sem ela, nenhum backup pode ser aberto.**
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. **Cadastrar os segredos no GitHub.** Os comandos leem o valor do arquivo local sem exibi-lo. Rode-os na raiz do repositório:
   ```powershell
   (Get-Content backend\.env.seguranca.local | Select-String '^DIRECT_URL=').Line.Split('=',2)[1].Trim('"') | gh secret set BACKUP_DATABASE_URL
   ```
   ```powershell
   gh secret set BACKUP_PASSPHRASE
   ```
   O segundo comando pede o valor: cole a senha do passo 1.
3. **Armazenamento externo (recomendado):** crie um bucket **privado** e cadastre `BACKUP_S3_BUCKET`,
   `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_ENDPOINT` e, para AWS, `BACKUP_S3_REGION`.
   A chave de acesso deve ter permissão **só** nesse bucket.
4. Rode uma vez à mão: **Actions → Backup diário → Run workflow** e confira o resumo.

### Comparação do armazenamento externo
Preços aproximados por GB por mês, que devem ser conferidos no site de cada provedor antes de contratar.

| Opção | Custo de armazenamento | Saída (download) | Observação |
|---|---|---|---|
| **Cloudflare R2** (recomendado) | ~US$ 0,015/GB; 10 GB grátis | Grátis | API S3; o volume atual (~60 KB/dia cifrado) cabe com folga no gratuito |
| Backblaze B2 | ~US$ 0,006/GB | Grátis até 3× o armazenado | O mais barato para volumes grandes |
| AWS S3 Standard | ~US$ 0,023/GB | Pago | Versionamento e Object Lock maduros |

Para todos: bucket privado, chave com escopo restrito, versionamento ligado e, se disponível, Object Lock,
para que um invasor com a chave não apague os backups.

### Riscos do armazenamento temporário (artefato do GitHub)
O repositório é **público**: qualquer usuário logado no GitHub consegue baixar artefatos. O arquivo está
cifrado com AES-256 e é inútil sem a senha, mas a recomendação é configurar o R2 e tirar essa dependência.

## 3. Retenção
- **Diária**, por 30 dias, no armazenamento externo (`vars.BACKUP_RETENCAO_DIAS` muda o valor) e nos artefatos.
- Recomendado para quando houver clientes pagantes: uma cópia **mensal** guardada por 12 meses (regra de
  ciclo de vida do bucket, prefixo `mensal/`).

## 4. Restauração (`npm run backup:restaurar`)
```powershell
gpg -d -o nexus.dump nexus_AAAA-MM-DDTHH-MM-SSZ.dump.gpg
```
```powershell
npm run backup:restaurar -- nexus.dump --destino "postgresql://usuario:senha@host:5432/banco_vazio"
```
Travas do script (`backend/src/scripts/restaurar-backup.ts`, coberto em `tests/pilares-infra.test.ts`):
1. Destino **obrigatório**; `DATABASE_URL` e `DIRECT_URL` nunca são usadas como destino.
2. Recusa o mesmo banco da `DATABASE_URL`/`DIRECT_URL` e qualquer host do Supabase. Sobrescrever a produção
   exige `--sobrescrever-producao=<nome-do-banco>`, só em desastre e com autorização.
3. Valida o arquivo **antes** (`pg_restore --list`).
4. Exige destino vazio; `--limpar` só se for intencional.
5. Depois confere tabelas, FKs validadas, migrações do Prisma e contagens, e grava `<dump>.restauracao.json`.

## 5. Teste periódico de restauração
| Item | Definição |
|---|---|
| Automático | **Diário**, dentro do próprio backup (passo 3 do script). Falha = workflow vermelho |
| Manual (ensaio completo) | **Mensal**, na 1ª segunda-feira |
| Responsável | Dono da conta (hoje: o fundador) |
| Procedimento | Baixar o backup do dia → decifrar → `npm run backup:restaurar -- ... --destino <banco local>` → subir o backend apontando para ele → login e abrir 3 telas |
| Aprovação | `aprovado: true` no relatório, 0 FKs inválidas, migrações iguais às da produção e login funcionando |
| Registro | Uma linha na seção 8 deste documento: data, arquivo, resultado e tempo gasto |

## 6. Plano de recuperação (RPO e RTO)
- **RPO (perda máxima de dados): 24 horas**, com o backup diário.
- **RTO (tempo até voltar a funcionar): 2 a 4 horas**, que é restaurar, apontar o backend e validar.
- Para reduzir: o Supabase Pro faz backup diário gerenciado; o add-on de PITR baixa o RPO para minutos.
  **Ainda não verificado qual plano o projeto usa**: veja a pendência na seção 7.

| Cenário | Ação |
|---|---|
| Exclusão acidental de dados | Restaurar o backup mais recente num banco **separado**, extrair só as linhas perdidas e reinserir com o `nexus_migrator`. Nunca restaurar por cima da produção |
| Corrupção de dados | Identificar desde quando (log `reqId`/Auditoria); restaurar o backup anterior em banco separado; comparar e corrigir |
| Falha do Supabase (região/projeto) | Criar um projeto novo (mesma região) → `prisma/seguranca/02_papeis.sql` → restaurar o backup → `01_rls_policies.sql` → trocar `DATABASE_URL`/`DIRECT_URL` no Render |
| Falha do Render | Redeploy do commit anterior no painel; se o serviço inteiro cair, criar outro Web Service Docker a partir do repositório (`backend/`) com as mesmas variáveis |
| Credenciais comprometidas | Trocar no Supabase as senhas de `nexus_app`, `nexus_migrator` e `postgres`; trocar o `JWT_SECRET` (desloga todo mundo), a `GEMINI_API_KEY`, a `RESEND_API_KEY` e a service role do Supabase; atualizar Render e GitHub Secrets. A `CREDENTIALS_ENCRYPTION_KEY` só pode ser trocada com o recifrador (`recifrar-credenciais.ts`) |
| Indisponibilidade total | O monitor (`monitor.yml`) alerta; seguir os cenários acima conforme a camada |

## 7. Pendências
- **Supabase: verificar o plano e os backups nativos** (painel → Database → Backups). Não presumir backup diário nem PITR.
- Cadastrar os segredos (seção 2) e escolher o armazenamento externo.
- Opcional e recomendado: um papel `nexus_backup` só de leitura (com `BYPASSRLS`) no lugar do `nexus_migrator`
  para o backup. Exige operação administrativa no Supabase, com sua autorização.

## 8. Registro de testes de restauração
| Data | Arquivo | Resultado | Duração |
|---|---|---|---|
| 2026-11-20 | prod-antes-seguranca-20261120.dump | Aprovado (85 tabelas) | manual |
| 2026-11-20 | prod-antes-fk-20261120.dump | Aprovado | manual |
| 2026-11-21 | prod-antes-indices-20261121.dump | Aprovado (86 tabelas, 51 migrações) | manual |
| 2026-11-21 | nexus_2026-11-21T10-05-06Z.dump.gpg (script novo) | Aprovado: 86 tabelas, 163 FKs, 52 migrações, 0 divergências | 138 s |

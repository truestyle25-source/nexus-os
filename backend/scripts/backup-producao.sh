#!/usr/bin/env bash
# Backup verificado do banco de produção do NEXUS OS.
#
# Usado pelo workflow .github/workflows/backup.yml (diário) e testável localmente.
# Só LÊ a produção. Etapas:
#   1. pg_dump (formato custom, comprimido) do schema public.
#   2. Integridade do arquivo: pg_restore --list precisa listar objetos.
#   3. TESTE DE RESTAURAÇÃO: restaura num banco DESCARTÁVEL (nunca na produção) e confere
#      tabelas, chaves estrangeiras, migrações do Prisma e contagem de linhas de CADA tabela
#      contra a origem.
#   4. SHA-256 do dump e cifragem AES-256 (gpg simétrico) — só o arquivo cifrado sai daqui.
#   5. Relatório JSON (sem segredos) para o resumo do workflow.
#
# Variáveis obrigatórias:
#   ORIGEM_URL             conexão de LEITURA com a produção (dono das tabelas: nexus_migrator)
#   VERIFICACAO_ADMIN_URL  Postgres descartável onde o teste de restauração cria/apaga um banco
#   BACKUP_PASSPHRASE      senha da cifragem (guardada só no cofre de segredos)
# Opcional: SAIDA_DIR (padrão ./backup-saida)
set -euo pipefail

: "${ORIGEM_URL:?defina ORIGEM_URL}"
: "${VERIFICACAO_ADMIN_URL:?defina VERIFICACAO_ADMIN_URL}"
: "${BACKUP_PASSPHRASE:?defina BACKUP_PASSPHRASE}"
SAIDA_DIR="${SAIDA_DIR:-./backup-saida}"

# Trava: o banco de verificação NUNCA pode ser o de origem.
host_de() { sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#' <<<"$1"; }
if [[ "$(host_de "$ORIGEM_URL")" == "$(host_de "$VERIFICACAO_ADMIN_URL")" ]]; then
  echo "ERRO: o banco de verificação está no mesmo host da origem. Recusado." >&2; exit 2
fi

mkdir -p "$SAIDA_DIR"
CARIMBO="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BASE="nexus_${CARIMBO}"
DUMP="$SAIDA_DIR/$BASE.dump"
BANCO_VERIF="verif_$(date -u +%Y%m%d%H%M%S)_$$"
url_com_banco() { sed -E "s#^(.*://[^/]+)/[^?]*#\1/$2#" <<<"$1"; }
VERIF_URL="$(url_com_banco "$VERIFICACAO_ADMIN_URL" "$BANCO_VERIF")"
inicio=$(date +%s)

limpar() { psql "$VERIFICACAO_ADMIN_URL" -qAt -c "DROP DATABASE IF EXISTS \"$BANCO_VERIF\"" >/dev/null 2>&1 || true; rm -f "$DUMP"; }
trap limpar EXIT

echo "[1/5] pg_dump (schema public, formato custom)"
pg_dump "$ORIGEM_URL" -Fc -n public --no-owner --no-acl -f "$DUMP"
TAMANHO=$(stat -c %s "$DUMP")

echo "[2/5] integridade do arquivo"
OBJETOS=$(pg_restore --list "$DUMP" | grep -vc '^;' || true)
if [[ "$OBJETOS" -lt 1 ]]; then echo "ERRO: dump sem objetos" >&2; exit 3; fi

echo "[3/5] teste de restauração num banco descartável"
psql "$VERIFICACAO_ADMIN_URL" -qAt -c "CREATE DATABASE \"$BANCO_VERIF\"" >/dev/null
# pg_restore sai com 1 também para avisos (ex.: "schema public already exists"); a conferência decide.
pg_restore --no-owner --no-acl -d "$VERIF_URL" "$DUMP" 2> "$SAIDA_DIR/pg_restore.log" || true
ERROS_RESTORE=$(grep -c 'error:' "$SAIDA_DIR/pg_restore.log" || true)
ERROS_ESPERADOS=$(grep -c 'schema "public" already exists' "$SAIDA_DIR/pg_restore.log" || true)

consulta() { psql "$1" -qAt -v ON_ERROR_STOP=1 -c "$2"; }
TABELAS=$(consulta "$VERIF_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
TABELAS_ORIGEM=$(consulta "$ORIGEM_URL" "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
FKS=$(consulta "$VERIF_URL" "SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")
FKS_INVALIDAS=$(consulta "$VERIF_URL" "SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND NOT convalidated")
MIGRACOES=$(consulta "$VERIF_URL" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
MIGRACOES_ORIGEM=$(consulta "$ORIGEM_URL" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")

# Contagem EXATA de linhas, tabela a tabela, origem x restaurado.
DIVERGENTES=0; VAZIAS_INDEVIDAS=0; LINHAS_TOTAL=0
while read -r t; do
  [[ -z "$t" ]] && continue
  o=$(consulta "$ORIGEM_URL" "SELECT count(*) FROM public.\"$t\"")
  r=$(consulta "$VERIF_URL" "SELECT count(*) FROM public.\"$t\"")
  LINHAS_TOTAL=$((LINHAS_TOTAL + r))
  if [[ "$o" != "$r" ]]; then
    DIVERGENTES=$((DIVERGENTES + 1)); echo "  aviso: $t origem=$o restaurado=$r (pode ser escrita durante o backup)"
    if [[ "$r" == "0" && "$o" != "0" ]]; then VAZIAS_INDEVIDAS=$((VAZIAS_INDEVIDAS + 1)); fi
  fi
done < <(consulta "$ORIGEM_URL" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")

PROBLEMAS=()
[[ "$TABELAS" != "$TABELAS_ORIGEM" ]] && PROBLEMAS+=("tabelas restauradas $TABELAS != origem $TABELAS_ORIGEM")
[[ "$FKS_INVALIDAS" != "0" ]] && PROBLEMAS+=("$FKS_INVALIDAS FK(s) não validadas")
[[ "$MIGRACOES" != "$MIGRACOES_ORIGEM" ]] && PROBLEMAS+=("migrações $MIGRACOES != origem $MIGRACOES_ORIGEM")
[[ "$VAZIAS_INDEVIDAS" != "0" ]] && PROBLEMAS+=("$VAZIAS_INDEVIDAS tabela(s) vazias no restaurado e não vazias na origem")
[[ $((ERROS_RESTORE - ERROS_ESPERADOS)) -gt 0 ]] && PROBLEMAS+=("$((ERROS_RESTORE - ERROS_ESPERADOS)) erro(s) inesperados no pg_restore")

echo "[4/5] SHA-256 e cifragem AES-256"
SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 -o "$DUMP.gpg" "$DUMP"
echo "$SHA  $BASE.dump" > "$SAIDA_DIR/$BASE.dump.sha256"
TAMANHO_CIFRADO=$(stat -c %s "$DUMP.gpg")

echo "[5/5] relatório"
APROVADO=true; [[ ${#PROBLEMAS[@]} -gt 0 ]] && APROVADO=false
LISTA_PROBLEMAS="[]"
if [[ ${#PROBLEMAS[@]} -gt 0 ]]; then LISTA_PROBLEMAS=$(printf '"%s",' "${PROBLEMAS[@]}"); LISTA_PROBLEMAS="[${LISTA_PROBLEMAS%,}]"; fi
cat > "$SAIDA_DIR/$BASE.relatorio.json" <<JSON
{
  "arquivo": "$BASE.dump.gpg",
  "geradoEm": "$CARIMBO",
  "duracaoSegundos": $(( $(date +%s) - inicio )),
  "tamanhoDumpBytes": $TAMANHO,
  "tamanhoCifradoBytes": $TAMANHO_CIFRADO,
  "sha256DumpEmClaro": "$SHA",
  "objetosNoArquivo": $OBJETOS,
  "tabelas": $TABELAS,
  "chavesEstrangeiras": $FKS,
  "migracoesAplicadas": $MIGRACOES,
  "linhasRestauradas": $LINHAS_TOTAL,
  "tabelasComContagemDivergente": $DIVERGENTES,
  "aprovado": $APROVADO,
  "problemas": $LISTA_PROBLEMAS
}
JSON
cat "$SAIDA_DIR/$BASE.relatorio.json"
echo "BACKUP_ARQUIVO=$SAIDA_DIR/$BASE.dump.gpg" >> "${GITHUB_ENV:-/dev/null}"
echo "BACKUP_BASE=$BASE" >> "${GITHUB_ENV:-/dev/null}"
if [[ "$APROVADO" != "true" ]]; then echo "ERRO: backup REPROVADO na verificação" >&2; exit 4; fi
echo "OK: backup verificado e cifrado."

#!/usr/bin/env bash
# Backup do Postgres de producao do Post Flow.
#
# Roda no HOST da VPS (nao dentro de um container), via cron. Faz o dump por
# dentro do container do banco, verifica que o arquivo gerado e restauravel,
# rotaciona copias antigas e grava o resultado na tabela "settings" (chave
# "last_db_backup") pra que o painel do admin consiga mostrar "ultimo backup:
# ha X horas" e denunciar backup silenciosamente quebrado.
#
# Instalacao (uma vez):
#   scp scripts/backup-db.sh root@72.61.219.94:/usr/local/bin/postflow-backup
#   ssh root@72.61.219.94 "chmod +x /usr/local/bin/postflow-backup"
#   ssh root@72.61.219.94 "crontab -l 2>/dev/null | grep -v postflow-backup; \
#     echo '15 3 * * * /usr/local/bin/postflow-backup >> /var/log/postflow-backup.log 2>&1'"
#
# Uso manual: /usr/local/bin/postflow-backup
set -uo pipefail

BACKUP_ROOT="${POSTFLOW_BACKUP_ROOT:-/var/backups/postflow}"
DB_SERVICE_FILTER="${POSTFLOW_DB_FILTER:-postflow_db}"
DB_NAME="${POSTFLOW_DB_NAME:-postflow}"
DB_USER="${POSTFLOW_DB_USER:-postgres}"

# Quantas copias manter em cada faixa. Diario cobre "estraguei hoje de manha",
# semanal cobre "so percebi semana passada", mensal cobre auditoria/historico.
KEEP_DAILY="${POSTFLOW_KEEP_DAILY:-14}"
KEEP_WEEKLY="${POSTFLOW_KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${POSTFLOW_KEEP_MONTHLY:-12}"

STAMP="$(date +%Y-%m-%d_%H%M)"
DAY_OF_WEEK="$(date +%u)"   # 7 = domingo
DAY_OF_MONTH="$(date +%d)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Grava o status do backup no proprio banco. Feito por ultimo e sempre (sucesso
# ou falha) pra que "nao ter backup" seja visivel no painel em vez de silencioso.
record_status() {
  local status="$1" detail="$2" bytes="${3:-0}"
  local payload
  payload=$(printf '{"status":"%s","at":"%s","detail":"%s","bytes":%s}' \
    "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${detail//\"/}" "$bytes")
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "INSERT INTO settings (key, value) VALUES ('last_db_backup', '$payload'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();" \
    >/dev/null 2>&1 || log "AVISO: nao consegui gravar o status do backup no banco."
}

fail() {
  log "ERRO: $1"
  [ -n "${DB_CONTAINER:-}" ] && record_status "error" "$1"
  exit 1
}

DB_CONTAINER="$(docker ps -q -f "name=${DB_SERVICE_FILTER}" | head -1)"
[ -z "$DB_CONTAINER" ] && { log "ERRO: container do banco (${DB_SERVICE_FILTER}) nao encontrado."; exit 1; }

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly" || fail "nao consegui criar $BACKUP_ROOT"

TARGET="$BACKUP_ROOT/daily/postflow_${STAMP}.dump"
TMP="${TARGET}.partial"

log "Iniciando dump de '${DB_NAME}' (container ${DB_CONTAINER})..."

# -Fc = formato "custom": comprimido e restauravel seletivamente com pg_restore.
# O dump sai pelo stdout do container e e gravado direto no host, entao nao
# ocupa espaco dentro do container nem depende de volume compartilhado.
if ! docker exec "$DB_CONTAINER" pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > "$TMP" 2>/tmp/postflow-backup-err; then
  rm -f "$TMP"
  fail "pg_dump falhou: $(head -c 300 /tmp/postflow-backup-err | tr '\n' ' ')"
fi

SIZE=$(wc -c < "$TMP" | tr -d ' ')
[ "$SIZE" -lt 1000 ] && { rm -f "$TMP"; fail "dump gerado tem so ${SIZE} bytes - algo esta errado."; }

# Verificacao de verdade: um arquivo que existe mas nao abre nao e backup.
# pg_restore --list le o indice interno do dump e falha se estiver corrompido.
if ! docker exec -i "$DB_CONTAINER" pg_restore --list > /dev/null 2>&1 < "$TMP"; then
  rm -f "$TMP"
  fail "o dump gerado nao passou na verificacao do pg_restore (arquivo corrompido)."
fi

TABLES=$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$TMP" 2>/dev/null | grep -c 'TABLE DATA' || true)
[ "${TABLES:-0}" -lt 5 ] && { rm -f "$TMP"; fail "dump tem so ${TABLES} tabelas com dados - suspeito, abortando."; }

mv "$TMP" "$TARGET"
log "Dump OK: $TARGET (${SIZE} bytes, ${TABLES} tabelas)."

# Copias das faixas semanal/mensal saem do arquivo diario recem-criado.
[ "$DAY_OF_WEEK" = "7" ] && cp "$TARGET" "$BACKUP_ROOT/weekly/postflow_${STAMP}.dump" && log "Copia semanal criada."
[ "$DAY_OF_MONTH" = "01" ] && cp "$TARGET" "$BACKUP_ROOT/monthly/postflow_${STAMP}.dump" && log "Copia mensal criada."

# Rotacao: mantem so as N mais recentes de cada faixa.
rotate() {
  local dir="$1" keep="$2"
  # shellcheck disable=SC2012
  ls -1t "$dir"/postflow_*.dump 2>/dev/null | tail -n "+$((keep + 1))" | while read -r old; do
    rm -f "$old"
  done
  log "Rotacao de $(basename "$dir"): mantendo as $keep mais recentes."
}
rotate "$BACKUP_ROOT/daily" "$KEEP_DAILY"
rotate "$BACKUP_ROOT/weekly" "$KEEP_WEEKLY"
rotate "$BACKUP_ROOT/monthly" "$KEEP_MONTHLY"

# ---------------------------------------------------------------------------
# Copia fora da VPS - o que protege contra PERDER O SERVIDOR.
#
# Tudo acima protege contra migration ruim, DELETE sem WHERE e bug, mas nao
# contra o disco da VPS falhar, porque as copias estao NO MESMO disco.
#
# Usa a API NATIVA do Backblaze B2 (curl + jq, que ja existem no servidor) em
# vez da interface S3. Motivo: a VPS e Ubuntu 24.04 e o pacote "awscli" nao
# existe mais nos repositorios dela; a alternativa seria instalar o AWS CLI v2
# na mao (~50 MB) ou o rclone, e nada disso se justifica pra mandar um arquivo
# de 1,4 MB por dia. Sao 3 chamadas HTTP simples.
#
# Pra ligar, crie /etc/postflow-backup.env (chmod 600, NUNCA no git):
#   B2_KEY_ID=...
#   B2_APP_KEY=...
#   B2_BUCKET=postflow
#
# Sem esse arquivo, o backup local continua funcionando normalmente e so
# registra "local-apenas" - de proposito: falha no envio pra fora nunca pode
# fazer parecer que nao houve backup nenhum.
# ---------------------------------------------------------------------------
OFFSITE_STATUS="local-apenas"
[ -f /etc/postflow-backup.env ] && . /etc/postflow-backup.env

upload_b2() {
  local arquivo="$1" nome="$2"

  # 1) Autentica. A chave e limitada ao bucket, entao a propria resposta ja diz
  #    qual bucketId ela alcanca - nao precisa procurar pelo nome.
  local auth
  auth=$(curl -s --max-time 30 -u "${B2_KEY_ID}:${B2_APP_KEY}" \
    https://api.backblazeb2.com/b2api/v3/b2_authorize_account) || return 1

  local token api_url bucket_id
  token=$(echo "$auth" | jq -r '.authorizationToken // empty')
  api_url=$(echo "$auth" | jq -r '.apiInfo.storageApi.apiUrl // empty')
  bucket_id=$(echo "$auth" | jq -r '.apiInfo.storageApi.bucketId // empty')
  [ -z "$token" ] && { log "B2: autenticacao falhou: $(echo "$auth" | jq -r '.message // "resposta inesperada"')"; return 1; }
  [ -z "$bucket_id" ] && { log "B2: a chave nao esta limitada a um bucket - refaca a chave restrita ao bucket ${B2_BUCKET:-postflow}."; return 1; }

  # 2) Pede a URL de upload (o B2 sorteia um servidor por envio).
  local up
  up=$(curl -s --max-time 30 -H "Authorization: ${token}" \
    "${api_url}/b2api/v3/b2_get_upload_url?bucketId=${bucket_id}") || return 1
  local up_url up_token
  up_url=$(echo "$up" | jq -r '.uploadUrl // empty')
  up_token=$(echo "$up" | jq -r '.authorizationToken // empty')
  [ -z "$up_url" ] && { log "B2: nao consegui a URL de upload: $(echo "$up" | jq -r '.message // "resposta inesperada"')"; return 1; }

  # 3) Envia. O B2 EXIGE o SHA1 do conteudo e confere do lado dele - se o
  #    arquivo chegar corrompido, o proprio B2 recusa. E verificacao de
  #    integridade de graca, alem da que ja fizemos com pg_restore --list.
  local sha1
  sha1=$(sha1sum "$arquivo" | cut -d' ' -f1)
  local resp
  resp=$(curl -s --max-time 300 -X POST "$up_url" \
    -H "Authorization: ${up_token}" \
    -H "X-Bz-File-Name: ${nome}" \
    -H "Content-Type: application/octet-stream" \
    -H "X-Bz-Content-Sha1: ${sha1}" \
    --data-binary "@${arquivo}") || return 1

  [ "$(echo "$resp" | jq -r '.fileId // empty')" = "" ] && {
    log "B2: upload recusado: $(echo "$resp" | jq -r '.message // "resposta inesperada"')"
    return 1
  }
  return 0
}

if [ -n "${B2_KEY_ID:-}" ] && [ -n "${B2_APP_KEY:-}" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    log "AVISO: B2 configurado mas falta o 'jq' (apt-get install -y jq)."
    OFFSITE_STATUS="offsite-sem-cliente"
  else
    log "Enviando copia pro Backblaze B2..."
    if upload_b2 "$TARGET" "$(basename "$TARGET")"; then
      log "Copia externa enviada e confirmada pelo B2 (SHA1 conferido)."
      OFFSITE_STATUS="offsite-ok"
    else
      log "AVISO: falha ao enviar a copia externa (o backup LOCAL esta salvo)."
      OFFSITE_STATUS="offsite-falhou"
    fi
  fi
fi

record_status "ok" "$(basename "$TARGET") [$OFFSITE_STATUS]" "$SIZE"
log "Backup concluido com sucesso ($OFFSITE_STATUS)."

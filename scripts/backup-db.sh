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
# Copia fora da VPS (opcional, mas e o que protege contra perder o servidor).
#
# Tudo acima protege contra migration ruim, DELETE sem WHERE e bug - mas nao
# contra o disco da VPS falhar, porque as copias estao NO MESMO disco.
#
# Pra ligar, coloque num arquivo /etc/postflow-backup.env (chmod 600):
#   OFFSITE_BUCKET=s3://meu-bucket/postflow
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
#   AWS_ENDPOINT_URL=https://s3.us-west-004.backblazeb2.com   # so pro B2
# e instale o cliente: apt-get install -y awscli
#
# Sem esse arquivo, o backup local continua funcionando normalmente e so
# registra um aviso - de proposito: falha no envio pra fora nunca pode fazer
# parecer que nao houve backup nenhum.
# ---------------------------------------------------------------------------
OFFSITE_STATUS="local-apenas"
[ -f /etc/postflow-backup.env ] && . /etc/postflow-backup.env

if [ -n "${OFFSITE_BUCKET:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    log "AVISO: OFFSITE_BUCKET configurado mas o comando 'aws' nao existe (apt-get install -y awscli)."
    OFFSITE_STATUS="offsite-sem-cliente"
  else
    ENDPOINT_ARG=""
    [ -n "${AWS_ENDPOINT_URL:-}" ] && ENDPOINT_ARG="--endpoint-url $AWS_ENDPOINT_URL"
    log "Enviando copia pra $OFFSITE_BUCKET ..."
    # shellcheck disable=SC2086
    if aws $ENDPOINT_ARG s3 cp "$TARGET" "$OFFSITE_BUCKET/$(basename "$TARGET")" >/dev/null 2>&1; then
      log "Copia externa enviada."
      OFFSITE_STATUS="offsite-ok"
    else
      log "AVISO: falha ao enviar a copia externa (o backup local esta salvo)."
      OFFSITE_STATUS="offsite-falhou"
    fi
  fi
fi

record_status "ok" "$(basename "$TARGET") [$OFFSITE_STATUS]" "$SIZE"
log "Backup concluido com sucesso ($OFFSITE_STATUS)."

#!/usr/bin/env bash
# Restaura um backup do Post Flow gerado por scripts/backup-db.sh.
#
# Roda no HOST da VPS. Por padrao restaura num banco NOVO de teste (nao toca no
# banco de producao) - e assim que se confere que um backup presta sem risco.
# So sobrescreve producao com --into-production, e ainda assim exige digitar
# "SIM" e tira um dump de seguranca antes.
#
#   /usr/local/bin/postflow-restore                                  # ultimo backup -> banco de teste
#   /usr/local/bin/postflow-restore /var/backups/postflow/daily/x.dump
#   /usr/local/bin/postflow-restore <arquivo> --into-production      # SOBRESCREVE producao
set -uo pipefail

BACKUP_ROOT="${POSTFLOW_BACKUP_ROOT:-/var/backups/postflow}"
DB_SERVICE_FILTER="${POSTFLOW_DB_FILTER:-postflow_db}"
DB_NAME="${POSTFLOW_DB_NAME:-postflow}"
DB_USER="${POSTFLOW_DB_USER:-postgres}"
TEST_DB="postflow_restore_test"

DUMP="${1:-}"
MODE="${2:-test}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

DB_CONTAINER="$(docker ps -q -f "name=${DB_SERVICE_FILTER}" | head -1)"
[ -z "$DB_CONTAINER" ] && { echo "ERRO: container do banco nao encontrado."; exit 1; }

if [ -z "$DUMP" ] || [ "$DUMP" = "--into-production" ]; then
  [ "$DUMP" = "--into-production" ] && MODE="--into-production"
  # shellcheck disable=SC2012
  DUMP="$(ls -1t "$BACKUP_ROOT"/daily/postflow_*.dump 2>/dev/null | head -1)"
  [ -z "$DUMP" ] && { echo "ERRO: nenhum backup encontrado em $BACKUP_ROOT/daily."; exit 1; }
  log "Usando o backup mais recente: $DUMP"
fi
[ ! -f "$DUMP" ] && { echo "ERRO: arquivo nao encontrado: $DUMP"; exit 1; }

psql_root() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres "$@"; }

if [ "$MODE" = "--into-production" ]; then
  echo
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "  ISSO VAI APAGAR O BANCO DE PRODUCAO ('${DB_NAME}') E COLOCAR"
  echo "  O CONTEUDO DE: $DUMP"
  echo "  Tudo que aconteceu DEPOIS desse backup sera perdido."
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo
  read -r -p 'Digite SIM (maiusculo) para continuar: ' CONFIRM
  [ "$CONFIRM" != "SIM" ] && { echo "Cancelado."; exit 1; }

  SAFETY="/var/backups/postflow/antes-do-restore_$(date +%Y-%m-%d_%H%M).dump"
  log "Tirando um dump de seguranca do estado atual em $SAFETY ..."
  docker exec "$DB_CONTAINER" pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > "$SAFETY" \
    || { echo "ERRO: nao consegui tirar o dump de seguranca. Abortando."; exit 1; }

  log "Derrubando conexoes abertas com o banco..."
  psql_root -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null

  log "Restaurando (--clean --if-exists sobrescreve os objetos existentes)..."
  docker exec -i "$DB_CONTAINER" pg_restore --clean --if-exists --no-owner -U "$DB_USER" -d "$DB_NAME" < "$DUMP"
  log "Restore de producao concluido. Dump de seguranca do estado anterior: $SAFETY"
  log "IMPORTANTE: reinicie os servicos -> docker service update --force postflow_web postflow_worker postflow_video-worker"
  exit 0
fi

log "Modo TESTE: restaurando em '${TEST_DB}' (producao nao e tocada)."
psql_root -c "DROP DATABASE IF EXISTS ${TEST_DB};" >/dev/null
psql_root -c "CREATE DATABASE ${TEST_DB};" >/dev/null
docker exec -i "$DB_CONTAINER" pg_restore --no-owner -U "$DB_USER" -d "$TEST_DB" < "$DUMP" 2>&1 | grep -v '^$' | head -20

echo
log "Conferindo se os dados realmente chegaram:"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -c "
  SELECT 'users' AS tabela, count(*) FROM users
  UNION ALL SELECT 'youtube_channels', count(*) FROM youtube_channels
  UNION ALL SELECT 'source_videos', count(*) FROM source_videos
  UNION ALL SELECT 'clips', count(*) FROM clips
  UNION ALL SELECT 'tiktok_accounts', count(*) FROM tiktok_accounts
  UNION ALL SELECT 'client_credits', count(*) FROM client_credits
  UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations;"

echo
log "Compare os numeros acima com a producao:"
docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 'users' AS tabela, count(*) FROM users
  UNION ALL SELECT 'youtube_channels', count(*) FROM youtube_channels
  UNION ALL SELECT 'source_videos', count(*) FROM source_videos
  UNION ALL SELECT 'clips', count(*) FROM clips
  UNION ALL SELECT 'tiktok_accounts', count(*) FROM tiktok_accounts
  UNION ALL SELECT 'client_credits', count(*) FROM client_credits
  UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations;"

echo
log "Banco de teste '${TEST_DB}' continua no servidor pra inspecao."
log "Pra apagar depois: docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d postgres -c 'DROP DATABASE ${TEST_DB};'"

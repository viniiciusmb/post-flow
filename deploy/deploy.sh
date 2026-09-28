#!/usr/bin/env bash
# Publica o Post Flow na VPS propria (substitui o botao "Implantar" do EasyPanel).
# Roda NESTE Mac:
#
#   deploy/deploy.sh            publica o que esta no GitHub (origin/main)
#   deploy/deploy.sh --local    publica a pasta local como esta (so pra teste)
#   deploy/deploy.sh --force    publica mesmo com video sendo processado
#
# O que ele faz, em ordem:
#   1. recusa publicar se houver video no meio do processamento (a menos de --force)
#   2. envia o codigo pro servidor (git archive - o servidor nao precisa de
#      acesso ao GitHub)
#   3. constroi a imagem e troca os containers
#   4. roda as migrations IMEDIATAMENTE (regra operacional nº 1 do CLAUDE.md,
#      que antes dependia de alguem lembrar)
#   5. mostra erro dos ultimos segundos de log, se houver
set -euo pipefail

HOST="${POSTFLOW_HOST:-root@177.7.61.54}"
DIR=/opt/postflow
MODE=github
FORCE=0
for a in "$@"; do
  case "$a" in
    --local) MODE=local ;;
    --force) FORCE=1 ;;
    *) echo "opcao desconhecida: $a" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if [ "$FORCE" != 1 ]; then
  EM_ANDAMENTO=$(ssh "$HOST" "docker exec postflow_db psql -U postgres -d postflow -Atc \"SELECT string_agg(id || ':' || status, ' ') FROM source_videos WHERE status NOT IN ('ready','error','detected','cancelled','paused','aguardando_creditos','somente_membros')\"" 2>/dev/null || true)
  if [ -n "$EM_ANDAMENTO" ]; then
    echo "Tem video sendo processado agora: $EM_ANDAMENTO"
    echo "Publicar reinicia o video-worker (o pipeline retoma de onde parou)."
    echo "Rode de novo com --force se quiser publicar assim mesmo."
    exit 1
  fi
fi

if [ "$MODE" = github ]; then
  git fetch -q origin
  REF=origin/main
  SHA=$(git rev-parse --short "$REF")
  echo "Publicando $SHA ($(git log -1 --format=%s "$REF"))"
  PACOTE() { git archive --format=tar "$REF"; }
else
  SHA="local-$(git rev-parse --short HEAD)-$(date +%H%M%S)"
  echo "Publicando a pasta LOCAL ($SHA) - nao e o que esta no GitHub"
  # COPYFILE_DISABLE + --no-mac-metadata: sem isso o tar do macOS inclui um
  # "._arquivo" de metadados pra cada arquivo, e o oxlint do build do painel
  # quebra tentando ler esses binarios como codigo.
  PACOTE() { git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs --null -cf - -T -; }
fi

PACOTE | ssh "$HOST" "set -e
  rm -rf $DIR/app.new && mkdir -p $DIR/app.new
  tar -x -C $DIR/app.new
  echo '$SHA' > $DIR/app.new/.deploy-sha
  rm -rf $DIR/app.old
  [ -d $DIR/app ] && mv $DIR/app $DIR/app.old || true
  mv $DIR/app.new $DIR/app
  cp $DIR/app/deploy/compose.yml $DIR/app/deploy/Caddyfile $DIR/"

ssh "$HOST" "set -e
  cd $DIR
  docker compose build --pull
  docker compose up -d --remove-orphans
  echo 'Aguardando o web subir...'
  for i in \$(seq 1 60); do
    docker exec postflow_web node -e \"require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\" 2>/dev/null && break
    sleep 2
  done
  echo 'Rodando migrations...'
  docker exec postflow_web node scripts/migrate.js up
  docker image prune -f >/dev/null
  sleep 5
  echo '--- erros nos ultimos 60s:'
  for c in postflow_web postflow_worker postflow_video-worker; do
    docker logs --since 60s \$c 2>&1 | grep -iE 'error|erro' | tail -5 | sed \"s/^/\$c: /\" || true
  done
  docker compose ps --format 'table {{.Name}}\t{{.Status}}'"

echo "Publicado: $SHA"

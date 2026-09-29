#!/usr/bin/env bash
# Troca do Post Flow da VPS antiga (72.61.219.94, EasyPanel) para a nova
# (177.7.61.54, docker compose). Roda NESTE Mac - e o unico lugar com acesso
# aos dois servidores (de proposito: uma VPS nao tem acesso a outra).
#
#   virada.sh checar      confere tudo, nao muda nada
#   virada.sh ensaio      ensaia a fusao dos bancos num banco descartavel da
#                         nova, com a producao no ar (nao para nada)
#   virada.sh executar    a troca de verdade (desfaz sozinha se falhar antes
#                         de o site voltar)
#   virada.sh voltar      desfaz a troca (volta tudo pra antiga)
#   virada.sh status      em que etapa esta
#   virada.sh agendar "2026-09-30 03:00"   arma o gatilho automatico (launchd)
#   virada.sh cancelar    desarma o gatilho
#
# O gatilho das 3h (gatilho.sh + launchd) chama "executar --agendado", que se
# recusa a rodar fora da madrugada - se o Mac estiver dormindo as 3h e acordar
# as 9h, nada acontece com o site cheio de gente.
#
# Como a troca funciona (detalhes em docs/CHECKLIST_MIGRACAO_E_LIVES.md):
#   1. para os processos da antiga e troca o app dela por uma PONTE que repassa
#      o site pra nova (ponte/Caddyfile) - o site volta sem esperar o DNS;
#   2. o tunel do programa de bandeja e redirecionado no firewall da antiga
#      (ponte/tunel.sh) - o programa nao precisa ser reiniciado;
#   3. banco final = dump da antiga + migrations novas + dados vivos da conta
#      17 e do modulo de lives que estao na nova (mesclar.sql);
#   4. arquivos: so os que ainda vao ser usados (copiar-cortes.sh);
#   5. sobe a nova e confere; o vigia do DNS (dns-vigia.sh) liga o HTTPS dos
#      dominios reais quando o DNS for trocado.
set -Eeuo pipefail

ANTIGA=root@72.61.219.94
NOVA=root@177.7.61.54
DIR_NOVA=/opt/postflow
PONTE=/root/postflow-ponte
AQUI="$(cd "$(dirname "$0")" && pwd)"
ESTADO="$HOME/.postflow-virada"
LOG="$HOME/Library/Logs/postflow-virada.log"
mkdir -p "$ESTADO" "$(dirname "$LOG")"

SEGREDOS="NODE_ENV SESSION_SECRET APP_ENCRYPTION_KEY TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET TIKTOK_REDIRECT_URI GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI OPENAI_API_KEY ANTHROPIC_API_KEY ASAAS_API_KEY ASAAS_ENVIRONMENT ASAAS_WEBHOOK_TOKEN STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY UTMIFY_API_TOKEN YTDLP_PROXY_URL YTDLP_POT_PROVIDER_URL"

SSH_OPTS=(-o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o BatchMode=yes)
A() { ssh "${SSH_OPTS[@]}" "$ANTIGA" "$@"; }
N() { ssh "${SSH_OPTS[@]}" "$NOVA" "$@"; }

log()  { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG" >&2; }
fase() { echo "$1" > "$ESTADO/fase"; log "== etapa: $1"; }
fase_atual() { cat "$ESTADO/fase" 2>/dev/null || echo nenhuma; }
falha() { log "FALHOU: $*"; exit 1; }

SQL_EM_ANDAMENTO="SELECT count(*) FROM source_videos WHERE status NOT IN ('ready','error','detected','cancelled','paused','aguardando_creditos','somente_membros')"
SQL_CONTAGEM="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

psql_antiga() { A "D=\$(docker ps -qf name=postflow_db | head -1); docker exec -i \$D psql -U postgres -d postflow -At -v ON_ERROR_STOP=1" ; }
psql_nova()   { N "docker exec -i postflow_db psql -U postgres -d ${1:-postflow} -At -v ON_ERROR_STOP=1"; }

impressao_rele_antiga() { A 'R=$(docker ps -qf name=postflow_ssh-relay | head -1); docker exec $R ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub' | awk '{print $2}'; }
impressao_rele_nova()   { N 'ssh-keygen -lf /var/lib/postflow-relay/hostkeys/ssh_host_ed25519_key.pub' | awk '{print $2}'; }

hash_segredos() {
  # So o resumo (sha256) de cada segredo sai do servidor, nunca o valor.
  local quem=$1 cont=$2
  $quem "C=\$(docker ps -qf name=$cont | head -1); for v in $SEGREDOS; do printf '%s %s\n' \"\$v\" \"\$(docker exec \$C printenv \$v 2>/dev/null | sha256sum | cut -c1-16)\"; done"
}

# ---------------------------------------------------------------------------
checar() {
  local erros=0
  ok()   { log "  ok   $*"; }
  ruim() { log "  ERRO $*"; erros=$((erros+1)); }

  log "Conferindo as duas VPS..."
  A true && ok "acesso a antiga" || ruim "sem acesso a antiga"
  N true && ok "acesso a nova"   || ruim "sem acesso a nova"

  local servicos
  servicos=$(A "docker service ls --format '{{.Name}} {{.Replicas}}' | grep -E '^postflow_(web|worker|video-worker|ssh-relay|db) '" || true)
  for s in postflow_web postflow_worker postflow_video-worker postflow_db postflow_ssh-relay; do
    echo "$servicos" | grep -q "^$s 1/1" && ok "antiga: $s rodando" || ruim "antiga: $s nao esta 1/1"
  done
  A "docker service inspect postflow_web --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'" | grep -q '^caddy' \
    && ruim "antiga: postflow_web ja e a ponte (virada em andamento? use status/voltar)" || ok "antiga: postflow_web e o app"
  A "test -f $PONTE/Caddyfile && test -x $PONTE/tunel.sh && docker image inspect caddy:2 >/dev/null" \
    && ok "antiga: arquivos da ponte e imagem caddy:2 prontos" || ruim "antiga: falta arquivo da ponte ou a imagem caddy:2"
  A "$PONTE/tunel.sh status 2222" | grep -q desligado && ok "antiga: tunel ainda no rele antigo" || ruim "antiga: redirecionamento do tunel ja esta ligado"

  local c
  for c in postflow_db postflow_web postflow_worker postflow_video-worker postflow_caddy postflow_ssh-relay; do
    N "docker ps --format '{{.Names}}' | grep -qx $c" && ok "nova: $c rodando" || ruim "nova: $c parado"
  done
  N "grep -q ':8443' $DIR_NOVA/Caddyfile && test -f /usr/local/bin/postflow-backup" && ok "nova: entrada da ponte (8443) e backup instalados" || ruim "nova: Caddyfile sem a entrada 8443 ou sem script de backup"
  local livre
  livre=$(N "df -BG --output=avail / | tail -1 | tr -dc 0-9")
  [ "${livre:-0}" -ge 15 ] && ok "nova: ${livre} GB livres" || ruim "nova: so ${livre} GB livres"

  local ma mn
  ma=$(echo "SELECT count(*) FROM schema_migrations" | psql_antiga)
  mn=$(echo "SELECT count(*) FROM schema_migrations" | psql_nova)
  [ "$mn" -ge "$ma" ] && ok "migrations: antiga $ma, nova $mn" || ruim "migrations: a nova ($mn) esta atras da antiga ($ma)"

  diff <(hash_segredos A postflow_web) <(hash_segredos N postflow_web) >/dev/null \
    && ok "segredos (chaves de API, criptografia, sessao) identicos nos dois" \
    || { ruim "segredos DIFERENTES entre antiga e nova:"; diff <(hash_segredos A postflow_web) <(hash_segredos N postflow_web) | grep '^[<>]' | awk '{print "       " $2}' | sort -u | tee -a "$LOG" >&2; }

  [ "$(impressao_rele_antiga)" = "$(impressao_rele_nova)" ] \
    && ok "tunel: a nova tem a mesma identidade do rele antigo" \
    || log "  aviso tunel: identidade diferente (o rele antigo reiniciou?) - a virada copia de novo"

  local ip
  for d in postflowclips.com; do
    ip=$(dig +short A "$d" "@$(dig +short NS "$d" | head -1)" | tail -1)
    [ "$ip" = 72.61.219.94 ] && ok "DNS $d ainda na antiga (certo antes da virada)" || log "  aviso DNS $d -> $ip"
  done

  log "Conferencia: $erros erro(s)."
  return $erros
}

# ---------------------------------------------------------------------------
esperar_ociosidade() {
  local limite=$((SECONDS + 20 * 60)) a n
  while :; do
    a=$(echo "$SQL_EM_ANDAMENTO" | psql_antiga); n=$(echo "$SQL_EM_ANDAMENTO" | psql_nova)
    [ "$a" = 0 ] && [ "$n" = 0 ] && { log "Nenhum video processando."; return 0; }
    if [ $SECONDS -ge $limite ]; then
      log "Ainda ha video processando (antiga $a, nova $n) depois de 20 min - seguindo: o pipeline retoma de onde parou."
      return 0
    fi
    log "Video processando (antiga $a, nova $n) - aguardando..."
    sleep 30
  done
}

parar() {
  fase parando
  log "Nova: parando o app (banco, rele e Caddy continuam)."
  N "cd $DIR_NOVA && docker compose stop web worker video-worker live-worker" 2>&1 | tail -1
  fase nova_parada

  log "Antiga: guardando a configuracao dos servicos (pra desfazer) e parando os workers."
  A "docker service inspect postflow_web postflow_worker postflow_video-worker postflow_ssh-relay > $PONTE/servicos-antes-$CARIMBO.json"
  A "docker service scale -d postflow_worker=0 postflow_video-worker=0 >/dev/null"
  fase antiga_workers_parados
  local i
  for i in $(seq 1 30); do
    A "docker ps -q --filter name=postflow_worker --filter name=postflow_video-worker" | grep -q . || break
    sleep 3
  done

  log "Antiga: trocando o app pela ponte."
  fase antiga_ponte
  A "docker service update -q --image caddy:2 --entrypoint caddy --args 'run --config /etc/caddy/Caddyfile --adapter caddyfile' --mount-add type=bind,source=$PONTE,target=/etc/caddy,readonly=true postflow_web" >/dev/null
  sleep 5
  curl -s -m 20 --resolve postflowclips.com:443:72.61.219.94 https://postflowclips.com/ | grep -q 'trocando de servidor' \
    && log "Site mostrando a pagina de manutencao (pela ponte)." \
    || falha "a ponte nao respondeu com a pagina de manutencao"
}

tunel() {
  fase tunel
  log "Tunel: copiando as chaves autorizadas do rele antigo para o novo."
  A 'R=$(docker ps -qf name=postflow_ssh-relay | head -1); docker exec $R cat /home/tunnel/.ssh/authorized_keys' > "$ESTADO/chaves-antigas"
  N "docker exec postflow_ssh-relay cat /home/tunnel/.ssh/authorized_keys" > "$ESTADO/chaves-novas" || true
  cat "$ESTADO/chaves-antigas" "$ESTADO/chaves-novas" | sed '/^$/d' | awk '!visto[$0]++' \
    | N "docker exec -i postflow_ssh-relay sh -c 'cat > /home/tunnel/.ssh/ak.tmp && chown tunnel:tunnel /home/tunnel/.ssh/ak.tmp && chmod 600 /home/tunnel/.ssh/ak.tmp && mv /home/tunnel/.ssh/ak.tmp /home/tunnel/.ssh/authorized_keys'"
  rm -f "$ESTADO/chaves-novas"
  log "  $(wc -l < "$ESTADO/chaves-antigas" | tr -d ' ') chave(s) autorizada(s) copiada(s)."

  if [ "$(impressao_rele_antiga)" != "$(impressao_rele_nova)" ]; then
    log "Tunel: identidade do rele antigo mudou desde a preparacao - copiando de novo."
    A 'R=$(docker ps -qf name=postflow_ssh-relay | head -1); docker exec $R tar -C /etc/ssh -cf - ssh_host_ed25519_key ssh_host_ed25519_key.pub ssh_host_rsa_key ssh_host_rsa_key.pub' \
      | N 'tar -C /var/lib/postflow-relay/hostkeys -xf - && chmod 600 /var/lib/postflow-relay/hostkeys/*_key && docker restart postflow_ssh-relay >/dev/null'
    sleep 3
    [ "$(impressao_rele_antiga)" = "$(impressao_rele_nova)" ] || falha "identidade do rele nao bateu depois da copia"
  fi

  A "$PONTE/tunel.sh ligar 2222 && (R=\$(docker ps -qf name=postflow_ssh-relay | head -1); docker exec \$R pkill -f 'sshd: tunnel' || true)"
  log "Tunel: conexoes novas na antiga:2222 agora vao pra nova; o programa de bandeja reconecta sozinho."
}

dump() {
  fase dump
  N "mkdir -p /var/backups/postflow/virada"
  log "Dump final da antiga -> nova..."
  A 'D=$(docker ps -qf name=postflow_db | head -1); docker exec $D pg_dump -U postgres -Fc postflow' \
    | N "cat > /var/backups/postflow/virada/antiga-$CARIMBO.dump"
  local itens
  itens=$(N "docker exec -i postflow_db pg_restore --list < /var/backups/postflow/virada/antiga-$CARIMBO.dump | grep -c 'TABLE DATA'")
  [ "${itens:-0}" -gt 20 ] || falha "dump da antiga nao abre (so $itens tabelas)"
  log "  dump ok ($(N "du -h /var/backups/postflow/virada/antiga-$CARIMBO.dump | cut -f1"), $itens tabelas)."
  echo "$SQL_CONTAGEM" | psql_antiga > "$ESTADO/contagem-antiga-$CARIMBO.txt"

  log "Copia de seguranca do banco da nova (conta 17 + lives)..."
  N "docker exec postflow_db pg_dump -U postgres -Fc postflow > /var/backups/postflow/virada/nova-$CARIMBO.dump"
}

# Monta o banco final em $1 (postflow na virada, postflow_ensaio no ensaio),
# fundindo com o banco $2 (o da nova).
montar_banco() {
  local alvo=$1 origem_nova=$2 url
  log "Restaurando o dump da antiga em '$alvo'..."
  echo "CREATE DATABASE $alvo" | psql_nova postgres >/dev/null
  N "docker exec -i postflow_db pg_restore -U postgres -d $alvo --no-owner --exit-on-error < /var/backups/postflow/virada/antiga-$CARIMBO.dump"

  echo "$SQL_CONTAGEM" | psql_nova "$alvo" > "$ESTADO/contagem-restaurada-$CARIMBO.txt"
  if ! diff -q "$ESTADO/contagem-antiga-$CARIMBO.txt" "$ESTADO/contagem-restaurada-$CARIMBO.txt" >/dev/null; then
    if [ "$alvo" = postflow ]; then
      diff "$ESTADO/contagem-antiga-$CARIMBO.txt" "$ESTADO/contagem-restaurada-$CARIMBO.txt" | tee -a "$LOG" >&2
      falha "contagem restaurada difere da antiga"
    fi
    log "  (ensaio: antiga continua no ar, contagens mudaram durante o dump - normal)"
  else
    log "  contagens identicas as da antiga ($(wc -l < "$ESTADO/contagem-antiga-$CARIMBO.txt" | tr -d ' ') tabelas)."
  fi

  log "Aplicando as migrations novas em '$alvo'..."
  url=$(N "sed -n 's/^DATABASE_URL=//p' $DIR_NOVA/postflow.env" | sed "s#/postflow\$#/$alvo#")
  N "cd $DIR_NOVA && docker compose run --rm --no-deps -T -e DATABASE_URL='$url' web node scripts/migrate.js up" 2>&1 | tail -3 | tee -a "$LOG" >&2

  log "Fundindo os dados vivos da nova (conta 17 + lives)..."
  scp -q "$AQUI/mesclar.sql" "$NOVA:/tmp/virada-mesclar.sql"
  N "docker exec -i postflow_db psql -U postgres -d $alvo --single-transaction -v ON_ERROR_STOP=1 -v banco_nova=$origem_nova -q < /tmp/virada-mesclar.sql" 2>&1 \
    | sed 's/^psql:[^:]*:[0-9]*: //' | tee -a "$LOG" >&2
}

banco() {
  fase banco
  log "Nova: tirando o banco atual do caminho (fica guardado como postflow_nova_$CARIMBO)."
  printf "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postflow' AND pid <> pg_backend_pid();\nALTER DATABASE postflow RENAME TO postflow_nova_%s;\n" "$CARIMBO" | psql_nova postgres >/dev/null
  echo "$CARIMBO" > "$ESTADO/banco-renomeado"
  montar_banco postflow "postflow_nova_$CARIMBO"
}

subir() {
  fase subindo
  log "Nova: subindo tudo."
  N "cd $DIR_NOVA && docker compose up -d" 2>&1 | tail -2
  local i
  for i in $(seq 1 60); do
    N "docker exec postflow_web node -e \"require('http').get('http://localhost:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\"" 2>/dev/null && break
    sleep 2
  done
  N "docker exec postflow_web node scripts/migrate.js up" 2>&1 | tail -2 | tee -a "$LOG" >&2
  sleep 20

  log "Conferindo o site pela ponte (como um visitante com o DNS antigo)..."
  local corpo codigo
  corpo=$(curl -s -m 20 --resolve postflowclips.com:443:72.61.219.94 https://postflowclips.com/login -w '\n%{http_code}')
  codigo=$(echo "$corpo" | tail -1)
  { [ "$codigo" = 200 ] && ! echo "$corpo" | grep -q 'trocando de servidor'; } || falha "login pela ponte respondeu $codigo"
  [ "$(curl -s -m 20 --resolve postflowclips.com:443:72.61.219.94 -o /dev/null -w '%{http_code}' https://postflowclips.com/api/auth/me)" = 401 ] || falha "API nao respondeu como esperado"
  local ip
  ip=$(A "curl -s -m 10 -H 'X-Forwarded-For: 198.51.100.7' --connect-to 177-7-61-54.sslip.io:8443:177.7.61.54:8443 https://177-7-61-54.sslip.io:8443/__ponte/ip")
  [ "$ip" = 198.51.100.7 ] && log "  IP do visitante chega certo pela ponte." || falha "IP do visitante chegou errado pela ponte ($ip)"
  local ua un
  ua=$(grep '^users ' "$ESTADO/contagem-antiga-$CARIMBO.txt" | awk '{print $2}')
  un=$(echo "SELECT count(*) FROM users" | psql_nova)
  [ "$ua" = "$un" ] && log "  $un usuarios (igual a antiga)." || falha "usuarios: antiga $ua, nova $un"
  log "--- erros nos logs dos ultimos 60s:"
  N 'for c in postflow_web postflow_worker postflow_video-worker postflow_live-worker; do docker logs --since 60s $c 2>&1 | grep -iE "error|erro" | tail -3 | sed "s/^/  $c: /"; done' | tee -a "$LOG" >&2 || true
  fase no_ar
  log "SITE NO AR NA VPS NOVA (pela ponte)."
}

pos() {
  fase pos_virada
  log "Asaas: conferindo o aviso de pagamento (webhook)..."
  N "docker exec postflow_web node scripts/asaas-setup.js" 2>&1 | grep -E 'webhook|ativo|interrompida|eventos|Falhou' | tee -a "$LOG" >&2 || true

  log "Backup: levando a configuracao do Backblaze pra nova e rodando o primeiro backup."
  A "cat /etc/postflow-backup.env" | N "install -m 600 /dev/stdin /etc/postflow-backup.env"
  N "/usr/local/bin/postflow-backup >> /var/log/postflow-backup.log 2>&1; tail -3 /var/log/postflow-backup.log" | tee -a "$LOG" >&2 || log "  aviso: backup da nova falhou - ver /var/log/postflow-backup.log"
  A "crontab -l > $PONTE/crontab-antes-virada && grep -v postflow-backup $PONTE/crontab-antes-virada | crontab -"
  log "  backup diario da antiga desligado (banco dela ficou parado)."

  log "Vigia do DNS: instalando na nova."
  scp -q "$AQUI/dns-vigia.sh" "$NOVA:/usr/local/bin/postflow-dns-vigia"
  N "chmod +x /usr/local/bin/postflow-dns-vigia; systemctl stop postflow-dns-vigia 2>/dev/null; systemctl reset-failed postflow-dns-vigia 2>/dev/null; systemd-run --unit=postflow-dns-vigia --collect /usr/local/bin/postflow-dns-vigia >/dev/null"

  log "Tunel: aguardando o programa de bandeja reconectar na nova..."
  local i
  for i in $(seq 1 12); do
    N "docker logs --since 10m postflow_ssh-relay 2>&1 | grep -q 'Accepted publickey for tunnel'" && { log "  programa de bandeja conectado na nova."; break; }
    sleep 10
  done
  fase concluida
  cat <<FIM | tee -a "$LOG" >&2

==================================================================
 VIRADA CONCLUIDA. O site ja funciona na VPS nova (pela ponte).

 Falta so voce: no painel da Hostinger (DNS), trocar o registro A do postflowclips.com
   postflowclips.com   -> 177.7.61.54
   (postflowtiktok.com NAO: fica esquecido apontando pra antiga)
 (nao mexa em MX nem no www - o www segue o postflowclips.com)

 Nao tem pressa: a ponte segura o site ate o DNS propagar. Quando o
 DNS mudar, a nova liga o HTTPS dos dominios sozinha em ~1 minuto
 (acompanhar: ssh $NOVA journalctl -fu postflow-dns-vigia).

 Desfazer: deploy/virada/virada.sh voltar
==================================================================
FIM
}

# ---------------------------------------------------------------------------
voltar() {
  local f
  f=$(fase_atual)
  log "DESFAZENDO a virada (etapa em que parou: $f)."
  set +e
  if [ "$f" = concluida ] || [ "$f" = pos_virada ]; then
    log "Atencao: o site ja estava no ar na nova; o que foi gravado la depois disso NAO volta."
    N "systemctl stop postflow-dns-vigia 2>/dev/null"
  fi

  # Nova: app parado e banco de volta ao que era.
  N "cd $DIR_NOVA && docker compose stop web worker video-worker live-worker" >/dev/null 2>&1
  if [ -f "$ESTADO/banco-renomeado" ]; then
    local c; c=$(cat "$ESTADO/banco-renomeado")
    log "Nova: devolvendo o banco original (postflow_nova_$c)."
    printf "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('postflow','postflow_nova_%s') AND pid <> pg_backend_pid();\nALTER DATABASE postflow RENAME TO postflow_falhou_%s;\nALTER DATABASE postflow_nova_%s RENAME TO postflow;\n" "$c" "$(date +%H%M%S)" "$c" | psql_nova postgres
    rm -f "$ESTADO/banco-renomeado"
  fi
  if N "grep -q postflowclips $DIR_NOVA/sites.env"; then
    log "Nova: tirando os dominios reais do Caddy (o DNS precisa voltar pra 72.61.219.94!)."
    N "echo 'POSTFLOW_SITES=177-7-61-54.sslip.io' > $DIR_NOVA/sites.env && cd $DIR_NOVA && docker compose up -d --force-recreate caddy" >/dev/null 2>&1
  fi
  N "cd $DIR_NOVA && docker compose up -d" >/dev/null 2>&1

  # Antiga: tunel, app e workers de volta.
  A "$PONTE/tunel.sh desligar 2222; R=\$(docker ps -qf name=postflow_ssh-relay | head -1); docker exec \$R pkill -f 'sshd: tunnel' || true"
  if A "docker service inspect postflow_web --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'" | grep -q '^caddy'; then
    log "Antiga: devolvendo o app no lugar da ponte."
    A "docker service rollback -q postflow_web" >/dev/null
  fi
  A "docker service scale -d postflow_worker=1 postflow_video-worker=1 >/dev/null"
  A "test -f $PONTE/crontab-antes-virada && crontab $PONTE/crontab-antes-virada && rm $PONTE/crontab-antes-virada"
  sleep 15
  curl -s -m 20 --resolve postflowclips.com:443:72.61.219.94 -o /dev/null -w '%{http_code}' https://postflowclips.com/login | grep -q 200 \
    && log "Antiga de volta no ar." || log "ATENCAO: a antiga nao respondeu 200 no /login - conferir no EasyPanel."
  echo desfeita > "$ESTADO/fase"
  set -e
}

executar() {
  local agendado=${1:-}
  case "$(fase_atual)" in
    nenhuma|desfeita|ensaio_ok) ;;
    *) falha "ja existe uma virada na etapa '$(fase_atual)'. Use 'status' ou 'voltar'." ;;
  esac
  if [ "$agendado" = --agendado ]; then
    local hm; hm=$(TZ=America/Sao_Paulo date +%H%M)
    if [ "$hm" -lt 0245 ] || [ "$hm" -gt 0530 ]; then
      log "Gatilho disparou as $(TZ=America/Sao_Paulo date +%H:%M) (fora da madrugada) - NAO vou trocar de servidor com gente usando."
      exit 0
    fi
  fi
  CARIMBO=$(date -u +%Y%m%d_%H%M)
  echo "$CARIMBO" > "$ESTADO/carimbo"
  log "############ VIRADA $CARIMBO ############"
  checar || falha "conferencia inicial com erro - nada foi mudado."
  esperar_ociosidade

  # Qualquer saida com erro (comando que falha OU falha() explicito) entre aqui
  # e o site voltar desfaz tudo. Depois disso, desfazer vira decisao humana:
  # o site ja recebeu gente e o que foi gravado na nova se perderia.
  EM_RISCO=1
  trap 'rc=$?; if [ "${EM_RISCO:-0}" = 1 ]; then EM_RISCO=0; log "Algo falhou antes de o site voltar - desfazendo sozinho."; voltar; fi; exit $rc' EXIT
  parar
  tunel
  dump
  banco
  subir
  EM_RISCO=0
  # Arquivos DEPOIS de o site voltar: a internet deste Mac e lenta pra subir
  # arquivo, e os cortes so sao lidos na hora de postar (nao ha postagem de
  # madrugada). O gatilho ja adiantou quase tudo a 1h30.
  log "Arquivos: levando os cortes que ainda vao ser usados..."
  "$AQUI/copiar-cortes.sh" 2>&1 | tee -a "$LOG" >&2 || log "  AVISO: copia de arquivos incompleta - rodar de novo: deploy/virada/copiar-cortes.sh"
  pos
}

ensaio() {
  CARIMBO=ensaio_$(date -u +%Y%m%d_%H%M)
  log "############ ENSAIO $CARIMBO (nada e parado) ############"
  N "mkdir -p /var/backups/postflow/virada"
  A 'D=$(docker ps -qf name=postflow_db | head -1); docker exec $D pg_dump -U postgres -Fc postflow' \
    | N "cat > /var/backups/postflow/virada/antiga-$CARIMBO.dump"
  echo "$SQL_CONTAGEM" | psql_antiga > "$ESTADO/contagem-antiga-$CARIMBO.txt"
  echo "DROP DATABASE IF EXISTS postflow_ensaio" | psql_nova postgres >/dev/null
  if montar_banco postflow_ensaio postflow; then
    log "ENSAIO OK: a fusao funcionou e passou em todas as conferencias."
    echo ensaio_ok > "$ESTADO/fase"
  else
    log "ENSAIO FALHOU (ver acima)."
  fi
  if [ "${1:-}" = --manter ]; then
    log "Banco postflow_ensaio mantido (apague com: DROP DATABASE postflow_ensaio)."
  else
    echo "DROP DATABASE IF EXISTS postflow_ensaio" | psql_nova postgres >/dev/null
  fi
  N "rm -f /var/backups/postflow/virada/antiga-$CARIMBO.dump"
}

PLIST="$HOME/Library/LaunchAgents/com.postflow.virada.plist"

agendar() {
  # Copia os scripts pra fora do repositorio: se alguem trocar de branch ate
  # a hora marcada, o gatilho continua achando os arquivos.
  local horario=${1:?uso: virada.sh agendar "AAAA-MM-DD HH:MM"}
  date -j -f "%Y-%m-%d %H:%M" "$horario" +%s >/dev/null || falha "horario invalido: $horario"
  rm -rf "$ESTADO/scripts"; mkdir -p "$ESTADO/scripts"
  cp "$AQUI"/virada.sh "$AQUI"/gatilho.sh "$AQUI"/mesclar.sql "$AQUI"/copiar-cortes.sh "$AQUI"/dns-vigia.sh "$ESTADO/scripts/"
  chmod +x "$ESTADO/scripts/"*.sh
  echo "$horario" > "$ESTADO/horario"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.postflow.virada</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-dimsu</string>
    <string>/bin/bash</string><string>$ESTADO/scripts/gatilho.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)/com.postflow.virada" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  log "Gatilho armado: a virada roda sozinha em $horario (deixe o Mac na tomada e com a tampa aberta)."
}

cancelar() {
  rm -f "$ESTADO/horario"
  launchctl bootout "gui/$(id -u)/com.postflow.virada" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  log "Gatilho cancelado. Nada foi mudado nos servidores."
}

case "${1:-}" in
  agendar)  agendar "${2:-}" ;;
  cancelar) cancelar ;;
  checar)   checar ;;
  ensaio)   ensaio "${2:-}" ;;
  executar) executar "${2:-}" ;;
  voltar)   voltar ;;
  status)   echo "etapa: $(fase_atual)"; [ -f "$ESTADO/horario" ] && echo "gatilho armado para: $(cat "$ESTADO/horario")"; tail -20 "$LOG" 2>/dev/null ;;
  *) sed -n '2,22p' "$0"; exit 2 ;;
esac

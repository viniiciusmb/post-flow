#!/usr/bin/env bash
# Vigia do DNS da virada. Roda NA VPS NOVA (so mexe na configuracao dela).
#
# Enquanto o DNS aponta pra antiga, o site chega aqui pela ponte (porta 8443)
# e o Caddy NAO pode pedir certificado dos dominios reais: o Let's Encrypt
# conferiria na VPS antiga, falharia, e depois de 5 falhas por hora ele trava
# o dominio - o site ficaria sem HTTPS justamente quando o DNS virasse.
#
# Por isso cada dominio so entra no Caddy quando o servidor de DNS oficial
# (Hostinger) ja responde com o IP desta VPS. Ai o certificado sai na hora.
#
#   dns-vigia.sh            vigia ate os 3 dominios estarem com HTTPS aqui
#   dns-vigia.sh uma-vez    confere uma vez e sai
set -uo pipefail

IP_NOVA=177.7.61.54
DOMINIOS=(postflowclips.com postflowtiktok.com www.postflowclips.com)
TESTE=177-7-61-54.sslip.io
DIR=/opt/postflow
LIMITE_HORAS="${LIMITE_HORAS:-48}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

aponta_pra_ca() {
  local d=$1 ns ip servidores
  # Cada dominio tem os proprios servidores de DNS na Hostinger (os dois
  # dominios usam pares diferentes). Os servidores oficiais tem que concordar
  # (a Hostinger propaga a mudanca entre eles em segundos; basta um atrasado
  # pro Let's Encrypt consultar justamente ele).
  servidores=$(dig +short NS "${d#www.}" | sed 's/\.$//')
  [ -n "$servidores" ] || return 1
  for ns in $servidores; do
    ip=$(dig +short +time=3 +tries=2 A "$d" "@$ns" | grep -E '^[0-9.]+$' | tail -1)
    [ "$ip" = "$IP_NOVA" ] || return 1
  done
  return 0
}

https_ok() {
  curl -s -o /dev/null -m 15 --resolve "$1:443:127.0.0.1" -w '%{http_code}' "https://$1/" | grep -qE '^(2|3)'
}

ativos_no_caddy() {
  sed -n 's/^POSTFLOW_SITES=//p' "$DIR/sites.env" | tr ',' '\n' | tr -d ' '
}

rodada() {
  local d prontos=() atual desejado
  for d in "${DOMINIOS[@]}"; do
    aponta_pra_ca "$d" && prontos+=("$d")
  done
  desejado=$(printf '%s\n' "${prontos[@]}" "$TESTE" | sed '/^$/d' | sort -u | paste -sd, - | sed 's/,/, /g')
  atual=$(ativos_no_caddy | sort -u | paste -sd, - | sed 's/,/, /g')
  if [ "$desejado" != "$atual" ]; then
    log "DNS: ativando no Caddy -> $desejado"
    cp "$DIR/sites.env" "$DIR/sites.env.anterior"
    echo "POSTFLOW_SITES=$desejado" > "$DIR/sites.env"
    (cd "$DIR" && docker compose up -d --force-recreate caddy >/dev/null 2>&1)
    sleep 20
  fi
  local faltam=0
  for d in "${DOMINIOS[@]}"; do
    if printf '%s\n' "${prontos[@]}" | grep -qx "$d"; then
      if https_ok "$d"; then log "  $d: DNS aqui, HTTPS ok"; else log "  $d: DNS aqui, aguardando certificado"; faltam=1; fi
    else
      log "  $d: DNS ainda na antiga (a ponte atende)"; faltam=1
    fi
  done
  return $faltam
}

if [ "${1:-}" = "uma-vez" ]; then rodada; exit $?; fi

log "Vigia do DNS iniciado (ate ${LIMITE_HORAS}h)."
FIM=$(( $(date +%s) + LIMITE_HORAS * 3600 ))
while [ "$(date +%s)" -lt "$FIM" ]; do
  if rodada; then log "Tudo pronto: os 3 dominios respondem com HTTPS nesta VPS."; exit 0; fi
  sleep 30
done
log "Tempo esgotado sem os 3 dominios apontarem pra ca. A ponte continua atendendo."
exit 1

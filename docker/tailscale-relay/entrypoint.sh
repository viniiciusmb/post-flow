#!/bin/sh
# Sobe o containerboot oficial (entra na tailnet, expoe o SOCKS5 via
# TS_SOCKS5_SERVER) em segundo plano, e o nosso servidor de controle em
# primeiro plano (PID 1). Sidecar interno, sem usuario final interagindo
# direto - simplicidade aqui importa mais que um supervisor de processo
# "correto" com reaping de zumbi.
set -e

/usr/local/bin/containerboot &
exec node /control-server.js

#!/bin/sh
# Prepara o sshd isolado (chaves de host geradas na hora, nunca gravadas na
# imagem) e sobe ele em segundo plano; o servidor de controle (Node) roda em
# primeiro plano, mesmo padrao do docker/tailscale-relay/entrypoint.sh.
set -e

mkdir -p /home/tunnel/.ssh
touch /home/tunnel/.ssh/authorized_keys
chown -R tunnel:tunnel /home/tunnel/.ssh
chmod 700 /home/tunnel/.ssh
chmod 600 /home/tunnel/.ssh/authorized_keys

ssh-keygen -A

# -e manda o log do sshd pra stderr em vez de syslog (esse container nao
# tem syslog nenhum, entao sem -e as mensagens simplesmente desaparecem e
# nunca aparecem em `docker service logs` - foi assim que o bug da conta
# bloqueada ficou dificil de diagnosticar da primeira vez).
/usr/sbin/sshd -f /etc/ssh/sshd_config -D -e &
exec node /control-server.js

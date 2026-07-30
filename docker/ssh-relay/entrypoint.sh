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

/usr/sbin/sshd -f /etc/ssh/sshd_config -D &
exec node /control-server.js

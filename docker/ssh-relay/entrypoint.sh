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

# Chaves de host: geradas so na primeira vez e guardadas em /etc/ssh/hostkeys
# (volume). Regenerar a cada reinicio trocava a identidade do servidor, e o
# programa de bandeja (accept-new) passava a recusar a conexao.
# /home/tunnel/.ssh tambem e volume: sem ele, reiniciar o container apagava
# todas as chaves autorizadas e todo tunel pareado parava de funcionar.
mkdir -p /etc/ssh/hostkeys
[ -f /etc/ssh/hostkeys/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/hostkeys/ssh_host_ed25519_key
[ -f /etc/ssh/hostkeys/ssh_host_rsa_key ] || ssh-keygen -q -t rsa -b 3072 -N '' -f /etc/ssh/hostkeys/ssh_host_rsa_key

# -e manda o log do sshd pra stderr em vez de syslog (esse container nao
# tem syslog nenhum, entao sem -e as mensagens simplesmente desaparecem e
# nunca aparecem em `docker service logs` - foi assim que o bug da conta
# bloqueada ficou dificil de diagnosticar da primeira vez).
/usr/sbin/sshd -f /etc/ssh/sshd_config -D -e &
exec node /control-server.js

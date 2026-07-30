# Sidecar do tunel SSH reverso por cliente. sshd isolado (nunca e o SSH real
# da VPS) + um servidor de controle bem pequeno (Node) que o backend usa pra
# autorizar/revogar chaves - cada chave so pode abrir um proxy SOCKS numa
# porta especifica (restricao "permitlisten" do proprio OpenSSH), nunca um
# shell ou qualquer outro acesso.
FROM alpine:3.20

RUN apk add --no-cache openssh-server nodejs shadow \
  && adduser -D -h /home/tunnel -s /sbin/nologin tunnel

COPY sshd_config /etc/ssh/sshd_config
COPY control-server.js /control-server.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

# Sidecar do tunel SSH reverso por cliente. sshd isolado (nunca e o SSH real
# da VPS) + um servidor de controle bem pequeno (Node) que o backend usa pra
# autorizar/revogar chaves - cada chave so pode abrir um proxy SOCKS numa
# porta especifica (restricao "permitlisten" do proprio OpenSSH), nunca um
# shell ou qualquer outro acesso.
FROM alpine:3.20

RUN apk add --no-cache openssh-server nodejs shadow \
  && adduser -D -h /home/tunnel -s /sbin/nologin tunnel \
  && usermod -p '*' tunnel
# usermod -p '*' e essencial: "adduser -D" (sem senha) deixa a conta com o
# hash "!" (bloqueada de verdade), e o OpenSSH recusa login por chave nessa
# situacao com "account is locked" mesmo com a chave certa - "*" marca
# "sem senha valida, mas nao bloqueada", que e o que uma conta so-por-chave
# publica precisa. Sem isso nenhum tunel consegue autenticar (visto na
# pratica: "User tunnel not allowed because account is locked" no log do
# sshd, so aparece com log em modo debug/-e, nao vai pro `docker logs`
# comum porque o sshd registra via syslog e nao ha syslog nesse container).

COPY sshd_config /etc/ssh/sshd_config
COPY control-server.js /control-server.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

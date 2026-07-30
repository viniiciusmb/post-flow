# Sidecar do rele Tailscale por cliente. Estende a imagem oficial (que ja
# cuida de entrar na tailnet e expor um proxy SOCKS5 via containerboot) e
# adiciona um servidor de controle bem pequeno (Node) que o video-worker usa
# pra trocar QUAL aparelho (cliente) e usado como "saida" antes de cada
# download - a propria Tailscale nao tem variavel de ambiente pra isso, exige
# rodar `tailscale set --exit-node=...` contra o daemon ja rodando.
FROM tailscale/tailscale:latest

RUN apk add --no-cache nodejs

COPY control-server.js /control-server.js
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

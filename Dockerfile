# Etapa 1: build do frontend (React + Vite + shadcn/ui)
FROM node:20-alpine AS web-client-build
WORKDIR /app/web-client
COPY web-client/package.json web-client/package-lock.json* ./
RUN npm ci
COPY web-client/ ./
RUN npm run build

# Etapa 1b: build do programa de bandeja (tunel SSH do cliente) pros dois
# sistemas - fica sempre atualizado com o codigo em client-app/, sem
# precisar commitar binario grande no repositorio. Tambem empacota um
# OpenSSH portatil (Win32-OpenSSH) junto do .exe do Windows, ja que nao da
# pra confiar que todo cliente tem o OpenSSH do Windows instalado.
FROM golang:1.25-alpine AS client-app-build
RUN apk add --no-cache curl unzip zip
WORKDIR /app/client-app
COPY client-app/go.mod client-app/go.sum ./
RUN go mod download
COPY client-app/ ./
RUN GOOS=darwin GOARCH=arm64 go build -o /out/post-flow-tunnel-mac . \
  && GOOS=windows GOARCH=amd64 go build -ldflags="-H windowsgui" -o /out/post-flow-tunnel-windows.exe .
RUN mkdir -p /out/ssh-bin \
  && curl -L https://github.com/PowerShell/Win32-OpenSSH/releases/latest/download/OpenSSH-Win64.zip -o /tmp/openssh-win.zip \
  && unzip -j /tmp/openssh-win.zip "OpenSSH-Win64/ssh.exe" "OpenSSH-Win64/ssh-keygen.exe" -d /out/ssh-bin \
  && cd /out && zip -r post-flow-tunnel-windows.zip post-flow-tunnel-windows.exe ssh-bin

# Etapa 2: runtime - servidor Express + workers (postagem e video).
# Debian (nao Alpine) de proposito aqui: o binario standalone do yt-dlp e
# compilado pra glibc e pode falhar em cima do musl do Alpine.
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    mkdir -p /usr/local/bin/yt-dlp-plugins && \
    curl -L https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip -o /usr/local/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .
COPY --from=web-client-build /app/web-client/dist ./web-client/dist
COPY --from=client-app-build /out/post-flow-tunnel-mac ./src/web/public/downloads/post-flow-tunnel-mac
COPY --from=client-app-build /out/post-flow-tunnel-windows.zip ./src/web/public/downloads/post-flow-tunnel-windows.zip

CMD ["node", "src/web/server.js"]

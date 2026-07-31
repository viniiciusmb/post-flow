# Etapa 1: build do frontend (React + Vite + shadcn/ui)
FROM node:20-alpine AS web-client-build
WORKDIR /app/web-client
COPY web-client/package.json web-client/package-lock.json* ./
RUN npm ci
COPY web-client/ ./
RUN npm run build

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

CMD ["node", "src/web/server.js"]

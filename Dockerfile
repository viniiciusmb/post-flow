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

# fonts-liberation: equivalente metrico do Arial, que e o que os estilos de
# legenda sempre pediram. Sem ele, o container so tinha DejaVu e TODA legenda
# saia numa fonte que ninguem escolheu (o libass cai no que existe, em
# silencio - a tela prometia "Arial Black" e o video saia em DejaVu Sans).
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates curl fonts-liberation && \
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

# Fontes das legendas/titulos. Copiadas de dentro do repositorio (nao baixadas
# aqui) pra o build nao depender de rede - ver assets/fonts/LEIA-ME.md.
# fc-cache e obrigatorio: sem ele o libass nao enxerga as fontes novas e cai
# no DejaVu sem reclamar de nada.
RUN mkdir -p /usr/local/share/fonts/postflow && \
    cp /app/assets/fonts/*.ttf /usr/local/share/fonts/postflow/ && \
    fc-cache -f > /dev/null

CMD ["node", "src/web/server.js"]

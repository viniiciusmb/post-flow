# Etapa 1: build do frontend (React + Vite + shadcn/ui)
FROM node:20-alpine AS web-client-build
WORKDIR /app/web-client
COPY web-client/package.json web-client/package-lock.json* ./
RUN npm ci
COPY web-client/ ./
RUN npm run build

# Etapa 2: runtime - servidor Express (igual antes, mais os assets buildados)
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .
COPY --from=web-client-build /app/web-client/dist ./web-client/dist

CMD ["node", "src/web/server.js"]

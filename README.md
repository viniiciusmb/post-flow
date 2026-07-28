# Post Flow

SaaS de postagem automatica de videos no TikTok a partir do Google Drive, para multiplos clientes.

Este repositorio esta na **Fase 0**: esqueleto do projeto, banco de dados e login funcionando.
As integracoes com TikTok e Google Drive ainda nao existem — entram nas proximas fases.

**Em producao em https://postflowtiktok.com**, rodando na VPS via EasyPanel (Docker + Traefik).
Veja [docs/deployment-easypanel.md](docs/deployment-easypanel.md) para como esse deploy foi feito e
como atualizar. O guia de PM2/Docker Compose "puro" em
[docs/deployment-vps.md](docs/deployment-vps.md) continua valido como alternativa, mas nao e o que
esta rodando hoje.

## Como o projeto e organizado

- `src/web` — o servidor que serve os paineis (admin e cliente) e cuida do login.
- `src/worker` — processo separado que, nas proximas fases, vai checar o Drive e postar no TikTok em segundo plano.
- `src/repositories` — todo acesso ao banco de dados passa por aqui (um arquivo por tabela).
- `src/services` — regras de negocio (autenticacao, e futuramente TikTok/Drive).
- `migrations` — os arquivos SQL que criam as tabelas do banco, em ordem.
- `scripts` — comandos avulsos (rodar migrations, criar o primeiro usuario admin).

Dois processos rodam o tempo todo em producao: **web** (paineis) e **worker** (tarefas em segundo plano). Ambos compartilham o mesmo codigo e o mesmo banco de dados.

## Rodando localmente

### 1. Pre-requisitos

- Node.js 20 ou mais recente ([nodejs.org](https://nodejs.org)).
- Um banco PostgreSQL. Duas opcoes:
  - **Docker** (mais facil): instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/) e rode `docker compose up -d db` (sobe so o banco, sem a aplicacao).
  - **Postgres instalado direto na maquina**: crie um banco chamado `postflow`.

### 2. Configurar variaveis de ambiente

```bash
cp .env.example .env
```

Abra o `.env` e gere valores para `SESSION_SECRET` e `APP_ENCRYPTION_KEY` rodando duas vezes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cole um resultado em cada variavel. Se voce usou o Docker do passo anterior, o `DATABASE_URL` do `.env.example` ja funciona sem alteracao.

### 3. Instalar dependencias e criar as tabelas

```bash
npm install
npm run migrate
```

### 4. Criar o primeiro usuario admin

```bash
npm run seed:admin
```

Vai pedir um e-mail e senha no terminal — essas serao suas credenciais de admin.

### 5. Subir o servidor

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000) e entre com o e-mail/senha do admin. Para testar como cliente, use o link "Criar conta" na tela de login.

Para rodar o worker localmente (ainda nao faz nada alem de confirmar a conexao com o banco, na Fase 0):

```bash
npm run dev:worker
```

## Deploy na VPS (Hostinger)

Duas formas de rodar em producao — **PM2** (mais simples, recomendado) ou **Docker Compose** (se preferir tudo em containers). Detalhes completos em [docs/deployment-vps.md](docs/deployment-vps.md); resumo abaixo.

### Opcao A — PM2 (recomendado)

1. Na VPS, instale Node.js 20 e o PostgreSQL.
2. Clone o repositorio e rode `npm install --omit=dev`.
3. Crie o `.env` na VPS (mesmo processo do passo 2 acima, com o `DATABASE_URL` apontando para o Postgres da VPS).
4. Rode `npm run migrate` e `npm run seed:admin`.
5. Instale o PM2 globalmente: `npm install -g pm2`.
6. Suba os dois processos: `pm2 start ecosystem.config.js`.
7. Faca o PM2 iniciar sozinho ao reiniciar a VPS: `pm2 startup` (siga a instrucao que aparecer) e depois `pm2 save`.
8. Configure um proxy reverso com HTTPS (nginx + certbot, ou Caddy) apontando para a porta 3000 — isso e obrigatorio antes de conectar TikTok/Google, que exigem redirect URIs em HTTPS.

Para atualizar depois de um `git pull`: `npm install --omit=dev && npm run migrate && pm2 restart ecosystem.config.js`.

### Opcao B — Docker Compose

```bash
docker compose up -d --build
docker compose exec web npm run migrate
docker compose exec web npm run seed:admin
```

O `docker-compose.yml` ja sobe banco, web e worker juntos. Mesmo assim, um proxy reverso com HTTPS na frente (nginx/Caddy) continua sendo necessario para TikTok/Google.

## Proximos passos (fora do escopo desta fase)

1. **Fase 1** — conectar conta TikTok via OAuth por cliente.
2. **Fase 2** — monitorar as pastas do Google Drive e detectar videos novos.
3. **Fase 3** — fila que efetivamente posta os videos no TikTok (modo rascunho).
4. **Fase 4** — polimento dos paineis.

Quando chegarmos em cada fase, vou avisar exatamente quais credenciais pedir (TikTok Developer, Google Cloud) e o passo a passo para consegui-las.

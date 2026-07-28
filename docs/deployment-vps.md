# Deploy na VPS (Hostinger) — passo a passo

Este guia assume uma VPS Ubuntu limpa na Hostinger, com acesso SSH.

## 1. Preparar o servidor

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# nginx (proxy reverso + HTTPS)
sudo apt install -y nginx certbot python3-certbot-nginx

# PM2
sudo npm install -g pm2
```

## 2. Criar o banco de dados

```bash
sudo -u postgres psql -c "CREATE USER postflow WITH PASSWORD 'escolha-uma-senha-forte';"
sudo -u postgres psql -c "CREATE DATABASE postflow OWNER postflow;"
```

Use essa senha no `DATABASE_URL` do `.env` da VPS.

## 3. Colocar o codigo na VPS

```bash
git clone <url-do-seu-repositorio> post-flow
cd post-flow
npm install --omit=dev
cp .env.example .env
nano .env   # preencha DATABASE_URL, SESSION_SECRET, APP_ENCRYPTION_KEY etc.
npm run migrate
npm run seed:admin
```

## 4. Subir com PM2

```bash
pm2 start ecosystem.config.js
pm2 startup   # siga a instrucao impressa (copia/cola um comando com sudo)
pm2 save
```

Comandos uteis: `pm2 status`, `pm2 logs`, `pm2 restart ecosystem.config.js`.

## 5. Dominio + HTTPS (obrigatorio para TikTok/Google)

Aponte o DNS do seu dominio (registro A) para o IP da VPS. Depois:

```bash
sudo nano /etc/nginx/sites-available/post-flow
```

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/post-flow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SEU_DOMINIO
```

O certbot configura o HTTPS automaticamente e renova o certificado sozinho.

Depois disso, `https://SEU_DOMINIO/auth/tiktok/callback` e `https://SEU_DOMINIO/auth/google/callback` sao as URLs que voce vai cadastrar no TikTok Developer Portal e no Google Cloud Console (Fases 1 e 2).

## 6. Atualizando depois de mudancas no codigo

```bash
cd post-flow
git pull
npm install --omit=dev
npm run migrate
pm2 restart ecosystem.config.js
```

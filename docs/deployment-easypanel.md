# Deploy via EasyPanel (o que esta rodando em producao)

O Post Flow roda na mesma VPS Hostinger de outros projetos, gerenciada pelo **EasyPanel**
(painel que administra Docker + Traefik). Dominio em producao: **postflowtiktok.com**.

## Como esta organizado

Dentro do EasyPanel existe um projeto chamado **postflow**, com 3 servicos:

- **db** — banco Postgres gerenciado pelo proprio EasyPanel.
- **web** — o servidor Express (paineis admin/cliente). Fonte: este repositorio no GitHub
  (`viniiciusmb/post-flow`, branch `main`), build via `Dockerfile`. Dominio `postflowtiktok.com`
  apontando pra porta 3000, com HTTPS automatico (Let's Encrypt via Traefik).
- **worker** — mesmo repositorio/Dockerfile do `web`, mas sem dominio/porta publica. O comando
  de inicio foi sobrescrito (aba "Avancado" → campo "Comando") para `node src/worker/index.js`.

`web` e `worker` compartilham as mesmas variaveis de ambiente (colate na aba "Ambiente" de cada
um): `DATABASE_URL`, `NODE_ENV=production`, `PORT=3000`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`,
mais os campos `TIKTOK_*`/`GOOGLE_*` (vazios ate a Fase 1/2). O `DATABASE_URL` aponta pro
hostname interno `postflow_db` (padrao do EasyPanel: `<projeto>_<servico>`), nao precisa expor
o banco publicamente.

Como o EasyPanel/Docker Swarm ja reinicia containers que caem sozinho, **nao usamos PM2** nesse
caminho de deploy (diferente do guia em [deployment-vps.md](deployment-vps.md), que e pra uma VPS
sem EasyPanel).

## Como atualizar o codigo em producao

```bash
git add -A
git commit -m "sua mensagem"
git push origin main
```

Depois, em cada servico (`web` e `worker`) dentro do EasyPanel, clique em **Implantar** pra
gerar um novo build a partir do commit mais recente. (Auto Deploy automatico a cada push ainda
nao foi confirmado como ativado — por enquanto, o clique manual em Implantar e necessario.)

## Como rodar migrations em producao

Ainda nao existe um passo automatico pra isso dentro do deploy. Pra aplicar migrations novas,
pelo terminal da VPS:

```bash
ssh root@72.61.219.94
docker ps --filter name=postflow_web   # descobre o ID do container atual
docker exec <container_id> npm run migrate
```

## Acessos

- VPS: `ssh root@72.61.219.94`
- Painel do EasyPanel: `https://easypanel.viniiciusmb.com.br`
- Repositorio do codigo: `https://github.com/viniiciusmb/post-flow` (privado)

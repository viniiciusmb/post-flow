# Deploy via EasyPanel (o que esta rodando em producao)

O Post Flow roda na mesma VPS Hostinger de outros projetos, gerenciada pelo **EasyPanel**
(painel que administra Docker Swarm + Traefik). Dominio em producao: **postflowtiktok.com**.

## Como esta organizado

Dentro do EasyPanel existe um projeto chamado **postflow**, com estes servicos:

| Servico | O que e | Comando de inicio |
|---|---|---|
| `db` | Postgres 17 gerenciado pelo EasyPanel | — |
| `web` | Servidor Express + a SPA React. Dominio `postflowtiktok.com` → porta 3000, HTTPS automatico via Traefik | `node src/web/server.js` (padrao) |
| `worker` | Tarefas leves de fundo: checagem da pasta de origem no Drive, metricas, saude da VPS | `node src/worker/index.js` |
| `video-worker` | Pipeline pesado de video **e tudo que precisa ler arquivo de corte em disco** | `node src/worker/videoIndex.js` |
| `potprovider` | `bgutil-ytdlp-pot-provider` — gera o PO token que o YouTube exige de IP de servidor | — |
| `ssh-relay` | Sidecar de tunel SSH reverso por cliente (`docker/ssh-relay/`), porta TCP 2222 publicada | — |

**Os 3 processos de aplicacao (`web`, `worker`, `video-worker`) usam o MESMO repositorio
(`viniiciusmb/post-flow`, branch `main`) e o MESMO Dockerfile** — o que muda e o comando de
inicio, sobrescrito na aba "Avancado" → campo "Comando" de cada servico. Isso e importante: se
alguem subir so o `web`, o site abre normalmente e **nada funciona por baixo** (nenhum video
processa, nenhum corte e postado no TikTok, nenhuma exportacao pro Drive acontece, video travado
nunca se recupera).

### Por que `worker` e `video-worker` sao separados

O pipeline de video (yt-dlp + Whisper + Claude + ffmpeg) e pesado e demorado. Se ele morasse no
mesmo processo da checagem de Drive/metricas, uma renderizacao longa (ou um crash dela) travaria
tudo. Alem disso:

- **`web` e `video-worker` compartilham um volume** (`/tmp/post-flow-video` no container ↔
  `/var/lib/postflow-clips` no host). O `video-worker` escreve os cortes; o `web` precisa
  le-los pra mostrar preview/download no painel.
- **`worker` NAO tem esse volume.** Por isso qualquer job que precise ler ou escrever arquivo de
  corte tem que ser registrado no `videoScheduler.js` (video-worker), nunca no `scheduler.js`
  (worker). Hoje rodam no `video-worker`: processamento de video, publicacao no TikTok,
  exportacao pro Drive, limpeza de retencao, teste de tunel, reset semanal de credito,
  faturamento de excedente e recuperacao de video travado.

Como o EasyPanel/Docker Swarm ja reinicia containers que caem sozinho, **nao usamos PM2** nesse
caminho de deploy (o [`ecosystem.config.js`](../ecosystem.config.js) na raiz existe so pro caso
de recriar tudo numa VPS simples — ver [deployment-vps.md](deployment-vps.md)).

## Variaveis de ambiente

`web`, `worker` e `video-worker` compartilham praticamente as mesmas variaveis (aba "Ambiente"
de cada servico). A lista completa e comentada esta em [`.env.example`](../.env.example) na raiz
do repositorio — mantenha os dois em sincronia.

O `DATABASE_URL` aponta pro hostname interno `postflow_db` (padrao do EasyPanel:
`<projeto>_<servico>`), entao o banco nao precisa ser exposto publicamente.

## Como atualizar o codigo em producao

```bash
git add -A
git commit -m "sua mensagem"
git push origin main
```

Depois, em **cada** servico de aplicacao (`web`, `worker`, `video-worker`) dentro do EasyPanel,
clique em **Implantar** pra gerar um novo build a partir do commit mais recente. (Auto Deploy a
cada push ainda nao foi confirmado como ativado — por enquanto o clique manual e necessario.)

> Se `client-app/*.go` mudou, recompile os binarios do programa de bandeja **antes** do deploy —
> eles sao arquivos commitados em `src/web/public/downloads/`, nao sao gerados no build.
> Ver "Regra operacional nº 2" no `CLAUDE.md`.

### Depois de TODO deploy que inclua migration nova

```bash
ssh root@72.61.219.94 "docker ps --filter 'name=postflow_web' --format '{{.ID}}'"
ssh root@72.61.219.94 "docker exec <ID> node scripts/migrate.js up"
```

Isso ja quebrou a producao varias vezes por ter sido adiado. Ver "Regra operacional nº 1" no
`CLAUDE.md`.

### Gotcha do `ssh-relay`

Esse servico publica uma porta TCP no modo host (2222), e o Swarm nao consegue ter dois
containers segurando a mesma porta durante a troca. Ja foi corrigido permanentemente com:

```bash
docker service update --update-order stop-first postflow_ssh-relay
```

## Backup do banco

Um cron no host roda `/usr/local/bin/postflow-backup` todo dia as 03:15. Ver
[backups.md](backups.md) — inclui como conferir, como restaurar e como testar o restore sem
risco. O painel do admin (Metricas → Saude do servidor) mostra "Backup do banco: OK/atrasado/
falhou" pra que uma falha nao passe despercebida.

## Acessos

- VPS: `ssh root@72.61.219.94`
- Painel do EasyPanel: `https://easypanel.viniiciusmb.com.br`
- Repositorio do codigo: `https://github.com/viniiciusmb/post-flow` (privado)

## Comandos uteis de diagnostico

```bash
# o que esta rodando
docker service ls

# logs recentes de um servico (so erros)
docker service logs postflow_video-worker --since 10m | grep -i error

# tem video sendo processado agora? (checar ANTES de sugerir deploy)
docker exec $(docker ps -q -f name=postflow_web | head -1) node -e "
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(\"SELECT id, status FROM source_videos WHERE status NOT IN ('ready','error','detected','cancelled','paused','aguardando_creditos')\");
  console.log(JSON.stringify(r.rows));
  await c.end();
})();"
```

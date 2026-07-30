# Post Flow — guia para qualquer sessão do Claude Code neste projeto

Leia isto inteiro antes de mexer em qualquer coisa. O usuário é fundador não-técnico — decida por ele, explique em português simples, e só pergunte quando for uma decisão de negócio real (não uma dúvida técnica que dá pra resolver sozinho).

## O que é o Post Flow

SaaS que baixa vídeos de canais do YouTube (ou pasta do Drive) de um cliente, corta em clipes verticais com IA (Whisper transcreve, Claude escolhe os trechos, ffmpeg corta/legenda), e publica no TikTok do cliente. Multi-tenant: um admin, vários clientes, cada um com seus próprios canais/conta TikTok/Drive.

**Em produção**: https://postflowtiktok.com (EasyPanel/Docker Swarm na VPS Hostinger, ver `docs/deployment-easypanel.md` e a memória `post-flow-deployment`).

## Regra operacional nº 1 — NUNCA esquecer

**Toda vez que uma migration nova é implantada, rode `node scripts/migrate.js up` na produção IMEDIATAMENTE depois que o usuário confirmar o deploy — no mesmo turno, antes de fazer qualquer outra coisa.** Isso já quebrou a produção de verdade **três vezes** nesta mesma sessão (2026-07-29/30) porque essa etapa foi adiada ou esquecida — sempre parecia "nada funciona" / uma página inteira travada, quando na verdade era só o schema desatualizado. Não existe motivo pra adiar: é um comando só.

Sequência correta sempre que o usuário disser "implantei":
```
ssh root@72.61.219.94 "docker ps --filter 'name=postflow_web' --format '{{.ID}}'"
ssh root@72.61.219.94 "docker exec <ID> node scripts/migrate.js up"
```
Depois, dê uma olhada rápida nos logs (`docker service logs postflow_web --since 1m | grep -i error`) antes de dizer que está tudo certo.

## Antes de sugerir qualquer deploy

Cheque se há vídeo em processamento (não interrompa renderização em andamento sem avisar):
```
ssh root@72.61.219.94 "docker exec <ID_web> node -e \"
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(\\\"SELECT id, status FROM source_videos WHERE status NOT IN ('ready','error','detected','cancelled','paused')\\\");
  console.log(JSON.stringify(r.rows));
  await c.end();
})();
\""
```
Se algo aparecer, avise o usuário e deixe ele decidir (esperar terminar vs. aceitar perder o progresso — com pausar/retomar isso ficou bem menos grave, ver abaixo).

## Erros reais já cometidos nesta sessão — não repetir

1. **Esquecer de rodar migration depois do deploy** (3x) — ver regra nº 1.
2. **`ON CONFLICT (coluna)` parou de funcionar depois de uma migration trocar uma constraint UNIQUE por um índice único parcial** (`WHERE coluna IS NOT NULL`) sem atualizar o `ON CONFLICT` pra citar o mesmo predicado — quebrou a detecção de vídeo novo em canal silenciosamente por horas. Sempre que mexer numa constraint UNIQUE que vira índice parcial, procure todo `ON CONFLICT` que dependia dela.
3. **Um `child.on('error')` e `child.on('close')` do Node podiam disparar os dois pro mesmo processo filho que falhou no spawn** (ex: ffmpeg sumiu) — o segundo handler tentava apagar um arquivo temporário que o primeiro já tinha apagado, e o `fs.unlinkSync` sem try/catch derrubava o processo inteiro do `video-worker` (não só aquele corte). Corrigido com guarda `if (closed) return` + `fs.rm(..., {force:true})`. Fica como lembrete: qualquer `spawn()` de processo externo (ffmpeg, yt-dlp) precisa dos dois handlers ('error' e 'close') com guarda contra disparo duplo.
4. **Deploy que muda comportamento do worker sem testar contra dados reais o suficiente** — o pipeline de vídeo é caro (download+Whisper+Claude+ffmpeg) e qualquer bug nele só aparece rodando de verdade. Depois de qualquer mudança em `processVideoJob.js`, `videoEditingService.js` ou nos jobs de fundo, testar localmente com `node -e` chamando a função direto (não só `node --check`) é obrigatório — pegou 2 bugs reais que o `--check` não pegaria.

## Arquitetura (resumo — detalhes nas memórias `post-flow-architecture` e `post-flow-deployment`)

- **3 processos separados** rodando o mesmo código: `web` (Express + a SPA React em `web-client/`), `worker` (checagem de Drive + métricas, `src/worker/index.js`), `video-worker` (pipeline pesado de corte + tudo que precisa ler arquivo de clipe em disco: publicação no TikTok, exportação pro Drive, limpeza de retenção — `src/worker/videoIndex.js` → `videoScheduler.js`). `web` e `video-worker` compartilham um bind mount (`/tmp/post-flow-video` ↔ `/var/lib/postflow-clips` no host) — `worker` **não** tem esse mount, por isso qualquer job que precise ler/escrever arquivo de clipe tem que rodar no `video-worker`, não no `worker`.
- **pg-boss** é a fila de jobs (Postgres, sem Redis). Filas atuais: `youtube-channel-check`, `video-processing`, `video-error-retry`, `tiktok-posting`, `posting-cleanup`, `drive-export`, `drive-discovery`, `metrics-rollup`.
- **Pipeline de vídeo é retomável** (`processVideoJob.js`): se pausado/interrompido no meio, retomar pula download/transcrição/seleção de cortes já feitos e só continua os cortes que faltam renderizar. Nunca reintroduzir um "cancelar destrutivo" sem essa lógica — foi exatamente o que causava reprocessamento duplicado antes.
- **TikTok**: app ainda em modo **Sandbox** — publica em modo rascunho/inbox (o cliente final ainda abre o app TikTok e confirma manualmente). `TIKTOK_CLIENT_KEY`/`SECRET` em produção são os de Sandbox, não Produção (ver memória `post-flow-tiktok-oauth`). **Pendência do usuário, não é bug de código**: o connect estava dando erro de `scope` — o redirect URI bate certinho, então é configuração de Login Kit/Content Posting API no TikTok Developer Console que precisa ser conferida lá (não dá pra checar por aqui).
- **Google Drive**: cada cliente pode conectar o próprio Drive (`drive_connections`, multi-tenant). Duas direções independentes: pasta de **origem** (vídeo a processar, por cliente) e pasta de **destino** (clipe pronto exportado, por **canal** do YouTube — não por cliente, foi um pedido explícito de reestruturação). Escopo `drive.file` foi adicionado depois de `drive.readonly` já existir — clientes que conectaram antes dessa mudança precisam reconectar pra ganhar permissão de escrita.

## Como testar localmente antes de qualquer deploy

Usa embedded-postgres num diretório de scratchpad (não sobrescreve o Postgres de produção nem exige Docker local). Padrão usado a sessão inteira:
```bash
# subir postgres embarcado (fica num dir de scratchpad, não no repo)
node run.js   # dentro do dir do embedded-postgres, porta 55441

# aplicar migrations
DATABASE_URL="postgres://postgres:postgres@localhost:55441/postflow_test" node scripts/migrate.js up

# subir o servidor local
DATABASE_URL=... SESSION_SECRET=test-secret APP_ENCRYPTION_KEY=<hex 32 bytes> VIDEO_WORK_DIR=<dir scratchpad> PORT=3099 node src/web/server.js
```
Sempre testar os endpoints novos via `curl` com cookie de sessão, e sempre chamar as funções de job de fundo direto via `node -e` (não só confiar em `node --check`) — ver erro nº 4 acima.

Frontend: `cd web-client && npm run build` tem que passar sem erro de TypeScript antes de qualquer commit que toque `web-client/src`.

## Estado atual (2026-07-30)

Construído e em produção: canais do YouTube (auto/manual, com upload automático ou manual de clipe pro Drive por canal), upload direto de vídeo, corte com IA (3 modos: melhores partes / vídeo inteiro / quantidade fixa), título queimado opcional, capa/thumbnail, progresso % real por corte, descrição automática/fixa, pausar/retomar processamento de verdade, exclusão de vídeo, motor de publicação no TikTok (Fase 3: agendamento manual/automático, fila de prontos com legenda editável, retenção automática), retry automático de erro transitório.

Pendente / conhecido:
- Conexão TikTok quebrada por config de Sandbox no Developer Console (ver acima) — aguardando o usuário conferir lá.
- Nenhuma verificação end-to-end real de publicação no TikTok ainda aconteceu (só testado com token falso localmente) — precisa de uma conta Sandbox conectada de verdade pra validar o fluxo completo de init/upload/status.

Para o histórico completo de decisões e "porquês", ver a memória do projeto (arquivos em `~/.claude/projects/.../memory/`, carregados automaticamente) — especialmente `post-flow-architecture`, `post-flow-deployment`, `post-flow-project-status`, `post-flow-tiktok-oauth`, `post-flow-google-drive`, `feedback-run-migrations-immediately`.

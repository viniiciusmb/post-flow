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
4. **`child.kill('SIGKILL')` não mata processos que o próprio filho gerou** (ex: yt-dlp chama ffmpeg internamente pra juntar vídeo+áudio quando usa `--merge-output-format`) — o neto vira órfão e continua rodando, e o evento `'close'` do Node só dispara quando os descritores herdados fecham de vez, então o kill "não tinha efeito" até o órfão terminar sozinho (medido: 30s de atraso num teste onde devia ser quase instantâneo). Corrigido usando `spawn(cmd, args, { detached: true })` + matando o **grupo** de processos com `process.kill(-child.pid, 'SIGKILL')` em vez de `child.kill()`. Vale pra qualquer `spawn()` de um processo que possa gerar subprocessos próprios — teste sempre matando de verdade (`ps aux | grep` depois do kill), não só checando se a Promise rejeitou.
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

**Multi-conta TikTok por cliente** (migration 026, 2026-07-30): um cliente pode ter várias contas TikTok ativas ao mesmo tempo (antes só 1). Cada canal do YouTube vincula a UMA conta (`youtube_channels.tiktok_account_id`); vídeo avulso/upload escolhe uma ou mais no momento do envio (`source_video_tiktok_targets`); pasta-fonte do Drive do próprio cliente escolhe ao configurar em Configurações (`drive_folder_tiktok_targets`). Agendamento/postagem automática já eram por conta no schema (`posting_schedule_settings`), só a UI que era de 1 conta só — agora é `/api/client/tiktok-accounts/:id/...`. Página "Contas TikTok" virou multi-card. Configurações ganhou Perfil (nome/e-mail) e Trocar senha. Dashboard do cliente (rota `/client`, antes "Visão geral") ganhou contagem "cortes na fila". Métricas do admin ganharam card "Saúde do servidor (VPS)" com CPU/memória/disco (job `systemMetricsSampleJob` amostra a cada 5min via `os` nativo do Node + `df`, sem dependência nova — ver `src/lib/systemMetrics.js`).

**Correções 2026-07-30 (mesma sessão, depois do multi-conta):**
- **Pausar de verdade interrompe download/transcrição/render em andamento** (antes só parava entre etapas — se o cliente pausasse no meio de um download longo, só surtia efeito minutos depois quando a etapa terminasse sozinha). `checkCancelled` agora é passado pra dentro do `ytDlpService.downloadVideo`, `openaiTranscriptionService.transcribeAudio` e `videoEditingService.renderClip`, cada um conferindo a cada ~2s e matando o processo/abortando o fetch na hora. `PausedError` compartilhada em `src/lib/errors.js`.
- **Progresso % de cada corte não travava mais o worker**: a escrita do progresso no banco (dentro do polling do ffmpeg) não era aguardada nem tinha catch — um erro transitório de banco virava unhandled rejection e podia derrubar o `video-worker` inteiro, travando o % onde estava. Agora tem `.catch(logger.error)`.
- **Canal do YouTube que ficava pausado por um tempo e depois era retomado puxava TODOS os vídeos publicados durante a pausa de uma vez** (até 15, o teto do poll) — bug real, aconteceu em produção com o canal "Renato Cariani" (15 vídeos entraram de uma vez em 30/07, nenhum chegou a ser postado no TikTok já que a conexão TikTok desse cliente ainda não funciona, mas processou/gastou API à toa). Corrigido: `setActive(..., true)` agora avança `last_video_published_at` pra `now()` ao retomar.
- **Tela "Vídeos & Cortes" ganhou seleção múltipla + exclusão em lote** (`POST /api/client/source-videos/bulk-delete`), sem popup nativo de confirmação (confirmação inline no próprio botão, 2 cliques).

**Estilo de corte manual/interativo (migrations 027+028, 2026-07-30):** cliente escolhe Automático (padrão de sempre) ou Manual em "Vídeos & Cortes → Estilo visual do corte". Manual libera: enquadramento contínuo arrastando (`crop_zoom_percent` 0-100, um único filtro ffmpeg cobre o que antes eram 2 modos binários `crop`/`blur_pad` — ver `buildFilter` em `videoEditingService.js`), galeria visual de estilo de legenda **e também de título** (`title_style`, migration 028) com 2 presets novos "balão" (`bubble_dark`/`bubble_purple`, fundo colorido atrás do texto via ASS `BorderStyle=3`), e numeração opcional "Parte N" em 6 posições (mapeadas direto pro `Alignment` do ASS). `captionStyle`/`showTitle`/`titleSeconds`/`titleStyle` saíram da `VideoSettingsCard` (que agora só cobre qualidade/quantidade/descrição) e moraram pra dentro do `ClipStyleEditorCard`, só editáveis no modo Manual — pedido do usuário pra separar "qualidade do corte" de "estilo do corte".

O editor de enquadramento usa a metáfora de **moldura 9:16 fixa** (o resultado final, nunca muda de tamanho na tela) com o **retângulo do vídeo original (16:9) redimensionável por dentro dela** — não o contrário. Isso foi um pedido de correção do usuário depois de ver a primeira versão (que tinha a moldura invertida). O seletor de posição da numeração também foi redesenhado depois de feedback de "não entendi": em vez de uma grade abstrata de pontos, mostra uma mini-moldura com "Parte 1" de verdade em cada uma das 6 posições clicáveis.

Testado visualmente via Playwright headless (Chrome do sistema + `playwright-core`, sem instalar nada globalmente — ver histórico de sessão pra receita). Dois bugs reais achados nesse processo:
1. `PUT /api/client/video-settings` não devolvia `options` na resposta (só o `GET` devolvia) — qualquer save nessa tela quebrava a página em seguida (`Cannot read properties of undefined`). Corrigido com `toApiWithOptions()` compartilhado. Regra geral: qualquer endpoint que devolve objeto com sub-chave de opções fixas precisa devolver o mesmo formato em GET e PUT/POST quando o front reusa a resposta pra atualizar o estado inteiro.
2. **"Pausar" continuava lento mesmo depois da correção do checkCancelled** — causa raiz: `ytDlpService.run()` tentava de novo (até 4x: 2 tentativas × 2 proxies) mesmo quando o erro era um `PausedError`, porque o `catch` não distinguia pausa de falha de proxy de verdade. Corrigido propagando `PausedError` na hora, sem retry.

**Cuidado ao testar com Playwright headless neste projeto:** cada `chromium.launch()` que não fecha (script que crasha no meio) deixa processo do Chrome zumbi. Depois de várias rodadas de teste isso acumulou 60+ processos e distorceu completamente o timing das interações seguintes (drag/save pareciam "bugados" de forma não-determinística quando na verdade era só contenção de recursos) — sempre `pkill -9 -f "Google Chrome"` entre lotes de teste, e nunca confiar num resultado "flaky" sem antes checar `ps aux | grep Chrome` pra ver se não é isso.

**Correções e organização 2026-07-30 (mesma sessão, depois do estilo de corte):**
- **Bug real achado e corrigido em `ScheduleCard`**: o campo de horário (`<input type="time">`) chamava `save()` a cada tecla/ajuste do seletor nativo, sem debounce — requisições concorrentes podiam terminar fora de ordem e a mais lenta "vencer" com um valor antigo, dando a impressão de que o horário não salvava. Corrigido com rascunho local + salvamento só no `onBlur` (mesmo padrão pro campo "quantos por dia"). Confirmado em produção que os horários já configurados (`08:00/12:00/16:00/20:00`) realmente estavam persistidos — o bug era uma condição de corrida, não perda de dado garantida.
- **Pausar/retomar: botão agora mostra "Pausando.../Retomando..." até o SERVIDOR confirmar** (antes revertia pra "Pausar" assim que a chamada da API respondia, o que é quase instantâneo — só seta uma flag no banco — bem antes do worker realmente notar e parar, dando a impressão de "não fez nada"). Estado local (`pauseRequested`/`resumeRequested`) só reseta quando `video.status` muda de verdade (via polling já existente).
- **"Vídeos & Cortes" e "Contas TikTok" reorganizados em abas** (`components/ui/tabs.tsx`, já existia no design system): "Em andamento"/"Prontos" na primeira, "Fila"/"Postados" na segunda.
- **Fila de postagem agora mostra "Vai postar hoje às HH:MM" / "amanhã às HH:MM" em cada corte**, calculado por `src/lib/postingSchedule.js` (simula pra frente a mesma lógica reativa do `tiktokPostingJob.js` - modo manual cicla pelos horários configurados, modo automático espaça dentro da janela 8h-22h). É uma estimativa de exibição, não uma garantia (o job de verdade é reativo); horário já passado hoje mas ainda não consumido vira "agora" em vez de mostrar hora no passado.
- **Confirmado**: retenção automática de cortes já postados (7 dias por padrão, configurável em Contas TikTok) já existia e está ativa (`postingCleanupJob`, roda de hora em hora) — não precisou de mudança, só verificação.

**Investigação 2026-07-30 (produção real, cliente `viniciusmoreira157@gmail.com`) — por que não posta e não salva no Drive sozinho:**
- **TikTok não posta automaticamente**: NÃO é bug de código. `tiktokPostingJob.js` roda certinho a cada 10min e tenta publicar, mas a TikTok recusa com `"The user did not authorize the scope required for completing this request."` mesmo com `video.publish` presente no array `scopes` salvo no banco (confirmado via SELECT direto). Isso é o gotcha conhecido da Content Posting API da TikTok: o escopo aparecer concedido no token OAuth **não é a mesma coisa** de o app ter o **produto "Content Posting API" habilitado/aprovado** no Developer Console (é uma config de app separada da lista de escopos do Login Kit). Pendente do usuário conferir isso no Developer Console — não dá pra checar/corrigir por aqui.
- **Drive não exporta sozinho**: também NÃO é bug — comportamento esperado do design existente. De 3 canais do cliente, 2 (`TOGURO`, `Renato Cariani`) estão com `drive_export_mode='manual'` (padrão do sistema, cliente precisa clicar "Fazer upload no Drive" corte a corte) e tinham dezenas de cortes prontos nunca clicados; o terceiro (`Aqueles Caras`) está em `'auto'` mas ainda não tem nenhum corte pronto gerado. Perguntar pro usuário se quer que eu troque os 2 canais manuais pra `'auto'` (dá pra fazer direto pela tela "Canais do YouTube", ou eu faço via banco se pedir).

**Relé Tailscale (2026-07-30) — construído ERRADO, precisa refazer.** Primeira versão assumiu um único aparelho do dono do sistema como "saída" (exit node) compartilhado por todos os clientes (página admin, `YTDLP_TAILSCALE_PROXY_URL` único). **Usuário corrigiu**: o desenho certo é cada CLIENTE instalar o Tailscale no aparelho dele e permitir que o SISTEMA use o IP DELE (do cliente) - não o do dono do Post Flow -, e a página tem que ficar no menu do CLIENTE, não do admin. Ainda não redesenhado; falta decidir com o usuário o mecanismo técnico exato antes de mexer de novo (ver "Pendente" abaixo) - já errei essa arquitetura uma vez, não adivinhar de novo sem confirmar.

**Correções 2026-07-30 (mesma sessão, depois da investigação TikTok/Drive):**
- **Bug real corrigido em `tiktokAccountsApiController.setSchedule`**: trocar o modo pra "Automático" **apagava os horários manuais configurados** no banco (`manualTimes: mode === 'manual' ? manualTimes : []` - forçava array vazio sempre que o modo não era manual). Cliente relatou perder a configuração ao clicar sem querer em "Automático". Corrigido removendo o ternário - `manual_times` agora é sempre salvo como veio, independente do modo (o frontend já mandava o array certo mesmo em modo automático, só o backend jogava fora). Testado localmente via chamada direta ao repositório: configurar manual → trocar pra auto → voltar pra manual → horários continuam lá.
- **Botão "Exportar todos os cortes pro Drive" no nível do vídeo** (`ExportAllToDriveButton` em `VideosClipsPage.tsx` + `POST /api/client/source-videos/:id/export-all-to-drive`): antes só dava pra exportar corte a corte. Aparece só quando o canal tem pasta de destino configurada e há pelo menos um corte pronto ainda não exportado; envia todos de uma vez e mostra quantos foram (`exported`/`failed`/`total`). Testado localmente com dados reais no Postgres (vídeo com 4 cortes: 2 exportados com sucesso, 1 com arquivo ausente no disco tratado como falha sem derrubar os outros, 1 já exportado antes ignorado corretamente).

Pendente / conhecido:
- Conexão TikTok quebrada por config de Sandbox/Content Posting API no Developer Console (ver investigação acima) — aguardando o usuário conferir lá. Comuniquei isso pro usuário no chat (antes só estava registrado aqui).
- Nenhuma verificação end-to-end real de publicação no TikTok ainda aconteceu.
- 2 canais do cliente real estão em modo manual de export pro Drive com cortes prontos acumulados nunca enviados — perguntei se quer trocar pra automático (ou agora pode usar o botão novo de exportar tudo de uma vez sem mudar o modo).
- Os 15 vídeos do canal "Renato Cariani" que entraram errado na fila (ver acima) continuam em produção (8 prontos com cortes gerados, 7 com erro) — ninguém apagou ainda, perguntar pro usuário se quer limpar (agora dá pra fazer isso direto pela tela, checkbox sempre visível em cada vídeo + "Excluir selecionados").
- O enquadramento contínuo e os presets "balão"/título só foram validados testando a STRING do filtro ffmpeg gerada (com um ffmpeg falso que só loga os argumentos, já que este ambiente de sandbox não tem ffmpeg instalado) — nunca foram vistos rodando com ffmpeg de verdade. Primeira vez que um vídeo real passar pelo modo Manual, vale conferir visualmente o resultado.
- **Tailscale por cliente: PAUSADO por custo, não por dificuldade técnica.** Planejei e comecei a construir (plano em `~/.claude/plans/mossy-cuddling-mountain.md`, migration `029_client_tailscale.sql`, `docker/tailscale-relay/` já testado localmente, `clientTailscaleConnectionsRepository.js`, `tailscaleRelayService.js` — nenhum desses arquivos está ligado ao app ainda, é código morto/dormant por enquanto). Descoberta importante no meio do caminho: o app do Tailscale no CELULAR não aceita entrar na rede via chave (auth key) como no desktop/CLI — só login de conta (Google/Microsoft/e-mail). Pra colocar o celular de cada cliente na NOSSA rede, o mecanismo certo é convidar cada um como "usuário" pelo console do Tailscale, e confirmei no site deles que isso **custa US$8/mês por pessoa convidada** no plano pago (o plano grátis é só pra uso pessoal, não serve pra um SaaS convidando clientes). Perguntei ao usuário como queria proceder sabendo desse custo recorrente por cliente conectado — ele pediu pra **parar tudo isso por ora** e focar em melhorar o bloqueio do YouTube por outros meios gratuitos primeiro (ver abaixo). Não mexer nisso de novo sem o usuário pedir explicitamente.
- **Melhorias no bloqueio do YouTube (2026-07-30, `ytDlpService.js`)**: revisão confirmou que o POT provider (`postflow_potprovider`) já está rodando em produção e resolve quase todo vídeo, mas cookie sozinho é contraproducente (força o client "web", que o YouTube trava via SABR) — por isso cookie e POT eram mutuamente exclusivos no código antes, o que nunca deixou a combinação "cookie autenticado + POT + client explícito não-web" ser testada. Implementado: (1) cookie agora é somado ao POT em vez de mutuamente exclusivo, (2) client explícito via `--extractor-args youtube:player_client=<android|tv>` tentado em sequência quando o padrão falha (mira exatamente no "gap conhecido" de vídeos que caem num nível de checagem mais rigoroso, ex: canal "Renato Cariani"), (3) espera aleatória de 10-40s antes de cada download real (não na listagem, que é leve) pra evitar padrão de rajada. Testado localmente com um `yt-dlp` falso (confirma retry com client diferente quando o padrão falha, cookie+POT+client juntos no mesmo comando, e pausa instantânea mesmo durante a espera). **Falta**: usuário vai fornecer um `cookies.txt` de uma conta Google dedicada pra testar a combinação de verdade contra vídeos reais na VPS.

Para o histórico completo de decisões e "porquês", ver a memória do projeto (arquivos em `~/.claude/projects/.../memory/`, carregados automaticamente) — especialmente `post-flow-architecture`, `post-flow-deployment`, `post-flow-project-status`, `post-flow-tiktok-oauth`, `post-flow-google-drive`, `feedback-run-migrations-immediately`.

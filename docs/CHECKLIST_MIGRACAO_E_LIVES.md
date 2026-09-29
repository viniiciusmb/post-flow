# Checklist — migração do Post Flow e módulo de cortes de lives

Memória de trabalho deste projeto. **Reler antes de continuar.** Itens nunca são
apagados: só marcados (`- [x]`) ou anotados. Segredos aparecem só pelo nome da
variável.

## Decisões do Vinicius que mudaram a ordem original

- **28/09/2026 — a migração está PAUSADA.** A VPS nova foi montada e testada
  (fases 1 e 2 quase completas), mas a troca não acontece agora. Primeiro vêm
  mais testes nela.
- **28/09/2026 — a VPS nova tem só a conta `risestyle43@gmail.com`** (e o login
  do admin, sem dados próprios, porque a funcionalidade nova só aparece para o
  admin). Os outros 67 usuários e os cortes deles foram apagados **da cópia de
  teste**. A produção não foi tocada.
- **28/09/2026 — o módulo de lives começa ANTES da migração**, na VPS nova,
  visível só para o admin. O prompt original mandava fazer depois da Fase 3.
- **28/09/2026 — sem EasyPanel na VPS nova.** O deploy é feito por comando
  (`deploy/deploy.sh`), não por botão.
- **28/09/2026 — migrar só o Post Flow.** Evolution/n8n, minerador, Interactive
  Lives e tiktok-platform ficam na VPS antiga.
- **28/09/2026 (correção do Vinicius ao item acima sobre o risestyle43):** não é
  só copiar os dados — **a conta `risestyle43` passou a ser PROCESSADA E
  PUBLICADA pela VPS nova, de verdade, a partir de 28/09 ~21:30 UTC.** Feito assim:
  1. backup de produção (`/usr/local/bin/postflow-backup`, com cópia no B2) antes de tudo;
  2. na VPS ANTIGA, a conta foi **pausada, não apagada** (tokens mantidos):
     canais 20/30/31 `is_active=false`, contas TikTok 27/28/30 `is_active=false`,
     agendas `paused=true`, 14 postagens pendentes → `skipped`. Lista exata dos
     IDs guardada fora do repositório (scratchpad da sessão, `rise_estado_antes.txt`);
  3. dump novo da produção → VPS nova, filtrado para `risestyle43` (17) + login do
     admin (1, sem dados), fila do pg-boss limpa, e lá **religado exatamente o
     que foi pausado na antiga** (3 canais, 3 contas, 3 agendas, 14 postagens);
  4. cortes da conta copiados (arquivos das 14 postagens conferidos um a um);
  5. VPS nova trocada para as chaves reais (hash conferido contra a produção);
     tokens do TikTok testados com consulta só de leitura: as 3 contas respondem;
  6. backup diário na VPS nova (cron 03:15, **só local** por enquanto — não manda
     pro B2 pra não misturar com os backups da produção).
  - **Cuidado na migração final:** o dado vivo do `risestyle43` está na VPS
    NOVA. O dump final da antiga traria a versão pausada e velha dele — a troca
    tem que preservar as linhas desta conta que estão na nova.
  - **Para desfazer:** religar na antiga os IDs acima (`is_active=true`,
    `paused=false`, postagens de volta a `pending`) e desligar os canais/contas
    na nova — nunca os dois ligados ao mesmo tempo (postaria em dobro).
  - Acesso da conta na VPS nova: `https://177-7-61-54.sslip.io` (mesma senha).
    Conectar conta nova do TikTok/Google por lá **ainda não funciona**: o retorno
    do OAuth (`*_REDIRECT_URI`) aponta para `postflowclips.com`, que é a antiga.

## Onde o prompt original não bate com a realidade (regra 9)

| O prompt supõe | O que existe de verdade | Consequência |
|---|---|---|
| PM2 + nginx no Post Flow | Post Flow roda em **Docker** (Swarm via EasyPanel na antiga; `docker compose` na nova). Proxy é Traefik (antiga) / **Caddy** (nova). | "Processos PM2 separados" vira **container separado** com limite de CPU/memória. |
| Redis ou fila | **pg-boss** (fila dentro do próprio Postgres). Não há Redis no Post Flow. | Workers de lives usam filas novas no pg-boss. |
| Stripe | Pagamento principal hoje é o **Asaas**; Stripe só atende quem cadastrou cartão antes de 31/08/2026. | Irrelevante para o teste de lives (só admin). |
| "Só API da OpenAI" | A escolha de cortes do YouTube usa **Claude (`claude-sonnet-5`)**. A transcrição já é OpenAI (`whisper-1` com tempo por palavra). | Lives vai usar só OpenAI, como pedido. O fluxo do YouTube continua com Claude — não muda. **Pergunta aberta 1.** |
| Servidor de 8 vCPU / 16–32 GB / 300 GB | A VPS nova tem **2 vCPU / 7,8 GB / 96 GB** (KVM 2, Boston). | Ver cálculo de disco na Fase 4. **Pergunta aberta 2.** |
| streamlink talvez já exista | **Não existe** em nenhuma das duas VPS nem na imagem. A imagem também não tem Python. | Instalar o streamlink na imagem pelo AppImage oficial (traz o próprio Python). |
| App da Twitch talvez exista | Não há nenhuma variável `TWITCH_*` configurada. | **Ação do Vinicius**: criar o app em dev.twitch.tv. |

## Perguntas abertas para o Vinicius

**Respondidas em 28/09/2026:**
- 1 → **Sim.** O fluxo atual continua exatamente igual (Claude escolhe os cortes
  do YouTube). Só o fluxo novo da Twitch usa OpenAI, e tudo nele numa IA só.
- 2 → **Fica a VPS de 2 núcleos** para validar; aumento decidido depois, quando
  for necessário. Portanto: 480p, retenção curta e poucos canais simultâneos.
- 3 → **Client ID recebido** e guardado como `TWITCH_CLIENT_ID`. Falta o
  `TWITCH_CLIENT_SECRET`, que vai direto para o servidor, não pelo chat.

Texto original das perguntas:

1. Tudo bem as lives usarem só OpenAI enquanto o fluxo do YouTube continua com
   o Claude? (Recomendação: sim. Mexer no fluxo do YouTube está fora do escopo.)
2. A VPS nova aguenta o teste de 1 canal com folga, mas **não** 5 canais com 48 h
   de retenção a 720p (ver Fase 4). Aceita começar com 480p, retenção de 24 h e
   no máximo 2 canais gravando ao mesmo tempo? Ou prefere subir o plano da VPS?
3. Criar o app da Twitch (dev.twitch.tv → Your Console → Applications →
   Register Your Application; OAuth Redirect `http://localhost`, categoria
   "Application Integration", tipo Confidential) e me mandar o **Client ID**. O
   **Client Secret** vai direto para o servidor, não pelo chat (eu explico como
   na hora).

---

## Inventário (Fase 0) — feito em 28/09/2026, somente leitura

### VPS antiga — `72.61.219.94` (`srv1084151`, São Paulo)
- Ubuntu 24.04, **2 vCPU**, 7,8 GB RAM, 96 GB de disco (36 GB usados, 61 GB livres), fuso UTC.
- **Post Flow** (EasyPanel, Docker Swarm), projeto `postflow`:
  `postflow_db` (Postgres 17, 41 MB), `postflow_web`, `postflow_worker`,
  `postflow_video-worker`, `postflow_potprovider`, `postflow_ssh-relay` (porta 2222).
  Traefik do EasyPanel serve `postflowtiktok.com`, `postflowclips.com`,
  `www.postflowclips.com` (Let's Encrypt automático).
- **Outros projetos (não mexer):**
  - **Interactive Lives** — `/root/tiktok-platform/backend` (PM2 `backend`,
    porta 4000, usa `tiktok-live-connector`); nginx na porta 8443 com
    certificados certbot de `api.interactivelive.online` e `api.interactivelivegames.com`.
  - `minerador` — `/root/minerador/backend` (PM2, porta 3001).
  - EasyPanel projeto `vendas`: Evolution API + Postgres + Redis, n8n (parado) + Redis + redis-commander.
- **Dependências entre Post Flow e os outros:** nenhuma de dado. Não compartilham
  banco, pasta, processo nem Redis. Compartilham só a máquina, o Docker/EasyPanel
  (com vendas) e a porta 80/443 (Traefik do EasyPanel).
- Cron do host: `15 3 * * * /usr/local/bin/postflow-backup` (dump diário + cópia no Backblaze B2, config em `/etc/postflow-backup.env`).
- Arquivos gerados: pasta local `/var/lib/postflow-clips` (16 GB), montada em
  `web` e `video-worker`. Sem S3/R2.
- Versões (imagem do app): Node 20.20, ffmpeg 5.1.9, yt-dlp 2026.08.19. Sem Python, sem streamlink.
- Variáveis do Post Flow (só nomes): `DATABASE_URL NODE_ENV PORT SESSION_SECRET
  APP_ENCRYPTION_KEY TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET TIKTOK_REDIRECT_URI
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI OPENAI_API_KEY
  ANTHROPIC_API_KEY YOUTUBE_COOKIES_BASE64 YTDLP_PATH VIDEO_WORK_DIR
  YTDLP_POT_PROVIDER_URL YTDLP_PROXY_URL TUNNEL_RELAY_CONTROL_URL
  TUNNEL_RELAY_SOCKS_HOST TUNNEL_RELAY_PUBLIC_HOST TUNNEL_RELAY_PUBLIC_PORT
  STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY
  ASAAS_API_KEY ASAAS_ENVIRONMENT ASAAS_WEBHOOK_TOKEN UTMIFY_API_TOKEN`.
  Na antiga ficam na aba "Ambiente" do EasyPanel; na nova, em `/opt/postflow/postflow.env*` (chmod 600).
- Integrações que dependem de URL/IP: OAuth do TikTok e do Google
  (`https://postflowclips.com/auth/.../callback`), webhook do Asaas e da Stripe
  (`https://postflowclips.com/api/...`) — todos por **domínio**, então a troca de
  IP não exige mexer neles. A única coisa presa a **IP** é
  `TUNNEL_RELAY_PUBLIC_HOST=72.61.219.94` (endereço que o programa de bandeja usa).
- **Agendador de postagens:** job `tiktok-posting` do pg-boss (cron no próprio
  banco), roda no `video-worker` a cada 10 min e publica o que tem
  `scheduled_for <= now()`. Na troca, o risco de duplicar é ter os dois
  `video-worker` ligados ao mesmo tempo contra bancos diferentes — por isso o
  antigo é parado ANTES de o novo subir com o banco final.
- **Horário de menor uso** (últimos 30 dias, horário de Brasília): nenhuma
  postagem e nenhum vídeo novo entre **01h e 07h**. Janela recomendada para a
  troca: **02h–05h**.
- DNS: Hostinger (`dns-parking.com`). TTL atual: `postflowtiktok.com` 14400 s,
  `postflowclips.com` 3841 s, `www` 300 s.

### O que o módulo de lives pode reaproveitar
| Precisa | Já existe | Onde |
|---|---|---|
| Legenda com tempo por palavra | `whisper-1` com `timestamp_granularities=word` | `src/services/openaiTranscriptionService.js` |
| Corte + vertical 1080×1920 + legenda queimada + título + numeração | pipeline completo, com estilos por cliente | `src/services/videoEditingService.js` (`renderClip`, `buildAssSubtitles`) |
| Fila de trabalhos e cron | pg-boss | `src/services/queueService.js`, `src/worker/videoScheduler.js` |
| Limite de vídeos simultâneos | `settings.max_videos_simultaneos` | `src/services/videoConcurrencyService.js` |
| Registro de custo que sobrevive | livro `video_costs` | `src/services/custoService.js` |
| Publicar no TikTok | motor de postagem com fila e horários | `postings` + `tiktokPostingJob` |
| Tela só para admin, desligada para clientes | padrão do vídeo narrado (`/admin/narrated`) | `src/web/routes/adminRoutes.js` |
| Chave liga/desliga editável | tabela `settings` | `src/repositories/settingsRepository.js` |
| Cliente OpenAI | chamadas diretas com `fetch` + `OPENAI_API_KEY` (não há SDK) | vários serviços |

**Novo de verdade:** vigia da Twitch, captura com streamlink, transcrição em
blocos com `gpt-4o-mini-transcribe`, triagem/seleção com modelo de texto da
OpenAI, "Clipar agora", tela "Lives".

---

## FASE 1 — Preparar o servidor novo

- [x] VPS contratada: `177.7.61.54` (`srv2018001`, Boston), 2 vCPU / 7,8 GB / 96 GB, Ubuntu 24.04. São Paulo não estava disponível.
- [ ] ~~Criar usuário não-root~~ — **decisão:** manter root **só por chave** (login por senha e por senha de root desligados em `/etc/ssh/sshd_config.d/00-postflow-hardening.conf`). Todos os comandos e o script de backup do projeto assumem root; um usuário a mais não reduz risco enquanto o login por senha está desligado.
- [x] Login por senha desligado; root só por chave (`PermitRootLogin prohibit-password`).
- [x] Firewall `ufw`: 22, 80, 443, **2222** (túnel). fail2ban ativo (jail `sshd`). Swap de 4 GB.
- [x] Mesmas versões: a imagem é construída do MESMO Dockerfile (Node 20, ffmpeg 5.1, yt-dlp mais recente). Docker 29.8 + compose v5.5.
- [x] Código: enviado por `git archive` (o servidor não precisa de acesso ao GitHub) — `deploy/deploy.sh`.
- [x] `.env` recriado por transferência direta VPS→VPS, sem passar pela tela: `/opt/postflow/postflow.env.producao` (real) e `/opt/postflow/postflow.env` (teste, desarmado). `ASAAS_API_KEY` entre aspas simples (começa com `$`, e o compose apagaria em silêncio).
- [x] Banco (Postgres 17, `/var/lib/postflow-db`) e fila (pg-boss, dentro do banco). Sem Redis.
- [x] Proxy: **Caddy** (`deploy/Caddyfile`), domínio vindo de `sites.env`. Teste em `https://177-7-61-54.sslip.io` com certificado real.
- [x] Processos: `docker compose` com os mesmos nomes de container do EasyPanel. **Agendador de postagem não está desligado**, mas não tem como postar: o banco é uma cópia com tokens do TikTok invalidados e agendamentos pausados (ver Fase 2).
- [x] Logs: rotação do Docker (`json-file`, 20 MB × 5 por container).
- [ ] Monitoramento básico (disco/RAM/processo caído). O painel do admin já mostra CPU/memória/disco (`systemMetricsSampleJob`), e o Docker reinicia container que cai (`restart: unless-stopped`). Falta alerta ativo — fica para antes da troca.

## FASE 2 — Cópia de teste e validação

- [x] Backup do banco de produção restaurado na VPS nova (`pg_dump -Fc` → `pg_restore`), 88 migrations, contagens conferidas.
- [x] **Cópia desarmada:** sem `ASAAS_API_KEY`, `STRIPE_*`, `UTMIFY_API_TOKEN`, `RESEND_API_KEY`, `TIKTOK_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `YTDLP_PROXY_URL`; no banco, tokens do TikTok/Google sobrescritos, canais inativos, postagens pendentes como `skipped`, vídeos em andamento cancelados, jobs do pg-boss apagados. Marca: `settings.ambiente_de_teste`.
- [x] 28/09: cópia reduzida para só `risestyle43` (id 17) + login do admin (id 1). 31 vídeos, 3 canais, 3 contas TikTok, 1,5 GB de cortes.
- [ ] rsync dos arquivos: a pré-cópia de 16 GB foi **interrompida** a pedido (só o risestyle43 fica). Refazer na troca.
- [x] Testes na VPS nova sem mudar DNS:
  - HTTPS ok; 18 telas do painel (admin e cliente) sem erro de JS nem 5xx;
  - pipeline completo (vídeo #2096: download pelo túnel → Whisper → Claude → 2 cortes 1080×1920, US$ 0,02);
  - túnel ponta a ponta (chave temporária, depois revogada);
  - 922/922 testes automáticos válidos (os 2 que falharam precisam do painel compilado, que não existia na cópia usada pelos testes);
  - backup diário funcionando.
- [x] Nada real postado a partir da VPS nova.
- [x] Medido: cada requisição fica **~120 ms mais lenta** para quem está no Brasil (24 → 142 ms com conexão aberta).
- [ ] Baixar o TTL do DNS para 300 s, 24 h antes da troca — **ação do Vinicius** no painel da Hostinger.
- [ ] Plano de troca e de volta revisado pelo Vinicius (abaixo).

### Plano de troca (rascunho, não executar sem "pode ir")
1. Conferir que nenhum vídeo está processando na antiga.
2. Antiga: `docker service scale postflow_web=0 postflow_worker=0 postflow_video-worker=0` (banco fica de pé = caminho de volta). Só serviços `postflow_*`.
3. Anotar postagens das próximas horas.
4. Dump final → restaurar na nova (apagando a cópia de teste) → conferir contagens.
5. rsync final dos cortes (`--delete`).
6. Copiar o `authorized_keys` do relé antigo para `/var/lib/postflow-relay/tunnel-ssh/`.
7. Trocar `postflow.env` pelo real, com `TUNNEL_RELAY_PUBLIC_HOST=177.7.61.54`; `sites.env` com os domínios reais.
8. Subir tudo, rodar migrations, conferir que a `ASAAS_API_KEY` chegou idêntica (hash).
9. Vinicius troca o registro A de `postflowtiktok.com` e `postflowclips.com` para `177.7.61.54`.
10. Caddy emite os certificados; conferir site, login, webhook do Asaas, OAuth, próxima postagem sai uma vez só.
11. Backup: copiar `/etc/postflow-backup.env`, ligar o cron na nova, desligar o da antiga.
12. Reiniciar o programa de bandeja do túnel de fallback.

### Plano de volta
`docker service scale postflow_web=1 postflow_worker=1 postflow_video-worker=1`
na antiga e voltar o DNS para `72.61.219.94`. O que for gravado na nova depois
da troca não volta junto.

## FASE 3 — Troca (aguardando autorização)

- [ ] Avisar e aguardar o "pode ir".
- [ ] Parar só os processos do Post Flow na antiga.
- [ ] Anotar postagens das próximas horas.
- [ ] Backup final + rsync final.
- [ ] Restaurar e conferir contagens.
- [ ] Ligar tudo na nova.
- [ ] DNS + SSL.
- [ ] Conferências (SSL, login, webhooks, OAuth, postagem única).
- [ ] Rollback se preciso.
- [ ] Post Flow parado mas intacto na antiga por 7 dias.
- [ ] Depois de 7 dias, com confirmação: remover o Post Flow da antiga.

## FASE 4 — Módulo de cortes de lives (Twitch)

Começa agora na VPS nova (decisão de 28/09), visível só para o admin.

### Cálculo de capacidade na VPS nova (2 vCPU / 96 GB)
- Disco livre para gravações: ~85 GB.
- 720p ≈ 1,35 GB/h/canal. 5 canais × 5 h/dia × 2 dias (retenção 48 h) = **67 GB** — no limite.
- 480p ≈ 0,7 GB/h/canal. 2 canais × 5 h × 1 dia = **7 GB**. Folga grande.
- CPU: gravar (`-c copy`) e extrair áudio custam pouco. O caro é **renderizar**
  o corte vertical, e isso disputa os mesmos 2 núcleos com os cortes do YouTube.
  Por isso o render de lives entra na mesma trava de "vídeos simultâneos".

### Checklist
- [x] Inventário lido; lista do que é reaproveitado e do que é novo (acima).
- [x] Respostas das perguntas abertas 1, 2 e 3. — 28/09 (ver seção de perguntas). `TWITCH_CLIENT_SECRET` colado pelo Vinicius direto no servidor; havia 2 valores, só o que a Twitch aceitou ficou.
- [x] Conferir no site da OpenAI o preço atual de `gpt-4o-mini-transcribe` e do modelo de texto mais barato (mini/nano) antes de escolher. — 28/09, developers.openai.com/api/docs/pricing: `gpt-4o-mini-transcribe` US$ 0,003/min; texto mais barato = **`gpt-5-nano`** (US$ 0,05 entrada / 0,40 saída por 1M tokens; `gpt-4.1-nano` 0,10/0,40; `gpt-4o-mini` 0,15/0,60). Com `reasoning_effort: minimal` o nano gastou **0** token de raciocínio (medido). Preços em `src/lib/apiCost.js`.
- [x] Tabelas novas (canais monitorados, sessões, segmentos, transcrições, candidatos, cortes de live, custos), sem alterar tabelas existentes; migração reversível, testada em banco de teste. — `migrations/089_cortes_de_lives.sql` (8 tabelas `live_*`), reversão manual em `migrations/reversao/089_cortes_de_lives.down.sql`. Aplicada no Postgres de teste (`npm test`) e depois na VPS nova. Um teste varre o código do módulo e falha se ele escrever em qualquer tabela que não seja `live_*`/`settings`.
- [x] Chave `settings.lives_enabled` (padrão desligada) + tela só no `/admin`. — botão Ligar/Desligar na tela; `LIVES_ENABLED=false` no servidor desliga mesmo com o painel ligado; sem `TWITCH_*` também não liga. Tela `/admin/lives` (menu "Lives"), API `/api/admin/lives/*`; cliente comum recebe 403 (testado).
- [x] Vigia (Twitch Get Streams, token de app). — `src/services/lives/twitchApi.js`, a cada 60 s, em lotes de 100 canais, token de app em cache e renovado no 401.
- [x] Captura: streamlink (AppImage) + ffmpeg `-c copy`, segmentos de 10 s, uma gravação por canal. — streamlink **8.6.1 fixo** no Dockerfile (AppImage extraído no build; a imagem continua sem Python). `--twitch-disable-ads`. Uma gravação por canal garantida por índice único parcial (testado com 5 tentativas simultâneas). **Medido na VPS:** ~2% de um núcleo e **0,65 GB/h** em 480p30. Grupo de processos morto com `process.kill(-pid)` e aviso de fim único (lições 3 e 4 do CLAUDE.md).
- [x] Silêncio e sinais de volume. — ffmpeg `silencedetect` + `ebur128` por bloco, grátis. Bloco com ≥90% de silêncio **não vai pra OpenAI**. Volume/pico vão junto no texto que a IA lê. **Defeito achado testando na VPS:** o ffmpeg 5.1 do servidor não aceita `framelog=quiet` (a análise falharia em todo bloco) → `framelog=verbose`. E o bloco de áudio herdava o relógio do anterior → `-reset_timestamps 1` no áudio. Leitura travada por teste contra a saída REAL do ffmpeg (`tests/fixtures/`). Chat IRC ainda não (opcional no plano).
- [x] Transcrição em blocos de 30 s com `gpt-4o-mini-transcribe`. — fim do bloco anterior vai no `prompt`; 3 tentativas e depois desiste do bloco; custo registrado em `live_costs`.
- [x] Triagem a cada 2 min (JSON validado). — últimos 5 min de transcrição, structured outputs (schema strict) + validação nossa (dentro da janela, 15–90 s, nota ≥ 6, sem repetir o mesmo momento). Só avança depois de a IA responder (falha da API não pula trecho — testado). **Observação:** no primeiro teste o nano deu 8/10 pra um trecho banal — o corte duro fica na seleção.
- [x] Seleção com limite por hora. — a cada 10 min e no fim da live; teto = `cortesPorHora` × horas gravadas (1ª hora conta inteira); ignora id inventado e nota < 7; escreve título e gancho no idioma da fala; um corte por usuário que acompanha o canal.
- [x] Legenda por palavra (`whisper-1`, serviço existente) + render com `videoEditingService`. — `liveRenderService`: junta os pedaços de 10 s sem recodificar, `openaiTranscriptionService.transcribeAudio` (whisper-1) e `renderClip` com o **estilo que o usuário já configurou** (sem "Parte N"). Um render por vez.
- [x] "Clipar agora". — últimos 150 s; espera a gravação passar do fim; a mesma transcrição por palavra do render serve pro nano achar o início/fim do momento (uma transcrição paga as duas coisas).
- [x] Tela "Lives". — liga/desliga, limites (salvos no `onBlur`), custo de hoje e 7 dias com **US$ por hora de live**, canais com status, Clipar agora, cortes com prévia/baixar/apagar, ordenação por nota. Atualiza sozinha enquanto grava. "Postar" ainda NÃO (ver pendências).
- [x] Proteções: máx. de canais gravando, horas por dia, parar com disco > 80%, apagar segmentos antigos, custo por canal/dia, chave geral. — todas em `settings.lives_config` e editáveis na tela. O limite de horas é **por canal por dia** (não por usuário) nesta fase, porque só o admin usa; vira por usuário quando abrir pra clientes.
- [x] Workers de lives em **container separado** com limite de CPU/memória. — `postflow_live-worker` (`src/worker/liveIndex.js`), `cpus: 1.0`, `mem_limit: 1536m`. O `video-worker` do YouTube sempre tem pelo menos 1 núcleo livre.
- [ ] Teste com 1 canal real por algumas horas (custo/h, CPU, disco, tempo até o corte, qualidade). — **em andamento desde 28/09 22:12 UTC**: canal `wb3nji` (react em português, ~1.700 espectadores), acompanhado pelo admin, 480p. **Primeiros 15 min (medido):**
  - gravação acompanha o relógio (~10 s de atraso); 14,5 min = 155 MB (0,64 GB/h);
  - **1º corte pronto 14 min depois do início da gravação** (1ª seleção aos 10 min + ~3,5 min de render de um corte de 90 s, com o teto de 1 núcleo);
  - custo: transcrição US$ 0,0435 (14,5 min × US$ 0,003), triagem US$ 0,0014 (7 chamadas), seleção US$ 0,0007, legenda US$ 0,011 por corte → **projeção ~US$ 0,25 por hora de live** com 5 cortes/h, no teto da estimativa do prompt (US$ 0,18–0,24). Quase tudo é a transcrição corrida; a IA de texto é centavo;
  - 23 candidatos da triagem (nota média 6,7) → 3 escolhidos (notas 7–8) com título e gancho em português; corte de 90 s em 1080×1920 com o estilo do usuário (título, legenda por palavra, fundo), conferido olhando os quadros;
  - **28/09 22:43 UTC — teste PAUSADO a pedido do Vinicius** (módulo desligado no `settings.lives_enabled`; canal `wb3nji` continua cadastrado, religar é um clique). Total: 30,6 min gravados em 2 sessões, 3 cortes prontos, **US$ 0,12** gastos. Nenhum processo de gravação ficou rodando (conferido).
  - Economias medidas e propostas, aguardando decisão: transcrição corrida em 1,5x (-25% do total; 2x quebra a transcrição) e legenda só do trecho exato do corte (-20% da legenda).
  - streamlink 8.x marcou `--twitch-disable-ads` e `--hls-segment-queue-threshold` como obsoletos (pular anúncio já é o padrão) — removidos no código, entram no próximo deploy.
- [ ] Teste com 2–3 canais.
- [ ] Relatório com os números medidos.

### Versão 2 (28–29/09/2026) — pedido do Vinicius: momentos melhores, câmera do streamer, qualidade e estilo próprio
- [x] **Diagnóstico da v1**: o nano, lendo só texto, deu nota 7 pra quase todo bloco de 30 s (43 candidatos em 20 min, todos "polêmicos"); volume médio de 30 s não varia (desvio 1,4 LU); corte sempre na borda do bloco.
- [x] **Sinais do público** (medidos antes de construir): clipes criados por espectadores (API Get Clips, grátis — 28 em 31 min no wb3nji), chat por IRC anônimo (10 → 42 msgs/10 s num momento engraçado), volume segundo a segundo (ebur128). Relógio ↔ gravação pela hora em que cada pedaço fechou (`live_segments.closed_at`), inclusive depois de pausa de anúncio. Só contagens do chat são guardadas, nunca o texto.
- [x] **Juiz** `gpt-5-mini` (reasoning low) a cada 5 min e no fim; triagem (nano) vê os sinais e aponta no máximo 2 por janela; picos do público viram candidatos sem IA.
- [x] **Nível de qualidade 1–5 por usuário** (`live_clip_settings.qualidade`): 1 = nota 5+ e até 12/h … 5 = nota 9+ e até 2/h. Avaliação uma vez por canal; distribuição por usuário, sem duplicar.
- [x] **Ajuste fino** de todo corte com gpt-5-mini palavra a palavra (±20 s, mínimo 20 s — no teste apertou pra 18 s e perdia a preparação).
- [x] **Câmera do streamer**: gpt-5-mini com imagem em 2 quadros; só aceita janela pequena e com os dois concordando. Erro real pego no teste (rosto do vídeo de react tomado por webcam — mesma pessoa em cima e embaixo) travado por teste com os números reais. Layout `webcam` no render, só ativado por `settings.live_webcam` (nenhum estilo de vídeo mudou). Gravação padrão 720p30 (câmera de 480p sai borrada).
- [x] **Estilo próprio das lives** com opção "usar o mesmo dos vídeos": mesmo editor (`ClipStyleEditorCard` em `modoLive`) e mesma validação (`validarEstilo`, extraída do controller de vídeo sem mudar comportamento). Teste garante que editar o de live não muda o de vídeo.
- [x] **Mesma gravação, v1 × v2 (wb3nji, 20 min)**: 43 candidatos/3 cortes mornos → 8 candidatos, juiz honesto (só 3 com nota ≥7, citando clipes de espectadores; trechos analíticos levaram 5–6). Reanálise: US$ 0,007. Câmera certa, cortes de 23–29 s. 31 testes do módulo; 8 mutações novas, todas pegas.
- [x] **Redução de custo (pedido de 29/09)**: transcrição corrida em **1,5x** (30 s cobrados como 20 s; ~0,4 s de CPU por bloco; 2x quebra a transcrição) e legenda só do trecho + folga do ajuste fino (corte 8: 99 s → 90 s cobrados). Sincronia da legenda conferida re-transcrevendo o corte pronto: a palavra na tela bate com a falada.
- [x] **A IA escolhe o formato de cada corte** (pedido de 29/09: lives de 2+ pessoas nas pontas, "metade de cima / metade de baixo", sem modelo pré-moldado). `liveFormatoService`: a IA (gpt-5-mini) vê 2 quadros do trecho, lista as pessoas DA live e monta 1–3 painéis empilhados ou o quadro inteiro; o servidor encaixa cada recorte na proporção exata do painel, centrado no rosto. Novo padrão (`camera_modo='ia'`, migration 091); "Destacar a câmera" e "Estilo normal" continuam como opção. Custo ~US$ 0,002 por corte.
  - Testado em **12 lives reais** de formatos diferentes (1 pessoa num canto, tela+webcam em cantos variados, reality com 2 pessoas, 3 pessoas lado a lado, 2 VTubers nas pontas, react, arte de jogo, IRL), repetindo depois de cada correção.
  - Travas que o teste exigiu: personagem de jogo/filme/desenho não é pessoa; painéis sobre a mesma área viram um (só se tiverem tamanho parecido); zoom centrado no rosto apontado pela IA (senão pegava boné e testa); **ninguém da live fica de fora — garantido pelo servidor** (a IA não é consistente: na mesma imagem ora esquecia a webcam, ora uma das pessoas); webcam só conta com painel próprio (em react a IA tomava o youtuber do vídeo assistido pelo streamer); "webcam" que não muda entre os 2 quadros é a foto do canal e sai (medido: foto 0,49 × webcam 15,4).
  - Resultado final: 2 rodadas seguidas dos 12 casos com todas as pessoas/webcams presentes; cortes reais do wb3nji com o vídeo assistido em cima e o streamer reagindo embaixo. 986 testes.
- [x] **Correções pedidas em 29/09** (depois de ver os cortes):
  - **Webcam recortada exatamente na janela dela**: o painel era esticado pro formato fixo e o recorte saía da janela, pegando a borda preta, o @ do canal e os ícones de rede em volta ("espaço preto no canto"). Agora a altura do painel sai do formato da própria câmera (20–50% da tela) e o recorte é a janela exata; se não couber, corta pra DENTRO. Vale pro "A IA escolhe" e pro "Destacar a câmera" (que perdeu a folga de 6% em volta).
  - **Canal ao vivo aparecendo "Offline"** (thimagroo, 1.823 espectadores): com o módulo desligado o monitor não roda e o status nunca era consultado. Agora a tela consulta a Twitch ao adicionar o canal e ao abrir (grátis, no máximo 1x/min) e mostra "Ao vivo · não está gravando" quando o módulo está desligado.
  - **Qualidade em barra arrastável colorida** (esquerda = mais cortes, direita = mais chance de viralizar), salva ao soltar.
  - **Título "Cartão"**: caixa arredondada, sombra e degradê da cor escolhida, letra preta/branca pelo contraste; imagem gerada por código (`scripts/gerar-cartao-titulo.js`). Disponível pros cortes de vídeo e de live (migration 092 só acrescenta a opção). Aplicado nos cortes de live do admin.
- [x] **Teste ao vivo (thimagroo, 86 min, 29/09)**: gravação 720p30, 2.024+ mensagens de chat lidas, 3 clipes de espectadores, formato de 2 pessoas nas pontas acertado. ~US$ 0,18/h.
- [x] **Correções depois do teste ao vivo (29/09)**, a partir da avaliação do Vinicius ("cortes do nível máximo não foram bons; final sem sentido; título com sombra nas bordas"):
  - **Fim do corte**: caso real — "Vai chegar um amigo novo (mas não é bom)" terminava em "que pode..." e perdia o "mas não vai ser uma boa". Agora o Whisper devolve FRASES na mesma chamada (sem custo extra), o ajuste fino vê a fala frase a frase e até 30 s depois do trecho, e o servidor garante início no começo e fim no FIM de uma frase (`encaixarNaFala`). Instrução pra terminar quando o assunto do título se conclui e nunca emendar assunto novo.
  - **Juiz**: notas por partes (gancho, desfecho, emoção, entende sozinho) com tetos no servidor (sem desfecho ≤ 6; sem contexto ≤ 5; gancho fraco ≤ 7), comparação com os melhores já aprovados da live, raciocínio `medium`. Níveis 3–5 exigem reação do PÚBLICO (percentil do chat na própria live: 50%/75%/90%). Mesmo momento por dois caminhos vira um corte só.
  - Rejulgamento das 62 avaliações do thimagroo com o juiz novo (US$ 0,06): no nível 5 só 4 passam (nota 9 + top 10% de reação).
  - **Título "Cartão" v2**: sem sombra (formava um retângulo escuro), desenhado no tamanho exato de cada título (`src/lib/cartaoTitulo.js`), letra maior; nas lives, título que cairia em cima da legenda sobe pro topo.
  - Limite honesto: o "fim do assunto" continua sendo decisão da IA — o corte sempre termina no fim de uma frase, mas pode incluir uma troca a mais.
- [ ] Novo teste ao vivo com as correções de 29/09.

### Pendências conhecidas do módulo
- **Postar o corte de live no TikTok** ainda não existe: o motor de postagem é amarrado às tabelas do fluxo do YouTube (`postings.video_id → videos → clips`), e ligar isso exige mexer em tabela existente — regra do prompt: pedir autorização antes.
- **Chat IRC da Twitch** como sinal extra: não feito (o plano diz que é só apoio).
- **Ordem do deploy:** o `live-worker` sobe antes de a migration rodar e reinicia sozinho até as tabelas existirem (visto no 1º deploy: 3 reinícios, sem dano).
- Tudo publicado só na VPS nova, a partir da branch `feature/lives` (nada na `main`, nada no GitHub).
- **Tipos de momento (29/09, pedido do fundador):** triagem e juiz agora procuram ENGRAÇADO (piada, duplo sentido, mancada, constrangedor, xingamento) e SÉRIO (dinheiro com número, "ganhei/comprei", polêmica, briga, ofensa) — catálogo único em `O_QUE_VIRALIZA`. A fala ganha pistas sem IA (`tiposDeMomento.pistasDaFala`: dinheiro com número, compra, palavrão). O juiz grava o tipo (`live_candidates.moment_type`, migration 093); dinheiro/ostentação/polêmica não são barrados pela exigência de reação do chat dos níveis 3–5 (a nota mínima continua valendo). Título de dinheiro leva o número. Ainda não visto numa live real.

## FASE 5 — depois da validação
- [ ] Kick (conferir suporte do streamlink).
- [ ] Liberar para mais usuários.

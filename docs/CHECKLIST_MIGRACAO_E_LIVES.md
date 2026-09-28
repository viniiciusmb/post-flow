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
- [ ] Respostas das perguntas abertas 1, 2 e 3.
- [ ] Conferir no site da OpenAI o preço atual de `gpt-4o-mini-transcribe` e do modelo de texto mais barato (mini/nano) antes de escolher.
- [ ] Tabelas novas (canais monitorados, sessões, segmentos, transcrições, candidatos, cortes de live, custos), sem alterar tabelas existentes; migração reversível, testada em banco de teste.
- [ ] Chave `settings.lives_enabled` (padrão desligada) + tela só no `/admin`.
- [ ] Vigia (Twitch Get Streams, token de app).
- [ ] Captura: streamlink (AppImage) + ffmpeg `-c copy`, segmentos de 10 s, uma gravação por canal.
- [ ] Silêncio e sinais de volume.
- [ ] Transcrição em blocos de 30 s com `gpt-4o-mini-transcribe`.
- [ ] Triagem a cada 2 min (JSON validado).
- [ ] Seleção com limite por hora.
- [ ] Legenda por palavra (`whisper-1`, serviço existente) + render com `videoEditingService`.
- [ ] "Clipar agora".
- [ ] Tela "Lives".
- [ ] Proteções: máx. de canais gravando, horas por dia, parar com disco > 80%, apagar segmentos antigos, custo por canal/dia, chave geral.
- [ ] Workers de lives em **container separado** com limite de CPU/memória.
- [ ] Teste com 1 canal real por algumas horas (custo/h, CPU, disco, tempo até o corte, qualidade).
- [ ] Teste com 2–3 canais.
- [ ] Relatório com os números medidos.

## FASE 5 — depois da validação
- [ ] Kick (conferir suporte do streamlink).
- [ ] Liberar para mais usuários.

# Revisão final antes de submeter pro Google e pro TikTok — guia de trabalho

> Arquivo temporário de planejamento, **não é documentação permanente do projeto** (isso é o `CLAUDE.md`, na raiz). Feito pra guiar uma sessão futura (Opus) que vai revisar/polir tudo antes de submeter o app pra aprovação do Google (verificação OAuth) e do TikTok (Content Posting API). Pode apagar este arquivo depois que o trabalho terminar. Escrito em 01/08/2026, depois de uma auditoria completa do sistema.

**Como usar**: cada seção abaixo é um bloco de trabalho independente. Não precisa fazer tudo numa sessão só — trate como um checklist, marque o que for concluído, e sempre teste de verdade (local + produção) antes de considerar algo pronto, igual já vem sendo feito neste projeto.

---

## ⚠️ PENDÊNCIAS QUE DEPENDEM DO USUÁRIO (02/08/2026)

Tudo que dava pra fazer sozinho das seções 1, 2, 3 e 4 foi feito e já está em produção
(ver "STATUS" em cada seção). Estas três ficaram travadas esperando uma ação humana:

- [ ] **Criar o encaminhamento `suporte@postflowtiktok.com`** no painel do domínio, apontando pro
  e-mail que o fundador lê. **BLOQUEIA a submissão pro Google e pro TikTok** — os dois mandam
  mensagem de teste pro contato declarado, e caixa inexistente reprova a revisão. O endereço já
  está publicado na landing, nos Termos, na Privacidade e na página de contato
  (`src/config/constants.js` → `CONTACT.supportEmail`), então hoje o site anuncia um canal de
  suporte que não recebe nada.
- [x] ~~Criar a conta no Backblaze B2~~ **FEITO em 02/08/2026.** Bucket privado `postflow`,
  chave limitada a ele, envio usando a API nativa do B2 (`curl`+`jq` — o Ubuntu 24.04 da VPS não
  tem mais `awscli` nos repositórios). Testado de verdade: o arquivo foi baixado DE VOLTA do B2 e
  restaurado, batendo com produção.
- [ ] **Regenerar a Master Application Key do Backblaze — e NÃO compartilhar a nova.** Ela foi
  regenerada uma vez em 02/08/2026, mas a nova acabou sendo colada no chat também, então precisa
  de mais uma rodada. Nada quebra ao regenerar: o backup usa a chave `postflow-backup`, limitada
  ao bucket. A Master serve só pra administrar a conta e nunca precisa sair da mão do fundador.
  Painel → Application Keys → Regenerate Master Application Key.
- [ ] **Escolher um serviço de e-mail** (Resend/SendGrid/SES) — continua bloqueando "esqueci minha
  senha" e verificação de e-mail no cadastro (ver seção 8).

---

## 0. Antes de mexer em qualquer coisa

Ler o `CLAUDE.md` inteiro primeiro (regras operacionais, arquitetura, estado atual, erros já cometidos). Este arquivo aqui **complementa** aquele, não substitui.

---

## 1. Urgente — risco operacional real (fazer antes de qualquer coisa "de polimento")

- [ ] **Backup do banco de dados.** Hoje não existe NENHUM backup do Postgres de produção — nem automático (verificar se o EasyPanel oferece algo nativo pro serviço de banco), nem manual (`pg_dump` agendado). Se o disco falhar ou algo corromper, perde tudo: contas, tokens do TikTok/Google, histórico de vídeo, saldo de crédito. **Prioridade máxima.** Se o EasyPanel não tiver backup nativo, montar um cron simples de `pg_dump` + envio pra um storage externo (S3/Backblaze/o que for mais barato), com teste de restore de verdade (não só rodar o backup, restaurar num banco de teste e confirmar que os dados batem).
- [ ] **`npm test` hoje reporta sucesso sem testar nada.** As pastas `tests/repositories/` e `tests/services/` existem mas estão vazias — rodar o teste sempre dá "0 testes, tudo passou", o que é pior do que não ter teste nenhum (passa uma falsa sensação de segurança). Escrever pelo menos os testes mais críticos: o motor de créditos (`creditsService.js`/`clientCreditsRepository.js` — já foi testado manualmente via script neste sessão, transformar aquilo num teste real e repetível), a lógica de assinatura/webhook da Stripe, e os pontos de posse/multi-tenant (um cliente nunca deve conseguir ler/mexer em dado de outro).
- [ ] **O processo `video-worker` não está documentado nem scriptado nos artefatos de deploy** (`docker-compose.yml`, `ecosystem.config.js`, `docs/deployment-easypanel.md`) — só existe no `CLAUDE.md` e na configuração viva do EasyPanel. Se alguém tentasse recriar o ambiente do zero seguindo só os arquivos versionados, o site subiria mas nenhum vídeo processaria, nenhuma postagem sairia, nenhuma exportação pro Drive aconteceria. Atualizar os 3 arquivos pra refletir a realidade (3 processos: web, worker, video-worker).
- [ ] **Sem rede de segurança contra crash nos workers.** Nenhum `process.on('uncaughtException')`/`process.on('unhandledRejection')` existe em `src/worker/index.js` nem `src/worker/videoIndex.js`. Um erro não tratado em qualquer lugar da árvore de dependências (inclusive bibliotecas de terceiro) derruba o processo inteiro, matando todos os vídeos em andamento, não só o que causou o erro. Adicionar um handler de última instância que loga o erro e (dependendo do caso) deixa o Docker Swarm reiniciar o processo sozinho, em vez de deixar o Node crashar silenciosamente.
- [ ] **Vídeo travado em status "em andamento" depois de um deploy não se recupera sozinho.** Aconteceu 3 vezes na sessão de 01/08/2026 (vídeos `#988`, `#1838`, `#1683`), sempre corrigido manualmente. Investigar a causa: os deploys usam `update_order: start-first` no Docker Swarm (confirmado via `docker service inspect`), então o container novo sobe ANTES do antigo desligar — uma detecção por tempo simples correria o risco de resetar um vídeo que o container antigo ainda está processando de verdade, corrompendo o corte. A correção correta é dar um "sinal de vida" periódico (ex: tocar `source_videos.updated_at` a cada ~60s durante download/transcrição/corte, não só nas transições de status) e só então criar um job que detecta "sem sinal de vida há N minutos = travado de verdade" com segurança. Não implementar uma versão apressada disso sem esse sinal de vida — o risco de corromper um corte real é pior do que continuar resetando na mão.

---

## 2. Segurança — o que falta antes de crescer a base de clientes

- [ ] **Sem proteção CSRF.** A autenticação é por cookie de sessão (`express-session`), e não existe nenhum token CSRF nem `sameSite` explícito configurado no cookie (`src/web/app.js`, bloco da sessão). São 30+ rotas POST/PUT/DELETE que mudam estado (cadastro de canal, configuração de conta TikTok, ações de billing/Stripe, etc). Adicionar `sameSite: 'lax'` (ou `'strict'` se não quebrar nenhum fluxo de redirect OAuth) explicitamente no cookie, e avaliar um token CSRF de verdade (dupla submissão) pras rotas mais sensíveis, principalmente as de billing.
- [ ] **Rate limiting só existe no login.** Todas as outras ~34 rotas de API (`src/web/routes/api/*`) não têm limite de requisições. Merece atenção especial: `POST /api/tunnel/register-pending` (pública, sem autenticação, chamada pelo programa de bandeja) e qualquer rota de billing/Stripe. Adicionar `express-rate-limit` em pelo menos: rotas públicas sem sessão, rotas de billing/pagamento, e upload de vídeo.
- [ ] **Auditoria de IDOR (Insecure Direct Object Reference) — isso é crítico num sistema multi-tenant.** Passar por TODA rota que recebe um `:id` (canal, vídeo, corte, conta TikTok, conexão de Drive, etc) e confirmar que a query sempre filtra por `client_user_id`/dono, nunca confia só no ID vindo da URL. A maioria dos repositórios já segue o padrão `findByIdOwnedByClient(id, clientUserId)`, mas vale uma passada sistemática conferindo TODAS as rotas, uma por uma, sem exceção — inclusive as mais novas (billing, créditos, túnel).
- [ ] **`.env.example` desatualizado** — faltam ~15 variáveis que o sistema realmente usa (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `YOUTUBE_COOKIES_BASE64`, `YTDLP_POT_PROVIDER_URL`, `YTDLP_PROXY_URL`, `YTDLP_TAILSCALE_PROXY_URL`, `YTDLP_PATH`, `TUNNEL_RELAY_*` (4 variáveis), `VIDEO_WORK_DIR`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`). Atualizar pra refletir tudo que `src/config/index.js` realmente lê.
- [ ] **Rodar `npm audit`** e revisar dependências com vulnerabilidade conhecida (não foi feito uma auditoria de CVE de verdade ainda, só uma checagem visual de versões).
- [ ] **Revisar gestão de segredos**: `APP_ENCRYPTION_KEY` (usada pra criptografar tokens do TikTok/Google no banco) — confirmar que existe um plano de rotação caso ela precise ser trocada um dia (hoje trocar essa chave invalidaria todos os tokens já criptografados no banco — vale documentar esse risco, mesmo que não seja corrigido agora).
- [ ] **2FA pro login do admin** — hoje é só e-mail/senha. Não é bloqueante, mas é um "nice to have" real considerando que a conta admin tem acesso a dado de todos os clientes.
- [ ] **Rodar a skill `/security-review`** deste mesmo Claude Code sobre o branch atual antes de submeter pra aprovação — ela faz uma varredura de segurança dedicada que complementa esse checklist manual.

---

## 3. Velocidade — resposta do site (NÃO processamento de vídeo, isso já foi medido separadamente)

Isso é sobre quão rápido o painel responde ao clicar/navegar, não sobre corte de vídeo (que é limitado por CPU/API externa, já documentado em outro lugar).

- [ ] **Sem middleware de compressão HTTP** (`compression` do Express) — confirmar se está faltando e adicionar; reduz o tamanho das respostas JSON/HTML transferidas, efeito imediato na velocidade percebida, principalmente pra clientes com internet mais lenta.
- [ ] **Auditar índices do banco** — conferir se toda coluna usada em `WHERE`/`JOIN` com frequência (principalmente foreign keys tipo `client_user_id`, `youtube_channel_id`, `source_video_id`, `tiktok_account_id` nas tabelas maiores) tem índice. Rodar `EXPLAIN ANALYZE` nas queries mais chamadas (listagem de vídeos, fila de postagem, faturamento) pra achar sequential scans desnecessários.
- [ ] **Revisar polling do frontend** — várias telas do cliente fazem polling (ex: "Vídeos & Cortes" a cada 8s enquanto tem vídeo em andamento, fila do admin a cada 15s). Com muitos clientes simultâneos logados, isso pode virar carga desnecessária no servidor. Considerar aumentar o intervalo ou trocar por um mecanismo mais eficiente (SSE/WebSocket) se a base de clientes crescer.
- [ ] **Bundle do frontend** — o build já faz code-splitting por página (cada tela React é um chunk Vite separado), o que é bom. Vale conferir se alguma tela específica ficou com bundle muito grande (ex: `admin-metrics` apareceu com ~347KB no último build — investigar se dá pra dividir mais ou lazy-load algum gráfico pesado).
- [ ] **Sessão via `connect-pg-simple`** (sessão guardada no próprio Postgres) — em volume alto isso pode virar um ponto de contenção. Não é urgente no tamanho atual, mas vale monitorar se a base de clientes crescer bastante.
- [ ] **Medir tempo de resposta real** das rotas mais usadas (dashboard do cliente, lista de vídeos, fila de postagem) sob alguma carga simulada — hoje não existe nenhuma métrica de latência do próprio site coletada (só as métricas de saúde da VPS, que são de CPU/memória/disco, não de tempo de resposta HTTP).

---

## 4. Páginas essenciais que faltam ou estão incompletas

- [ ] **Landing page pública — não existe hoje.** A rota raiz (`/`, `src/web/app.js`) só redireciona pra `/login` (sem sessão) ou pro painel (com sessão) — não existe NENHUMA página pública explicando o que é o produto, pra quem serve, preços, ou um CTA de cadastro. Isso importa por dois motivos: (1) pra conseguir clientes de verdade sem já ser um usuário existente, e (2) o Google e o TikTok costumam querer ver um site público real explicando o produto durante a revisão do app, não só uma tela de login. Construir uma landing simples: o que é o Post Flow, como funciona (YouTube → corte com IA → TikTok), os 3 planos (Starter/Pro/Max, já existem no sistema de créditos), botão de cadastro, link pra Termos/Privacidade.
- [ ] **Termos de Serviço e Política de Privacidade já existem** (`src/web/views/legal/terms.ejs`, `privacy.ejs`, servidos em `/termos` e `/privacidade`) mas são bem enxutos (28 e 32 linhas). Revisar e expandir pra cobrir: retenção de dados (cortes ficam N dias, configurável — documentar isso), o que acontece com os dados se o cliente cancelar/for removido, escopos exatos pedidos ao Google e ao TikTok e por quê (ajuda inclusive na revisão do Google), contato de suporte real (hoje diz "e-mail informado pelo administrador" — colocar um e-mail de verdade).
- [ ] **Página de contato/suporte** — não identificada uma rota dedicada. Google e TikTok pedem um jeito claro de contato durante a revisão.
- [ ] **Política de cookies** — como o Post Flow usa cookie de sessão (não rastreamento/analytics de terceiros, até onde foi confirmado), uma seção curta dentro da própria Política de Privacidade provavelmente basta — mas confirmar se não tem nenhum script de analytics/pixel de terceiro rodando no frontend que precisaria de consentimento explícito (verificar `web-client/index.html` e os `main-*.tsx` de cada página).
- [ ] **Vídeo de demonstração** — tanto o Google (verificação OAuth de escopo sensível) quanto o TikTok (Content Posting API) costumam pedir uma gravação de tela mostrando o fluxo de autorização e uso de verdade. Gravar um vídeo curto mostrando: login → conectar Google Drive → autorizar → usar a função de export; e separadamente, conectar TikTok → publicar um corte (quando o TikTok já estiver em produção, não sandbox).

---

## 5. Aprovação do Google (verificação OAuth — sair de "Teste" pra "Em produção")

Contexto já levantado nesta mesma sessão (ver histórico de conversa e `post_flow_google_drive` na memória do projeto) — resumo do que falta:

- [ ] Confirmar que os 3 escopos usados (`drive.readonly`, `drive.file`, `userinfo.email`) estão adicionados em **Google Auth Platform → Acesso a dados**.
- [ ] Preencher **Informações do app**: nome, e-mail de suporte, e-mail do desenvolvedor, logo do app.
- [ ] Link de **Política de Privacidade pública** (`https://postflowtiktok.com/privacidade`, já existe — mas ver item 4 sobre expandir o conteúdo antes de submeter).
- [ ] Escrever a **justificativa de uso de cada escopo sensível** (por que precisa de `drive.readonly` e por que precisa de `drive.file`, separadamente — o Google pede isso na submissão de verificação).
- [ ] Gravar o **vídeo de demonstração** do fluxo OAuth completo (ver item 4).
- [ ] Submeter pra verificação e acompanhar — a análise é humana, pode levar de dias a semanas. **Não travar o resto do trabalho esperando isso.**
- [ ] Enquanto não verificado: manter a lista de **usuários de teste** sempre atualizada com o e-mail de qualquer cliente real que for conectar o próprio Drive (senão a autorização falha com `access_denied`, erro já visto e resolvido nesta sessão).
- [ ] **IMPORTANTE**: antes de submeter, ESTUDAR a documentação oficial atual do Google sobre verificação de app OAuth (as regras/formulário mudam com frequência) — não confiar cegamente neste checklist, ele reflete o que foi verdade em 01/08/2026.

---

## 6. Aprovação do TikTok (Content Posting API — sair do Sandbox)

**Isso precisa de pesquisa nova, não confiar só no que já sabemos.** O que já está confirmado nesta sessão: o app está em modo Sandbox (publica só como rascunho/inbox, o cliente final precisa abrir o TikTok e confirmar manualmente), e a tentativa de publicação real falha com `"The user did not authorize the scope required for completing this request"` mesmo com o escopo `video.publish` presente no token — isso é o gotcha conhecido de que o escopo aparecer concedido no OAuth **não é a mesma coisa** de o produto "Content Posting API" estar habilitado/aprovado no TikTok Developer Console (configuração separada).

- [ ] **Estudar a documentação atual do TikTok for Developers sobre Content Posting API** — os requisitos de review mudam com frequência, não presumir que o processo é igual ao de sessões anteriores.
- [ ] Verificar no TikTok Developer Console: o produto "Content Posting API" está adicionado ao app e qual o status de aprovação dele (separado da lista de escopos do Login Kit).
- [ ] Entender a diferença entre publicar como **rascunho/inbox** (modo atual, sandbox) vs **Direct Post** (produção, aprovado) — confirmar exatamente o que precisa ser submetido/demonstrado pra aprovar Direct Post.
- [ ] Provavelmente vai pedir: vídeo de demonstração do fluxo de postagem de ponta a ponta, descrição clara do produto, política de privacidade, termos de uso, e talvez uma URL pública funcionando (reforça o item 4, landing page).
- [ ] Trocar as credenciais de Sandbox (`TIKTOK_CLIENT_KEY`/`SECRET` atuais) pelas de Produção **só depois** da aprovação — trocar antes quebra tudo (gotcha já documentado no `CLAUDE.md`).
- [ ] **Nenhuma publicação real no TikTok foi confirmada ponta a ponta ainda** (nem em sandbox, por causa do bloqueio de escopo acima) — resolver isso é pré-requisito pra qualquer coisa antes de submeter pra aprovação de produção, já que a aprovação provavelmente exige demonstrar o fluxo funcionando.

---

## 7. Coisas nunca testadas de verdade, ou que valem uma verificação extra

- [ ] **Estilo de corte manual (enquadramento contínuo, presets "balão") só foi validado inspecionando a STRING do filtro ffmpeg gerada** (com um ffmpeg falso, em ambiente de sandbox sem ffmpeg de verdade) — nunca foi visto rodando com ffmpeg real até onde está documentado. Conferir visualmente o resultado no primeiro vídeo real que passar pelo modo Manual (se ainda não tiver acontecido).
- [ ] **Programa de bandeja Windows** — 3 bugs reais corrigidos (janela de terminal piscando, ícone não aparecendo, código de pareamento não expirando) mas a versão corrigida nunca foi reconfirmada por um usuário/cliente real numa máquina Windows de verdade.
- [ ] **Túnel SSH reverso** — confirmado funcionando no Mac e em produção (resolveu um bloqueio real do YouTube), mas é uma peça de infraestrutura inerentemente frágil (depende do cliente manter o programinha rodando, e do relé SSH continuar saudável) — vale um teste de carga/estabilidade (deixar rodando dias, ver se cai sozinho) antes de depender dele pra clientes de verdade.
- [ ] **Sistema de créditos + Stripe** — o motor de crédito em si foi testado com dados reais (inclusive teste de concorrência), mas **nunca com uma conta Stripe real** (chaves ainda não configuradas). Antes de ligar a Stripe de produção: testar o fluxo completo em modo teste da Stripe primeiro (assinatura, troca de plano, compra avulsa, cartão de excedente, webhook) — a Stripe tem um modo sandbox próprio (chaves `sk_test_`/`pk_test_`) que não foi usado ainda.
- [ ] **Faturamento de excedente automático** (`overageBillingJob`) nunca rodou de verdade contra uma cobrança real — só testado com Stripe mockada.
- [ ] **Carga concorrente real** — hoje o sistema processa 1 vídeo por vez by design, mas nunca foi testado com múltiplos clientes tentando usar o painel (não o processamento) ao mesmo tempo sob carga de verdade (login, navegação, billing simultâneos).
- [ ] **Os 15 vídeos antigos do canal "Renato Cariani"** que entraram errado numa fila em 30/07 continuam em produção sem limpeza — decidir com o usuário se apaga ou mantém antes de considerar o sistema "limpo" pra revisão externa.
- [ ] **Retenção/exclusão de dados de cliente** — confirmar que existe um jeito real de excluir TUDO de um cliente que pedir (LGPD/GDPR-like) — hoje a política de privacidade menciona isso ("entre em contato com o administrador") mas não está claro se existe um botão/rotina real de exclusão completa (cascata em todas as tabelas: vídeos, cortes, tokens, histórico de crédito) ou se seria um processo manual via banco.
- [ ] **Responsividade mobile** — as telas React foram construídas pensando em desktop (painel administrativo/cliente); não foi confirmado se funcionam bem num celular. Não é bloqueante pro tipo de produto (é mais painel de gestão que app do dia a dia), mas vale um teste rápido.
- [ ] **Acessibilidade (a11y)** — não auditado ainda; não é bloqueante pra aprovação do Google/TikTok, mas é boa prática antes de chamar o site de "impecável".

---

## 8. Achados da sessão de 01/08/2026 (parte 2) — aguardando aprovação do usuário

Essas 4 coisas foram levantadas numa checagem rápida (recuperação de senha, envio de e-mail, aceite de termos no cadastro, verificação de e-mail). **O usuário já viu essa lista e pediu pra registrar aqui porque o limite de uso acabou no meio da conversa — retomar perguntando se ele aprova antes de implementar qualquer uma, não implementar direto.**

- [ ] **"Esqueci minha senha" não existe.** Hoje só o admin trocando manualmente no banco resolve um cliente esquecido. Recomendado: link de redefinição por e-mail. **Depende do item abaixo (precisa de e-mail funcionando primeiro).**
- [ ] **Não existe NENHUM sistema de envio de e-mail no projeto** (confirmado por busca no código - nenhuma lib tipo nodemailer/sendgrid/resend/ses instalada ou usada). Isso bloqueia não só a recuperação de senha, mas qualquer notificação futura (crédito acabando, cobrança de excedente falhou, etc). **Precisa que o usuário escolha um serviço** (sugestões dadas: Resend, SendGrid, Amazon SES — todos têm plano grátis pra volume baixo) e crie a conta. Sem essa decisão do usuário, não dá pra prosseguir com recuperação de senha nem verificação de e-mail.
- [ ] **Cadastro público (`/register`) não exige aceitar os Termos de Serviço** — não tem checkbox nenhum "li e aceito", só um link solto no rodapé (se tiver). Risco jurídico simples de fechar: recomendado adicionar checkbox obrigatório no formulário de cadastro, vinculado aos Termos/Privacidade que já existem em `/termos` e `/privacidade`. **Essa parte NÃO depende de e-mail — pode ser feita independente, já aprovada em conceito, só falta confirmar com o usuário se pode implementar.**
- [ ] **Verificação de e-mail no cadastro não existe** — qualquer e-mail (real ou inventado) passa sem confirmação. Não bloqueante, mas comum em produto sério. Recomendado fazer junto quando o e-mail (item acima) for resolvido, não como tarefa separada.

**Próximo passo ao retomar**: perguntar ao usuário (1) qual serviço de e-mail ele escolheu (ou se prefere adiar tudo que depende de e-mail), e (2) se aprova o checkbox de aceite de termos no cadastro (essa não tem trade-off nenhum, é só implementar se ele confirmar).

---

## Onde encontrar mais contexto

- `CLAUDE.md` (raiz do projeto) — regras operacionais, arquitetura, estado atual, histórico de erros e decisões.
- Memória do projeto (`~/.claude/projects/.../memory/`, carregada automaticamente em qualquer sessão neste diretório) — principalmente `post-flow-architecture`, `post-flow-deployment`, `post-flow-project-status`, `post-flow-tiktok-oauth`, `post-flow-google-drive`.
- Esta sessão (01/08/2026) fez uma auditoria completa do sistema antes de escrever este arquivo — se precisar dos detalhes técnicos exatos de cada achado (linha de código, etc), vale reler o histórico da conversa dessa data.


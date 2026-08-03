# Roteiro dos vídeos de aprovação — Google e TikTok

Pesquisado na documentação oficial das duas plataformas em 03/08/2026. As regras mudam; os links
estão no fim.

**Leia esta página inteira antes de gravar.** A primeira seção muda bastante o trabalho que você
imagina ter.

---

## Antes de tudo: o Google provavelmente nem precisa de vídeo

Isto mudou quando removemos o escopo `drive.readonly`.

O Post Flow hoje pede exatamente dois escopos do Google:

| Escopo | Classificação oficial |
|---|---|
| `https://www.googleapis.com/auth/drive.file` | **Não sensível** |
| `https://www.googleapis.com/auth/userinfo.email` | **Não sensível** |

A documentação do Drive diz, sobre o `drive.file`: *"only require basic OAuth App Verification"*. E
o Google é explícito: **app que usa só escopos não sensíveis não precisa passar pela verificação**,
não mostra a tela de "app não verificado" e não fica limitado a 100 usuários.

O que sobra é a **verificação de marca** (*brand verification*): o processo leve que existe só pra
você poder exibir o nome e o logo do Post Flow na tela de consentimento. Ela pede domínio
verificado, site público e política de privacidade — **não pede vídeo**. O texto oficial diz que o
vídeo é solicitado *só se* a equipe do Google achar necessário durante a análise.

**O que isso significa na prática:**

1. Envie a verificação de marca primeiro. O resultado automático costuma sair em minutos; quando cai
   em análise manual, 2 a 3 dias úteis.
2. **Só grave o vídeo do Google se eles pedirem.** Se pedirem, o roteiro está na Parte 2 desta
   página, pronto.
3. O vídeo do **TikTok é obrigatório de qualquer jeito.** Se você só tiver fôlego pra um, é esse.

> Se algum dia o recurso de "pasta de origem do Drive" voltar, ele exige o `drive.readonly`, que é
> escopo **restrito**: aí volta a verificação completa, com vídeo **e** uma auditoria de segurança
> paga refeita todo ano. Ver `docs/aprovacoes-google-tiktok.md`.

---

## Preparação (vale para os dois vídeos)

### O que deixar pronto antes de apertar o gravar

- [ ] **Uma conta de teste no Post Flow**, criada só pra isso. Não use a sua conta de admin nem a de
      um cliente real — vai aparecer dado de gente de verdade na tela.
- [ ] **Um canal do YouTube já cadastrado** nessa conta, com **pelo menos um corte pronto na fila**.
      Gerar corte na hora leva minutos e o revisor não vai esperar.
- [ ] **Uma conta do TikTok de teste** (não a sua pessoal), adicionada como *Target User* no
      Developer Console.
- [ ] **Sair de todas as contas** do Google e do TikTok no navegador, ou usar uma janela anônima. Se
      o navegador já estiver logado, a tela de consentimento é pulada — e é justamente ela que o
      revisor precisa ver.
- [ ] **Fechar** abas, notificações, extensões e qualquer coisa com nome de pessoa real na tela.
- [ ] Tela em **1920×1080**, zoom do navegador em **100%**.

### Como gravar

- Grave **em inglês** se conseguir narrar; se não, **grave sem narração** e use legendas em inglês.
  O Google exige explicitamente que o fluxo de consentimento seja mostrado em inglês. Você pode
  trocar o idioma da tela de consentimento acrescentando `&hl=en` na URL, ou deixando o navegador em
  inglês.
- **Sem cortes** nas partes de autorização. Corte só os tempos de espera longos, e quando cortar,
  deixe claro na legenda ("processing — 4 minutes later").
- **Mouse devagar.** O revisor precisa acompanhar onde você clicou.
- **Pause 2 segundos** em cada tela importante antes de clicar. Especialmente na tela de
  consentimento.
- Ferramenta: QuickTime (Mac, "Gravação de Tela") ou OBS. Não precisa de edição.

---

## Parte 1 — Vídeo do TikTok (obrigatório)

**Limites oficiais:** até 5 vídeos, **50 MB cada**. Um vídeo só, de 3 a 5 minutos, resolve.
Se passar de 50 MB, exporte em 1080p a 30 fps, ou divida em dois (Login / Publicação).

**Escopos que precisam aparecer funcionando:** `user.info.basic`, `user.info.stats`,
`video.publish`, `video.upload`. Regra da TikTok: *"All selected products and scopes must be
clearly demonstrated in the video"*. Escopo pedido e não demonstrado é motivo de recusa.

### Cena 1 — O site público (00:00 – 00:25)

1. Abra `https://postflowtiktok.com` numa janela anônima.
2. Role devagar pela página inteira, sem pressa, até o rodapé.
3. **Pare no rodapé** e mostre os links **Termos de Uso** e **Política de Privacidade**.
4. Clique em **Política de Privacidade**, deixe a página abrir, role até a seção que fala do TikTok.
5. Volte.

> Por quê: a TikTok exige site oficial de verdade (*"not just a landing or login page"*) e os dois
> links acessíveis sem precisar caçar em menu.

### Cena 2 — Entrar (00:25 – 00:45)

1. Clique em **Entrar**.
2. Digite o e-mail e a senha da conta de teste. (A senha aparece como pontinhos, tudo bem.)
3. Entre. Deixe o painel carregar.

### Cena 3 — Conectar a conta do TikTok — **esta é a cena mais importante** (00:45 – 01:40)

1. No menu, clique em **Publicação**.
2. Clique em **Conectar outra conta**.
3. **A tela de autorização do TikTok abre. NÃO CORTE AQUI.** Deixe parada por 3 segundos.
4. **Role a tela de permissões devagar**, de cima até embaixo, mostrando cada permissão que o
   TikTok lista.
5. Faça login na conta de teste do TikTok, se pedir.
6. Clique em **Autorizar**.
7. Volte pro Post Flow. **Pare 3 segundos** no card da conta conectada, mostrando o apelido, a foto,
   e os números de **seguidores, curtidas e vídeos no perfil**.

> Por que os números importam: eles são o escopo `user.info.stats` funcionando. Sem isso na tela, o
> escopo fica pedido e não demonstrado.

### Cena 4 — Escolher como o corte chega no TikTok (01:40 – 02:00)

1. Clique em **Configurar postagens dessa conta**.
2. Mostre o bloco **"Como o corte chega no TikTok"**, com as duas opções lado a lado.
3. Leia (ou legende) as duas: *rascunho* e *direto no perfil*.
4. Clique em **Direto no perfil**.

> Por quê: a TikTok analisa se o app trata corretamente a escolha entre rascunho e publicação
> direta, e se essa escolha é do criador — não uma decisão escondida do app.

### Cena 5 — As opções obrigatórias, corte a corte (02:00 – 03:30) — **a cena que a auditoria mais olha**

Na fila, abra o primeiro corte e mostre, **um por um, pausando em cada**:

1. **Apelido e foto da conta** de destino, no topo do bloco.
2. **A prévia do vídeo.** Dê play em alguns segundos. Diga (ou legende): *"no watermark, no logo
   added by the app"*.
3. **"Quem pode ver este vídeo"**: abra a lista. **Mostre que nada vem escolhido por padrão.**
   Escolha uma opção.
4. **"O que as pessoas podem fazer"**: mostre comentar, dueto e junção — **todos desmarcados**.
   Marque um. Se a conta de teste tiver algum desativado, mostre que aparece bloqueado com o
   motivo escrito.
5. **Divulgação comercial**: marque *"Este vídeo divulga uma marca, produto ou serviço"*.
   - Marque **Sua marca** → aponte a frase **"Seu vídeo será marcado como Conteúdo promocional"**.
   - Desmarque e marque **Conteúdo de parceria** → aponte **"Parceria paga"**.
   - **Com a parceria marcada, abra a lista de privacidade de novo** e mostre que **"Só você" está
     desabilitado**, com o motivo.
   - Desligue a divulgação de volta.
6. **A frase de consentimento**, logo acima do botão: *"Ao publicar, você concorda com a
   Confirmação de Uso de Música do TikTok"*. Passe o mouse por cima pra mostrar que é um link.
7. **O aviso de processamento**: *"Depois de publicar, o TikTok pode levar alguns minutos..."*.
8. Clique em **Confirmar e liberar publicação**.

### Cena 6 — Publicar de verdade (03:30 – 04:30)

1. Clique em **Postar agora** naquele corte.
2. Mostre o status mudando para **enviando / processando**.
3. **Abra o aplicativo do TikTok** (ou o tiktok.com) na conta de teste e **mostre o vídeo publicado**.
4. Volte pro Post Flow e mostre o corte na aba **Postados**.

> Se o vídeo demorar, corte e legende "3 minutes later". Terminar mostrando o vídeo dentro do TikTok
> é o que fecha a demonstração.

### O que escrever na descrição do app (campo do formulário)

> Post Flow is a video repurposing tool for creators. It monitors the creator's own YouTube channel,
> uses AI to select the best segments of each new video, renders them as vertical clips with
> burned-in captions, and publishes them to the creator's own TikTok account.
>
> Scope usage:
> - `user.info.basic` — display the connected account's nickname and avatar so the creator always
>   knows which profile a clip will be published to.
> - `user.info.stats` — show follower, like and video counts on the account card.
> - `video.upload` — send the rendered clip as a draft to the creator's TikTok inbox, when the
>   creator chooses that mode.
> - `video.publish` — publish directly to the creator's profile, only after the creator has manually
>   set privacy level, interaction settings and commercial disclosure for that specific clip.
>
> All content published is the creator's own material. The app never adds any watermark, logo or
> promotional text to the video: the only overlays are captions and titles produced from the
> creator's own audio, and the creator can turn them off.

### Cuidados que reprovam na hora

- **Marca d'água.** A regra é literal: o app não pode sobrepor nome, logo ou marca d'água. O Post
  Flow queima legenda e título **do próprio cliente**, nunca a nossa marca. Não mude isso.
- Pedir escopo e não mostrar ele funcionando no vídeo.
- Enquanto a auditoria não passa: no máximo **5 usuários por 24h**, e toda publicação sai como
  **"só eu"**. É esperado — o revisor sabe disso.

---

## Parte 2 — Vídeo do Google (só se pedirem)

Não grave por antecipação. Só grave se o Google solicitar durante a verificação de marca.

**Onde hospedar:** o Google exige **YouTube, com visibilidade "Não listado"**. Não é anexo.

**Duração:** 2 a 3 minutos.

### Os quatro itens que o Google exige, na ordem

A documentação lista exatamente estes:

1. Mostrar o fluxo de consentimento **em inglês**;
2. Mostrar que a tela de consentimento exibe **o nome do app corretamente**;
3. Mostrar que a **barra de endereço** da tela de consentimento contém o **Client ID** do app;
4. Demonstrar **a funcionalidade que cada escopo habilita**.

### Roteiro

**Cena 1 — Home pública (00:00 – 00:20)**
Abra `https://postflowtiktok.com` numa janela anônima, role até o rodapé e clique em **Política de
Privacidade**. Role até a seção que explica o acesso ao Google Drive. Volte.

**Cena 2 — Entrar (00:20 – 00:35)**
Entre com a conta de teste.

**Cena 3 — Iniciar a conexão com o Google (00:35 – 00:50)**
Vá em **Canais**, abra um canal e clique na opção de **enviar os cortes prontos pro Google Drive**.
Clique em **Conectar o Google Drive**.

**Cena 4 — A tela de consentimento (00:50 – 01:40) — a parte que o revisor mais olha**

1. Quando a tela do Google abrir, **pare**.
2. **Dê zoom na barra de endereço** (Cmd + "+" duas vezes) até dar pra ler. O `client_id` tem que
   ficar legível. Segure 3 segundos.
3. Volte o zoom. **Mostre o nome "Post Flow"** na tela de consentimento. Segure 2 segundos.
4. Escolha a conta Google de teste.
5. **Role a lista de permissões devagar.** Cada permissão precisa aparecer.
6. Clique em **Continuar / Permitir**.

**Cena 5 — Mostrar o escopo funcionando (01:40 – 02:40)**

- `userinfo.email`: de volta no Post Flow, mostre o **e-mail da conta Google conectada** aparecendo
  na tela. É literalmente para isso que o escopo serve.
- `drive.file`: escolha a **pasta de destino** do canal, salve, vá em **Cortes**, clique em
  **Enviar pro Drive** num corte pronto. Depois **abra o Google Drive** e **mostre o arquivo lá
  dentro**.

> Terminar mostrando o arquivo dentro do Drive é o que prova o `drive.file`. Sem isso a cena não
> fecha.

### O que escrever na justificativa dos escopos

> **`drive.file`** — Post Flow renders short vertical clips from the user's own long-form videos.
> When the user enables Drive export for a channel, each finished clip is uploaded to a folder the
> user selected. The app only ever writes files it created; it never reads or lists the user's
> existing Drive content.
>
> **`userinfo.email`** — used to display which Google account is connected, so the user can confirm
> the clips are going to the right account, and to prevent connecting the wrong account by mistake.

---

## Ordem recomendada

1. **Hoje:** criar a conta de teste do Post Flow e a conta de teste do TikTok, com um canal e ao
   menos um corte pronto.
2. **Hoje:** enviar a **verificação de marca** do Google (não precisa de vídeo).
3. **Hoje ou amanhã:** gravar o vídeo do TikTok e submeter o app.
4. **Só se o Google pedir:** gravar o vídeo do Google e responder no mesmo chamado.

O TikTok é o caminho longo: a auditoria da Content Posting API costuma levar **1 a 2 semanas** numa
submissão bem feita, e mais se faltar demonstração de algum escopo.

---

## Links oficiais

- [Diretrizes de compartilhamento de conteúdo (TikTok)](https://developers.tiktok.com/doc/content-sharing-guidelines)
- [Diretrizes de análise de app (TikTok)](https://developers.tiktok.com/doc/app-review-guidelines)
- [Content Posting API — publicação direta (TikTok)](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [Verificação de escopo sensível (Google)](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Verificação de marca (Google)](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Classificação dos escopos do Drive (Google)](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

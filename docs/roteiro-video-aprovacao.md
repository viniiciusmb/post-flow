# Aprovação do app no TikTok

Pesquisado nas [Diretrizes de Avaliação de Aplicativos](https://developers.tiktok.com/doc/app-review-guidelines)
em 04/08/2026. As regras mudam; confira o link antes de enviar.

> **O Google já está resolvido.** Os quatro escopos que usamos são não sensíveis e o domínio foi
> verificado — não há vídeo nem análise pendente daquele lado. O histórico está em
> [`aprovacoes-google-tiktok.md`](aprovacoes-google-tiktok.md).

---

## ⚠️ Leia isto antes de enviar: o domínio

As diretrizes de marca do TikTok dizem que **não se pode usar "TikTok" em nome de produto, nome de
empresa, nome de domínio ou URL** sem autorização por escrito. O nosso domínio é
**postflowtiktok.com**.

O nome do app ("Post Flow") está certo. O problema é o endereço, e o revisor vê o endereço: a lista
oficial de motivos de recusa inclui *"violações das diretrizes de marca"*.

**Três caminhos, do mais seguro pro mais arriscado:**

| Caminho | O que acontece |
|---|---|
| Registrar um domínio sem "tiktok" (`postflow.app`, `usepostflow.com`, `postflow.com.br`) e migrar antes de enviar | Elimina o risco. Custa um domínio e um dia de trabalho |
| Enviar assim e ver no que dá | Se recusarem por isso, você perde as semanas da análise e migra depois do mesmo jeito |
| Pedir autorização por escrito ao TikTok | Demora e provavelmente não vem |

**Recomendação: migrar o domínio antes de enviar.** Uma recusa por marca custa mais tempo do que a
migração, e o domínio novo serve pra sempre. Se decidir migrar, me avise: a troca envolve o
`GOOGLE_REDIRECT_URI`, o `TIKTOK_REDIRECT_URI`, as URLs cadastradas nos dois consoles, o canonical
do site e o `llms.txt`. Eu faço tudo de uma vez.

Se preferir enviar assim mesmo, tudo abaixo continua valendo.

---

## Parte 1 — Preencher o formulário

### Informações básicas

| Campo | Valor |
|---|---|
| **Ícone** | `postflowtiktok.com/img/marca/post-flow-icone-1024.png` |
| **Nome** | `Post Flow` |
| **Categoria** | Produtividade (ou a mais próxima de ferramenta de criador) |
| **Descrição** | o texto abaixo |
| **Termos de Serviço** | `https://postflowtiktok.com/termos` |
| **Política de Privacidade** | `https://postflowtiktok.com/privacidade` |
| **Plataformas** | só **Web** |

**Descrição** (limite de 120 caracteres — este tem 107):

```
Transforma os vídeos longos do seu canal do YouTube em cortes verticais legendados e publica no seu TikTok.
```

> Não escreva que o produto está "em testes" ou "em desenvolvimento": app em desenvolvimento é
> motivo de recusa declarado.

Em **Plataformas → Web**, o campo de redirecionamento tem que ser exatamente:

```
https://postflowtiktok.com/auth/tiktok/callback
```

Sem barra no fim. É o endereço que o sistema envia; qualquer diferença quebra a conexão.

### Produtos

Adicione **os dois**, e nenhum além:

- **Login Kit** — conectar a conta.
- **Content Posting API** — publicar. Ative o **Direct Post** dentro dele.

> Produto que você não usa **atrasa ou reprova** a análise. Se tiver adicionado outro pra testar,
> remova antes de enviar.

### Escopos

Os quatro, e só eles:

```
user.info.basic
user.info.stats
video.publish
video.upload
```

O `user.info.stats` só se justifica porque a tela de Publicação mostra seguidores, curtidas e número
de vídeos. Isso precisa aparecer no vídeo (está no roteiro).

### URL properties

Botão no topo da página do app. O Content Posting API exige o domínio verificado ali — mesma ideia
do que o Google pediu. Verifique `postflowtiktok.com`.

### Sandbox → Target users

Adicione a **conta TikTok de teste** na lista. Sem isso ela não consegue autorizar o app, e o vídeo
trava na primeira cena.

Enquanto não há aprovação: **5 contas por 24 horas** e toda publicação sai como **"só eu"**. É
esperado; o revisor sabe.

### Explicação dos produtos e escopos

Cole no campo "Explique como cada produto e escopo funciona" (limite de 1000 — este tem 992):

```
Post Flow is a video repurposing tool for creators. It monitors the creator's own YouTube channel, uses AI to select the best segments of each new video, renders them as vertical clips with burned-in captions, and publishes them to the creator's own TikTok account. Website is in Brazilian Portuguese.

Products and scopes:
- Login Kit / user.info.basic: the creator connects their own TikTok account. We display the nickname and avatar so they always know which profile a clip will go to.
- user.info.stats: we show follower, like and video counts on the connected account card.
- Content Posting API / video.upload: sends the finished clip as a draft to the creator's TikTok inbox, when the creator picks that mode.
- Content Posting API / video.publish: publishes directly to the creator's profile, only after the creator manually sets privacy level, interaction settings and commercial disclosure for that specific clip.

We never add any watermark, logo or promotional text to the video.
```

---

## Parte 2 — Gravar o vídeo

**Limites:** mp4 ou mov, até 5 arquivos, **50 MB cada**. Um vídeo de 3 a 5 minutos resolve. Se
passar de 50 MB, exporte em 1080p a 30 fps.

### Antes de apertar o gravar

- [ ] Conta de teste no Post Flow, com um canal cadastrado e **pelo menos um corte pronto na fila**.
      Gerar corte na hora leva minutos e não dá pra esperar durante a gravação.
- [ ] Use a conta TikTok **#2 ("Aqueles Clipes", modo direto)** — ela tem os quatro escopos. A #1
      está com escopo faltando de uma conexão antiga e não serve pra mostrar o `user.info.stats`.
- [ ] Janela anônima, ou sair de todas as contas. Se o navegador já estiver logado, a tela de
      autorização é pulada — e é ela que o revisor mais olha.
- [ ] Fechar abas, notificações e qualquer coisa com nome de pessoa real na tela.
- [ ] Tela em 1920×1080, zoom do navegador em 100%.

**Como gravar:** mouse devagar, pausa de 2 segundos em cada tela importante, e **sem cortes** nas
partes de autorização. QuickTime ("Gravação de Tela") ou OBS. Não precisa editar.

---

### Cena 1 — O site (00:00 – 00:25)

1. Abra `https://postflowtiktok.com` numa janela anônima.
2. Role a página inteira, devagar, até o rodapé.
3. Pare no rodapé mostrando **Termos de Uso** e **Política de Privacidade**.
4. Clique em Política de Privacidade, role até a parte que fala do TikTok, e volte.

> O domínio que aparece no vídeo tem que ser o mesmo cadastrado no formulário. É item de checagem.

### Cena 2 — Entrar (00:25 – 00:45)

Clique em Entrar, use a conta de teste, deixe o painel carregar.

### Cena 3 — Conectar a conta do TikTok (00:45 – 01:40) — **a cena mais importante**

1. Menu → **Publicação** → **Conectar outra conta**.
2. **A tela de autorização do TikTok abre. NÃO CORTE.** Pare 3 segundos.
3. **Role a lista de permissões devagar**, de cima até embaixo.
4. Faça login na conta de teste, se pedir. Clique em **Autorizar**.
5. De volta no Post Flow, pare 3 segundos no card da conta, mostrando o apelido, a foto e os números
   de **seguidores, curtidas e vídeos** — é o `user.info.stats` funcionando.

### Cena 4 — Escolher o modo (01:40 – 02:00)

1. **Configurar postagens dessa conta**.
2. Mostre o bloco **"Como o corte chega no TikTok"** com as duas opções.
3. Clique em **Direto no perfil**.

### Cena 5 — As opções obrigatórias (02:00 – 03:30) — **a cena que a auditoria mais olha**

Abra o primeiro corte da fila e mostre, **um por um, pausando em cada**:

1. **Apelido e foto** da conta de destino, no topo do bloco.
2. **A prévia do vídeo.** Dê play em alguns segundos. Diga ou legende: *"no watermark, no logo added
   by the app"*.
3. **"Quem pode ver este vídeo"**: abra a lista e **mostre que nada vem escolhido por padrão**.
   Escolha uma opção.
4. **"O que as pessoas podem fazer"**: comentar, dueto e junção, **todos desmarcados**. Marque um.
5. **Divulgação comercial**: marque a caixa.
   - Marque **Sua marca** → aponte *"Seu vídeo será marcado como Conteúdo promocional"*.
   - Desmarque e marque **Conteúdo de parceria** → aponte *"Parceria paga"*.
   - **Com a parceria marcada, abra a lista de privacidade** e mostre que **"Só você" está
     desabilitado**, com o motivo.
   - Desligue a divulgação.
6. **A frase de consentimento** acima do botão: *"Ao publicar, você concorda com a Confirmação de Uso
   de Música do TikTok"*. Passe o mouse pra mostrar que é link.
7. **O aviso de processamento** ("pode levar alguns minutos").
8. **Confirmar e liberar publicação**.

### Cena 6 — Publicar (03:30 – 04:30)

1. **Postar agora** naquele corte.
2. Mostre o status mudando para enviando / processando.
3. **Abra o TikTok** na conta de teste e **mostre o vídeo publicado**.
4. Volte ao Post Flow e mostre o corte na aba **Postados**.

> Se demorar, corte e legende "3 minutes later". Terminar mostrando o vídeo dentro do TikTok é o que
> fecha a demonstração.

---

## O que reprova na hora

- **Marca d'água.** O app não pode sobrepor nome, logo ou marca. O Post Flow queima legenda e título
  **do próprio cliente**, nunca a nossa marca. Não mude isso.
- **Escopo ou produto pedido e não demonstrado** no vídeo.
- **Domínio do vídeo diferente** do cadastrado no formulário.
- **Descrição dizendo que o produto está em testes.**
- **Termos e Privacidade** que não abrem, ou escondidos atrás de menu.
- **Produto ou escopo sobrando** que o app não usa.

---

## Depois de enviar

Uma submissão bem feita costuma levar **1 a 2 semanas**. Incompleta, bem mais.

Enquanto não aprova, o app continua no limite de 5 contas por 24h com publicação "só eu" — o sistema
funciona, só não fica público. **Não troque as chaves de Sandbox pelas de Produção antes da
aprovação**: são credenciais diferentes e a troca derruba as conexões que já existem.

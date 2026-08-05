# TikTok: o que preencher no formulário

Só os valores. O passo a passo de gravar o vídeo está em
[`roteiro-video-aprovacao.md`](roteiro-video-aprovacao.md).

Preencha **igual nos dois lados**, Sandbox e Produção. O vídeo é gravado com o Sandbox (a produção
usa a chave `sb...`), e é a Produção que o revisor analisa.

## Informações básicas

| Campo | Valor |
|---|---|
| Ícone | baixe em `https://postflowclips.com/img/marca/post-flow-icone-1024.png` |
| Nome | `Post Flow` |
| Categoria | Produtividade |
| Termos de Serviço | `https://postflowclips.com/termos` |
| Política de Privacidade | `https://postflowclips.com/privacidade` |
| Plataformas | só **Web** |
| Website URL | `https://postflowclips.com` |
| Redirect URI | `https://postflowclips.com/auth/tiktok/callback` |

**Descrição** (limite 120; este tem 105):

```
Turns your YouTube channel's long videos into captioned vertical clips and publishes them to your TikTok.
```

> Tudo em inglês, inclusive esta descrição. É o idioma em que a TikTok analisa, e um campo em
> português é atrito à toa — o revisor teria que traduzir pra conferir se bate com o que o app faz.

## Produtos

**Login Kit** e **Content Posting API** (com **Direct Post** ativado). Nenhum além — produto que
você não usa atrasa ou reprova a análise.

## Escopos

```
user.info.basic
user.info.stats
video.publish
video.upload
```

## URL properties

Botão no topo da página do app. Verifique `postflowclips.com`. O Content Posting API exige isso.

## Sandbox → Target users

Adicione a conta TikTok de teste. Sem isso ela não consegue autorizar o app.

## Motivo da submissão

A caixa que aparece ao clicar em "Submeter para revisão" (limite 120; este tem 115):

```
First submission. Login Kit and Content Posting API for a tool that clips a creator's own YouTube videos to TikTok.
```

> Esse campo não é decisivo, mas é a primeira coisa que o revisor lê. Ele responde as duas
> perguntas dele: é submissão nova ou recurso de recusa, e o que o app faz em uma linha.
> Numa RE-submissão depois de recusa, troque por: o que foi recusado e o que mudou desde então —
> é o que evita ele repetir a análise inteira do zero.

## Explicação dos produtos e escopos

Limite 1000; este tem 979:

```
Post Flow is a video repurposing tool for creators. It monitors the creator's own YouTube channel, uses AI to select the best segments of each new video, renders them as vertical clips with burned-in captions, and publishes them to the creator's own TikTok account. Available in English, Portuguese and Spanish.

Products and scopes:
- Login Kit / user.info.basic: the creator connects their own TikTok account. We show the nickname and avatar so they always know which profile a clip will go to.
- user.info.stats: we show follower, like and video counts on the connected account card.
- Content Posting API / video.upload: sends the finished clip as a draft to the creator's TikTok inbox, when the creator picks that mode.
- Content Posting API / video.publish: publishes straight to the creator's profile, only after the creator has manually set privacy level, interaction settings and commercial disclosure.

We never add any watermark, logo or promotional text to the video.
```

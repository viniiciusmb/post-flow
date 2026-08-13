# Vídeo da landing page (fluxo automático)

Projeto [Remotion](https://remotion.dev) que gera o vídeo mudo em loop usado na
landing page (`secao-fluxo` em `src/web/views/public/landing.ejs`), mostrando
o fluxo YouTube → Post Flow → TikTok.

Este projeto **não faz parte do build do site** — só o `.mp4`/`.jpg` já
renderizados (em `src/web/public/video/`) são usados em produção. Isto aqui é
só o código-fonte, pra poder editar e re-renderizar quando quiser mudar o
vídeo (nova cor de marca, texto diferente etc.).

## Como editar e re-renderizar

```bash
cd marketing-video
npm install

# abre o Remotion Studio (preview ao vivo, arrasta a linha do tempo)
npm start

# renderiza o .mp4 final
npm run render
```

Depois de renderizar, copie o resultado pro site:

```bash
cp out/fluxo-automatico.mp4 ../src/web/public/video/fluxo-automatico.mp4
```

Se mudar o conteúdo visual de forma que valha a pena atualizar a imagem de
capa (`poster`, mostrada antes do vídeo carregar/tocar), gere um frame novo:

```bash
npx remotion still src/index.ts FluxoAutomatico ../src/web/public/video/fluxo-automatico-poster.jpg --frame=25
```

## Onde estão as coisas

- `src/FluxoAutomatico.tsx` — a composição inteira (timeline, animações).
- `src/icons.tsx` — marcas do YouTube/TikTok/Post Flow, copiadas dos partials
  EJS reais (`src/web/views/partials/logo-*.ejs`, `brand-mark.ejs`) pra ficar
  idêntico ao resto do site.
- `src/Root.tsx` — dimensões (1920×1080), fps (30) e duração (240 frames = 8s)
  da composição.

As cores usadas são as mesmas variáveis de `src/web/public/css/public.css`
(`--yt`, `--tt-ciano`, `--tt-rosa`, `--acento`, `--ink` etc.) copiadas à mão -
se a paleta do site mudar lá, precisa atualizar aqui também.

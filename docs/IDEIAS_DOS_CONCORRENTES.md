# Ideias dos concorrentes para implementar no Post Flow

Pesquisa de 06/10/2026 nos sites de **Cut.pro**, **OpusClip**, **Submagic** e nas plataformas de
**campeonato de cortes** (Real Oficial e parecidas). Serve de lista de ideias: cada item diz o que o
concorrente faz, se já temos, e quanto custaria fazer. Atualize quando algo for construído.

Legenda de esforço: **P** = pequeno (até 1 dia) · **M** = médio (2 a 5 dias) · **G** = grande (semanas).

---

## Quem é quem

| | O que é | Preço | Modelo de crédito |
|---|---|---|---|
| **Cut.pro** (BR) | Corte com IA de vídeo longo **e de live** (Twitch, Kick, YouTube), publica em 13 redes | Free 15 créditos · Básico R$19,90 (100) · Plus R$69,90 (1.000, com live) · Pro R$119,90 (2.500) | **1 crédito = 1 minuto analisado**, live inclusa (3h de live = 180 créditos). Live só no Plus e no Pro |
| **OpusClip** (EUA) | O maior do mundo em corte com IA de vídeo longo | Free 60 min · Starter US$15 (150 min) · Pro US$29 (300 min) | 1 crédito = 1 minuto importado, vencem em 60 dias |
| **Submagic** | Foco em **legenda animada** (estilo Hormozi), emoji, zoom, b-roll, título-gancho | assinatura | por vídeo |
| **Real Oficial** e afins (Viewx, Clipei, Clipou, KlipCorte…) | **Marketplace de campeonato de cortes**: marca/streamer abre campanha com prêmio, o "clipador" corta com qualquer ferramenta, posta na conta dele e cola o link; a plataforma mede as views e paga | o anunciante paga | não é ferramenta de corte |

Onde já estamos à frente: publicação automática no TikTok com fila e horário, cortes de live com
formato montado pela IA (webcam + conteúdo), posição do título decidida pela IA, notas por tipo de
momento, retomada de processamento, preço em real com PIX Automático.

Onde estamos atrás: legenda animada, número de redes, app de celular, live do YouTube, modelos
salvos de estilo.

---

## 1. Legenda e título (o que o cliente vê primeiro)

| Ideia | Quem tem | Temos? | Esforço |
|---|---|---|---|
| **Legenda estilo Hormozi**: 2 a 4 palavras por vez, MAIÚSCULA condensada, palavra-chave colorida (amarelo = ênfase, verde = dinheiro/vitória, vermelho = erro/alerta) | Submagic, OpusClip, Cut.pro ("karaokê") | Parcial: mostramos 1 palavra por vez, sem destaque | **M** (a IA já classifica o momento; pedir a ela a palavra-chave por frase é barato) |
| **Emoji automático** ao lado da palavra que ele reforça | Submagic | Não | **P** (lista fixa palavra→emoji + fonte de emoji no container) |
| **Animação do título**: fade, subir, "pop"/quique, máquina de escrever | OpusClip | Não (título parado) | **P** (tags `\fad`, `\move`, `\t` do ASS) |
| **Animação da legenda**: palavra cresce ao entrar, cor muda na palavra falada (karaokê) | Todos | Não | **P/M** |
| **Título-gancho gerado pela IA** pros 3 primeiros segundos | Submagic, OpusClip | **Sim** (título do corte) | — |
| **Mais modelos de título**, inclusive simples sem balão | OpusClip (dezenas de templates) | **Feito em 06/10/2026**: 12 modelos novos (simples, sombra, amarelo fino, borda branca, espaçado, brilho rosa/azul, destaque amarelo/verde, faixa preta/branca/colorida) | — |
| **Título que não cobre nada** | OpusClip ("ajuste para não cobrir o vídeo", manual) | **Feito em 06/10/2026, automático nas lives** (liveTextoService) | Levar pro fluxo do YouTube: **M** |
| **Zonas seguras** desenhadas no editor (onde o TikTok cobre com botões/descrição) | OpusClip | Não (o render evita, o editor não mostra) | **P** |
| **Meus estilos**: salvar vários modelos com nome e escolher por canal | OpusClip ("brand template"), Cut.pro ("estratégia por canal") | Parcial (1 estilo padrão + 1 por canal) | **M** |
| **Barra de progresso** fina no rodapé do corte | Submagic | Não | **P** |
| **Zoom de ênfase** ("punch-in" de 5-10% na palavra forte) | Submagic | Não | **M** |
| **Marca d'água/logo** do cliente | Cut.pro, OpusClip | Não | **P** |

## 2. Escolha dos momentos

| Ideia | Quem tem | Temos? | Esforço |
|---|---|---|---|
| **Nota de viralização 0-100** visível em cada corte, com o porquê (gancho, emoção, desfecho) | Cut.pro, OpusClip | Parcial: nota 0-10 na tela de Lives; o juiz já dá nota por partes, só não mostramos | **P** |
| **Estratégia de corte salva por canal** (ex.: "só tretas e dinheiro" num canal, "humor" noutro) | Cut.pro | Parcial (tipos de corte valem pra todos os canais) | **P/M** |
| **Detecção de quem fala** e troca de enquadramento entre pessoas | Cut.pro, OpusClip | Parcial: o formato da IA mostra todos ao mesmo tempo (painéis); não alterna | **G** |
| **Corte de live do YouTube** (além de Twitch/Kick) | Cut.pro | Não | **M** (streamlink já lê YouTube; o cuidado é o bloqueio de bot) |
| **Lote de 10 em 10 minutos durante a live** | Cut.pro | **Sim** (triagem a cada 2 min, seleção a cada 10) | — |
| **Remover silêncio e "é… hum"** | OpusClip, Cut.pro (ferramenta avulsa) | Não | **M** |
| **B-roll automático** (imagem/vídeo de banco ilustrando o que é dito) | OpusClip, Submagic | Não | **G** (banco de imagens pago + escolha por IA) |
| **Música de fundo / efeito sonoro** | Submagic | Não | **M** (licença das músicas é o problema, não o código) |

## 3. Publicação e distribuição

| Ideia | Quem tem | Temos? | Esforço |
|---|---|---|---|
| **Instagram Reels, YouTube Shorts** e outras redes | Cut.pro (13 redes), OpusClip | Só TikTok | **G** (ver memória `post-flow-instagram-api-terceiros`) |
| **Horário recomendado pela IA** | Cut.pro | Parcial (horários padrão em hora cheia) | **M** (dá pra usar as métricas de views que já coletamos) |
| **Corte de live publicado sozinho** no TikTok | Cut.pro | Não (cortes de live ainda não entram na fila de postagem) | **M** |
| **Exportar em 1:1 e 16:9** além do 9:16 | OpusClip | Não | **M** |
| **Exportar pro Premiere/DaVinci** (XML) | OpusClip | Não | **M** |

## 4. Produto e negócio

| Ideia | Quem tem | Temos? | Esforço |
|---|---|---|---|
| **Plano grátis** com poucos créditos e sem cartão | Cut.pro (15), OpusClip (60 min) | Não | **P** no código; decisão de negócio |
| **Campeonato de cortes dentro do Post Flow**: streamer/marca abre campanha com prêmio, nossos clientes cortam com 1 clique e já publicam; as views do TikTok já são medidas por nós (temos a API) | Real Oficial, Viewx, Clipei… (marketplace); Cut.pro (campanha self-service a partir de R$5.000) | Não | **G**, mas é um motor de aquisição: quem entra pela campanha vira assinante |
| **Painel do clipador**: views, seguidores ganhos e ranking por corte publicado | Plataformas de campeonato | Parcial (métricas por conta) | **M** |
| **App de celular** com editor | Cut.pro, OpusClip | Não | **G** |
| **API pública / MCP** pra automação | Cut.pro | Não | **M** |
| **Workspaces para agência** (vários clientes, equipes separadas) | Cut.pro | Não | **G** |
| **Créditos que acumulam** (validade de 60-90 dias) em vez de cota semanal | Cut.pro (90 dias), OpusClip (60 dias) | Cota semanal + avulso que não vence | decisão de negócio; ver `docs/PLANO_DE_CREDITOS_LIVES.md` |

---

## Sugestão de ordem

1. **Rápido e visível** (cada um em 1 dia): animação do título, barra de progresso, nota 0-100 com o
   porquê, zonas seguras no editor, emoji automático.
2. **Legenda estilo Hormozi** com palavra-chave colorida: é o formato que mais aparece nos cortes
   que viralizam, e todos os concorrentes têm.
3. **Cortes de live entrando na fila do TikTok** e **cobrança de live no mesmo crédito**
   (plano em `docs/PLANO_DE_CREDITOS_LIVES.md`): sem isso a tela de Lives não fecha o ciclo.
4. **Live do YouTube** e **Meus estilos**.
5. **Campeonato de cortes**: maior esforço, mas é o único item que traz cliente novo sozinho.

## Fontes

- Cut.pro: https://cut.pro/pt-BR · https://cut.pro/pt-BR/blog/clipping-campaign-platforms-comparison-2026 ·
  https://cut.pro/pt-BR/blog/campeonato-de-cortes-como-funciona-2026
- OpusClip: https://www.opus.pro/tools/add-title-to-video · preços em
  https://www.castmagic.io/blog/opus-clip-pricing
- Submagic: https://www.submagic.co/blog/how-to-make-alex-hormozi-captions ·
  https://submagic.co/alternatives/vizard

# Fontes das legendas e títulos

Ficam commitadas aqui e são copiadas para dentro da imagem no Dockerfile, em
vez de baixadas durante o build. Motivo: build que depende de rede quebra sem
avisar e num momento ruim — foi o que aconteceu quando o Dockerfile tentou
compilar o programa de bandeja (ver "Regra operacional nº 2" no CLAUDE.md).

Todas são de licença aberta (SIL Open Font License), que permite uso
comercial e redistribuição dentro da imagem.

| Arquivo | Fonte | Para quê |
|---|---|---|
| `Anton-Regular.ttf` | Anton | Pesada e condensada — o visual de legenda de corte viral |
| `BebasNeue-Regular.ttf` | Bebas Neue | Condensada em caixa alta, alta e estreita |
| `Poppins-Bold.ttf` | Poppins | Geométrica arredondada, mais suave |

Liberation Sans (equivalente métrico do Arial) vem do pacote
`fonts-liberation`, instalado pelo apt no Dockerfile.

**Antes de adicionar uma fonte nova**: confira que ela é ESTÁTICA, não
variável. Fonte variável carrega vários pesos num arquivo só, e o libass (que
desenha a legenda) usa o peso padrão — quase sempre Regular. O resultado é a
tela prometer "ExtraBold" e o vídeo sair com um texto fino. Foi por isso que
Montserrat e Oswald ficaram de fora: só existem em versão variável no
repositório do Google Fonts.

Para conferir se uma fonte foi mesmo reconhecida dentro do container:

    docker exec <video-worker> fc-list : family

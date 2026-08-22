-- Mais controle sobre legenda e título: fonte, altura e novos modelos.
--
-- Antes disso, TODA legenda saía numa fonte que ninguém escolheu. Os estilos
-- pediam "Arial Black", mas o container só tinha DejaVu instalado — e o libass
-- cai numa fonte existente em silêncio, sem erro nenhum. A tela mostrava um
-- visual e o vídeo saía com outro. As fontes agora vão dentro da imagem (ver
-- assets/fonts/LEIA-ME.md) e passam a ser escolha do cliente.
ALTER TABLE client_video_settings
  -- Nome da família como o libass enxerga (o mesmo que `fc-list : family`
  -- devolve dentro do container). Não é caminho de arquivo: fonte trocada de
  -- lugar quebraria todo estilo salvo.
  ADD COLUMN caption_font TEXT NOT NULL DEFAULT 'Anton',
  ADD COLUMN title_font   TEXT NOT NULL DEFAULT 'Anton',

  -- Altura na tela, em % da altura do vídeo, medida a partir da BORDA MAIS
  -- PRÓXIMA: legenda sobe a partir de baixo, título desce a partir de cima.
  -- Medir assim (em vez de "distância do topo" para os dois) é o que faz a
  -- barra de arrastar se comportar como a pessoa espera — arrastar para cima
  -- sobe a legenda, arrastar para baixo desce o título.
  ADD COLUMN caption_height_percent SMALLINT NOT NULL DEFAULT 14
    CHECK (caption_height_percent BETWEEN 0 AND 80),
  ADD COLUMN title_height_percent   SMALLINT NOT NULL DEFAULT 8
    CHECK (title_height_percent BETWEEN 0 AND 80);

-- Duração de corte mais longa, pedida para conteúdo de entrevista/podcast,
-- onde 90s corta a resposta no meio.
ALTER TABLE client_video_settings
  DROP CONSTRAINT IF EXISTS client_video_settings_clip_length_check;
ALTER TABLE client_video_settings
  ADD CONSTRAINT client_video_settings_clip_length_check
    CHECK (clip_length IN ('short', 'balanced', 'long', 'extra_long'));

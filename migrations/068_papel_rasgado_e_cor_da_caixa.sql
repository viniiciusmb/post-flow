-- Título dentro de um retângulo ou de um papel rasgado, com a cor escolhida.
--
-- Os modelos com caixa já existiam, mas cada um tinha uma cor fixa embutida —
-- quem quisesse laranja não tinha como pedir. Agora a cor é do cliente, e um
-- modelo só cobre qualquer cor.
--
-- O papel rasgado não é feito pelo formato de legenda: ele só sabe desenhar
-- contorno ou retângulo. É uma imagem PNG com transparência (gerada por
-- assets/../scripts/gerar-papel-rasgado.js, sempre igual) sobreposta ao vídeo
-- e tingida pelo ffmpeg com a cor escolhida. Por isso é um estilo de TÍTULO
-- apenas: a legenda aparece palavra por palavra, e uma faixa larga atrás de
-- uma palavra só ficaria desproporcional.
ALTER TABLE client_video_settings
  -- Cor em hexadecimal (#RRGGBB), como a tela envia. A conversão para o
  -- formato do ffmpeg/ASS acontece no código, num lugar só.
  ADD COLUMN title_box_color   TEXT NOT NULL DEFAULT '#D92323',
  ADD COLUMN caption_box_color TEXT NOT NULL DEFAULT '#D92323';

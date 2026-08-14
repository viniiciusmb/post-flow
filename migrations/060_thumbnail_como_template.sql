-- "Usar a thumbnail do vídeo como template".
--
-- Já existia o fundo 'template': uma imagem FIXA, enviada pelo cliente, que
-- preenche o quadro inteiro e aparece em volta do vídeo. O que falta é outra
-- coisa: usar a capa DAQUELE vídeo (a thumbnail do YouTube) como uma FAIXA
-- colada ao vídeo — imagem em cima, vídeo embaixo (ou o contrário).
--
-- A diferença que importa: 'template' é uma imagem só pra todos os cortes;
-- 'thumbnail' muda a cada vídeo, sem o cliente enviar nada.
--
-- thumbnail_position diz de que lado fica a faixa da imagem. Não reaproveita
-- background_video_offset_percent (que posiciona o vídeo livremente no quadro)
-- porque aqui as duas peças são coladas: escolher "em cima" já determina que o
-- vídeo fica embaixo, encostado, sem sobra possível entre eles.

ALTER TABLE client_video_settings
  DROP CONSTRAINT IF EXISTS client_video_settings_background_style_check;

ALTER TABLE client_video_settings
  ADD CONSTRAINT client_video_settings_background_style_check
    CHECK (background_style IN ('blur', 'black', 'white', 'template', 'thumbnail'));

ALTER TABLE client_video_settings
  ADD COLUMN IF NOT EXISTS thumbnail_position TEXT NOT NULL DEFAULT 'top'
    CHECK (thumbnail_position IN ('top', 'bottom'));

-- Fundo "frame do vídeo": o sistema tira um quadro do PRÓPRIO trecho e usa
-- como a faixa de cima (ou de baixo), do mesmo jeito que já fazia com a capa
-- do vídeo.
--
-- A diferença para a capa é justamente o ponto: a capa é a mesma imagem nos N
-- cortes do vídeo, enquanto o frame é tirado de dentro de cada corte — então
-- cada um fica com uma imagem própria, coerente com o que está sendo dito ali.
ALTER TABLE client_video_settings
  DROP CONSTRAINT IF EXISTS client_video_settings_background_style_check;
ALTER TABLE client_video_settings
  ADD CONSTRAINT client_video_settings_background_style_check
    CHECK (background_style IN ('blur', 'black', 'white', 'template', 'thumbnail', 'frame'));

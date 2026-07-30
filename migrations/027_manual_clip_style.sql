-- Estilo de corte manual e interativo: alem do "automatico" que ja existia
-- (framing crop/blur_pad, 3 legendas fixas), o cliente pode agora escolher
-- "manual" e ajustar um enquadramento continuo (arrastando), estilos de
-- legenda "balao" (fundo colorido atras do texto) e numeracao opcional dos
-- cortes de um mesmo video ("Parte 1", "Parte 2"...).

ALTER TABLE client_video_settings
  ADD COLUMN crop_style_mode TEXT NOT NULL DEFAULT 'auto' CHECK (crop_style_mode IN ('auto', 'manual')),
  -- 100 = recorte apertado (igual ao framing='crop' de hoje, preenche a tela
  -- mostrando menos do video original); 0 = video original inteiro visivel
  -- (igual ao framing='blur_pad' de hoje, sobra com fundo desfocado). So
  -- usado quando crop_style_mode='manual' - no modo 'auto' o comportamento
  -- continua exatamente o de sempre, via framing/aspect_ratio.
  ADD COLUMN crop_zoom_percent SMALLINT NOT NULL DEFAULT 100 CHECK (crop_zoom_percent BETWEEN 0 AND 100),
  ADD COLUMN show_part_label BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN part_label_position TEXT NOT NULL DEFAULT 'top_right'
    CHECK (part_label_position IN ('top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'));

-- 2 presets novos de legenda "balao" (fundo colorido atras do texto),
-- somados aos 3 que ja existiam.
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_caption_style_check,
  ADD CONSTRAINT client_video_settings_caption_style_check
    CHECK (caption_style IN ('classic', 'bold', 'minimal', 'none', 'bubble_purple', 'bubble_dark'));

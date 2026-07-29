-- Como escolher os cortes de um video:
--   'best_parts' -> a IA escolhe os melhores trechos, ate max_clips (comportamento
--                   original, agora com max_clips sem teto fixo de 8)
--   'full_video' -> o video inteiro vira um unico corte (sem IA escolhendo trecho)
--   'unlimited'  -> a IA escolhe quantos trechos bons couberem no video, sem
--                   respeitar max_clips (so limitado pela duracao real)
ALTER TABLE client_video_settings
  ADD COLUMN clip_mode TEXT NOT NULL DEFAULT 'best_parts' CHECK (clip_mode IN ('best_parts', 'full_video', 'unlimited')),
  DROP CONSTRAINT client_video_settings_max_clips_check,
  ADD CONSTRAINT client_video_settings_max_clips_check CHECK (max_clips BETWEEN 1 AND 30);

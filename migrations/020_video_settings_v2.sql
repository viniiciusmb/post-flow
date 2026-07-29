-- Reorganiza o modo de corte pra 3 opcoes mutuamente exclusivas e claras:
--   'ai_choice'   -> a IA decide quantos cortes (sem numero fixo) - era 'unlimited'
--   'full_video'  -> o video inteiro vira um corte so (sem mudanca)
--   'fixed_count' -> o cliente escolhe exatamente quantos cortes - era 'best_parts'
-- (o nome antigo 'best_parts' causava confusao: parecia uma 4a opcao, mas na
-- pratica sempre exigia escolher a quantidade tambem.)
UPDATE client_video_settings SET clip_mode = 'fixed_count' WHERE clip_mode = 'best_parts';
UPDATE client_video_settings SET clip_mode = 'ai_choice' WHERE clip_mode = 'unlimited';

ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_clip_mode_check,
  ADD CONSTRAINT client_video_settings_clip_mode_check CHECK (clip_mode IN ('ai_choice', 'full_video', 'fixed_count')),
  ALTER COLUMN clip_mode SET DEFAULT 'ai_choice';

-- Titulo (o mesmo que a IA ja gera pra cada corte) queimado nos primeiros
-- segundos do video - opcional, desligado nao muda nada no video.
ALTER TABLE client_video_settings
  ADD COLUMN show_title BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN title_seconds SMALLINT NOT NULL DEFAULT 3 CHECK (title_seconds BETWEEN 1 AND 15);

-- Descricao do corte (usada futuramente como legenda ao postar): 'auto' a IA
-- escreve uma pra cada corte, 'fixed' sempre usa o mesmo texto (description_template).
ALTER TABLE client_video_settings
  ADD COLUMN description_mode TEXT NOT NULL DEFAULT 'auto' CHECK (description_mode IN ('auto', 'fixed', 'none')),
  ADD COLUMN description_template TEXT;

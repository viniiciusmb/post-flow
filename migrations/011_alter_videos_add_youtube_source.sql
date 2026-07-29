-- Ate aqui "videos" so guardava arquivos vindos do Google Drive. Agora um
-- video tambem pode ser um corte gerado a partir de um video do YouTube -
-- entao os campos de origem do Drive viram opcionais, e ganhamos um campo
-- pra dizer de onde veio cada linha, mais o link pro corte quando for o caso.
ALTER TABLE videos
  ALTER COLUMN drive_folder_id DROP NOT NULL,
  ALTER COLUMN drive_file_id DROP NOT NULL,
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'drive'
    CHECK (source_type IN ('drive', 'youtube_clip')),
  ADD COLUMN clip_id BIGINT REFERENCES clips(id) ON DELETE CASCADE;

-- drive_file_id era UNIQUE NOT NULL (garante contra arquivo duplicado do Drive).
-- Agora que pode ser nulo, precisa virar indice unico parcial.
ALTER TABLE videos DROP CONSTRAINT videos_drive_file_id_key;
CREATE UNIQUE INDEX uq_videos_drive_file_id ON videos (drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE UNIQUE INDEX uq_videos_clip_id ON videos (clip_id) WHERE clip_id IS NOT NULL;

ALTER TABLE videos ADD CONSTRAINT chk_videos_source_consistency CHECK (
  (source_type = 'drive' AND drive_folder_id IS NOT NULL AND drive_file_id IS NOT NULL AND clip_id IS NULL) OR
  (source_type = 'youtube_clip' AND clip_id IS NOT NULL AND drive_folder_id IS NULL AND drive_file_id IS NULL)
);

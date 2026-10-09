-- Cortes de LIVE no Feed de cortes e na fila de publicação do TikTok (08/10/2026).
--
-- 1. `videos` (a linha que a postagem aponta) passa a poder ser um corte de
--    live, além de arquivo do Drive e corte do YouTube.
-- 2. `cortes_da_fila` junta os dois tipos de corte publicável numa forma só,
--    pra fila de publicação ler título, legenda, duração e arquivo sem saber de
--    onde o corte veio. `id` é o do corte do YouTube e fica NULO no de live
--    (que vai em `live_clip_id`): quem apaga corte pelo `id` - a limpeza de 3
--    dias - nunca pode confundir um corte de live com um do YouTube de mesmo
--    número.
-- 3. "Gostei" dos cortes de live, separado do dos cortes do YouTube (são
--    tabelas diferentes, e uma chave estrangeira só aponta pra uma).
ALTER TABLE videos ADD COLUMN live_clip_id BIGINT REFERENCES live_clips(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_videos_live_clip_id ON videos (live_clip_id) WHERE live_clip_id IS NOT NULL;

ALTER TABLE videos DROP CONSTRAINT videos_source_type_check;
ALTER TABLE videos ADD CONSTRAINT videos_source_type_check CHECK (source_type IN ('drive', 'youtube_clip', 'live_clip'));

ALTER TABLE videos DROP CONSTRAINT chk_videos_source_consistency;
ALTER TABLE videos ADD CONSTRAINT chk_videos_source_consistency CHECK (
  (source_type = 'drive' AND drive_folder_id IS NOT NULL AND drive_file_id IS NOT NULL AND clip_id IS NULL AND live_clip_id IS NULL) OR
  (source_type = 'youtube_clip' AND clip_id IS NOT NULL AND live_clip_id IS NULL AND drive_folder_id IS NULL AND drive_file_id IS NULL) OR
  (source_type = 'live_clip' AND live_clip_id IS NOT NULL AND clip_id IS NULL AND drive_folder_id IS NULL AND drive_file_id IS NULL)
);

CREATE VIEW cortes_da_fila AS
  SELECT v.id AS video_id, 'youtube'::text AS origem, c.id, NULL::bigint AS live_clip_id,
         c.title, c.description, c.start_seconds, c.end_seconds,
         c.local_clip_path, c.thumbnail_path, c.source_video_id
    FROM videos v JOIN clips c ON c.id = v.clip_id
  UNION ALL
  SELECT v.id, 'live', NULL::bigint, lc.id,
         lc.title, lc.hook, lc.start_offset, lc.end_offset,
         lc.local_clip_path, lc.thumbnail_path, NULL::bigint
    FROM videos v JOIN live_clips lc ON lc.id = v.live_clip_id;

CREATE TABLE live_clip_likes (
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_clip_id   BIGINT NOT NULL REFERENCES live_clips(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_user_id, live_clip_id)
);

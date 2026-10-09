DROP TABLE IF EXISTS live_clip_likes;
DROP VIEW IF EXISTS cortes_da_fila;
DELETE FROM videos WHERE source_type = 'live_clip';
ALTER TABLE videos DROP CONSTRAINT chk_videos_source_consistency;
ALTER TABLE videos ADD CONSTRAINT chk_videos_source_consistency CHECK (
  (source_type = 'drive' AND drive_folder_id IS NOT NULL AND drive_file_id IS NOT NULL AND clip_id IS NULL) OR
  (source_type = 'youtube_clip' AND clip_id IS NOT NULL AND drive_folder_id IS NULL AND drive_file_id IS NULL)
);
ALTER TABLE videos DROP CONSTRAINT videos_source_type_check;
ALTER TABLE videos ADD CONSTRAINT videos_source_type_check CHECK (source_type IN ('drive', 'youtube_clip'));
DROP INDEX IF EXISTS uq_videos_live_clip_id;
ALTER TABLE videos DROP COLUMN live_clip_id;

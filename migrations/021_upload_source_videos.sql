-- Cliente tambem pode enviar o arquivo de video direto (upload), sem passar
-- pelo YouTube - nesse caso nao ha youtube_video_id nenhum.
ALTER TABLE source_videos ALTER COLUMN youtube_video_id DROP NOT NULL;
ALTER TABLE source_videos DROP CONSTRAINT source_videos_youtube_video_id_key;
CREATE UNIQUE INDEX uq_source_videos_youtube_video_id ON source_videos (youtube_video_id) WHERE youtube_video_id IS NOT NULL;

ALTER TABLE source_videos DROP CONSTRAINT chk_source_videos_origin_consistency;
ALTER TABLE source_videos ADD CONSTRAINT chk_source_videos_origin_consistency CHECK (
  (input_type = 'channel' AND youtube_channel_id IS NOT NULL AND client_user_id IS NULL) OR
  (input_type = 'manual' AND youtube_channel_id IS NULL AND client_user_id IS NOT NULL) OR
  (input_type = 'upload' AND youtube_channel_id IS NULL AND client_user_id IS NOT NULL)
);

ALTER TABLE source_videos DROP CONSTRAINT source_videos_input_type_check;
ALTER TABLE source_videos ADD CONSTRAINT source_videos_input_type_check CHECK (input_type IN ('channel', 'manual', 'upload'));

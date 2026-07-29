-- Ate aqui todo source_video vinha da checagem periodica de um canal do
-- YouTube. Agora o cliente tambem pode colar o link de um video avulso -
-- entao o canal vira opcional e ganhamos uma coluna pra saber a origem e
-- de quem e o video quando nao ha canal (input manual nao pertence a
-- nenhum canal, pertence direto ao cliente).
ALTER TABLE source_videos
  ALTER COLUMN youtube_channel_id DROP NOT NULL,
  ADD COLUMN client_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN input_type TEXT NOT NULL DEFAULT 'channel' CHECK (input_type IN ('channel', 'manual'));

ALTER TABLE source_videos ADD CONSTRAINT chk_source_videos_origin_consistency CHECK (
  (input_type = 'channel' AND youtube_channel_id IS NOT NULL AND client_user_id IS NULL) OR
  (input_type = 'manual' AND youtube_channel_id IS NULL AND client_user_id IS NOT NULL)
);

CREATE INDEX idx_source_videos_client_user_id ON source_videos (client_user_id);

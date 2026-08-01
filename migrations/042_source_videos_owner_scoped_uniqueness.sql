-- Ate aqui, um video do YouTube (youtube_video_id) so podia existir UMA vez
-- em todo o sistema, nao importa qual cliente - isso impedia dois clientes
-- DIFERENTES de processarem o mesmo video publico de forma independente
-- (cada um pagando o proprio credito), inclusive no caso legitimo de dois
-- canais diferentes (de clientes diferentes) apontarem pro mesmo canal real
-- do YouTube. owner_client_user_id deixa explicito quem e o dono de cada
-- linha mesmo pra video de canal (antes so dava pra saber via JOIN em
-- youtube_channels), e a unicidade passa a ser por (video, dono).
ALTER TABLE source_videos ADD COLUMN owner_client_user_id BIGINT REFERENCES users(id);

UPDATE source_videos sv
SET owner_client_user_id = yc.client_user_id
FROM youtube_channels yc
WHERE sv.youtube_channel_id = yc.id;

UPDATE source_videos
SET owner_client_user_id = client_user_id
WHERE owner_client_user_id IS NULL AND client_user_id IS NOT NULL;

ALTER TABLE source_videos ALTER COLUMN owner_client_user_id SET NOT NULL;

DROP INDEX uq_source_videos_youtube_video_id;
CREATE UNIQUE INDEX uq_source_videos_video_per_owner
  ON source_videos (youtube_video_id, owner_client_user_id)
  WHERE youtube_video_id IS NOT NULL;

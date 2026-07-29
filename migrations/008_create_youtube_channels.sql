-- Canais do YouTube que cada cliente cadastra pra monitorar.
CREATE TABLE youtube_channels (
  id                        BIGSERIAL PRIMARY KEY,
  client_user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  youtube_channel_id        TEXT NOT NULL,        -- ex: UCxxxxxxxxxxxxxxxxxxxxxx
  channel_name              TEXT,
  channel_url               TEXT NOT NULL,
  avatar_url                TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  last_polled_at            TIMESTAMPTZ,
  last_video_published_at   TIMESTAMPTZ,          -- ponto de corte: so processa video mais novo que isso
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_user_id, youtube_channel_id)
);

CREATE INDEX idx_youtube_channels_client_user_id ON youtube_channels (client_user_id);
CREATE INDEX idx_youtube_channels_active ON youtube_channels (is_active) WHERE is_active = true;

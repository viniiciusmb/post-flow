-- Cortes gerados a partir de um video-fonte (escolhidos pela IA).
CREATE TABLE clips (
  id                BIGSERIAL PRIMARY KEY,
  source_video_id   BIGINT NOT NULL REFERENCES source_videos(id) ON DELETE CASCADE,

  title             TEXT NOT NULL,      -- sugerido pela IA
  start_seconds     NUMERIC NOT NULL,
  end_seconds       NUMERIC NOT NULL,

  local_clip_path   TEXT,               -- arquivo final: cortado + reenquadrado + legendado
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'rendering', 'ready', 'error')),
  error_message     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clips_source_video_id ON clips (source_video_id);

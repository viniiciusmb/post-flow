-- Videos detectados nos canais monitorados (o video-fonte, antes de virar corte).
CREATE TABLE source_videos (
  id                    BIGSERIAL PRIMARY KEY,
  youtube_channel_id    BIGINT NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  youtube_video_id      TEXT NOT NULL UNIQUE,     -- dedup: nunca processa o mesmo video 2x
  title                 TEXT NOT NULL,
  thumbnail_url         TEXT,
  published_at          TIMESTAMPTZ,
  duration_seconds      INT,

  status                TEXT NOT NULL DEFAULT 'detected'
                          CHECK (status IN (
                            'detected', 'downloading', 'transcribing',
                            'selecting_clips', 'cutting', 'ready', 'error'
                          )),
  error_message         TEXT,

  local_video_path      TEXT,     -- onde o video baixado fica em disco (apagado depois de pronto)
  transcript_text       TEXT,     -- transcricao completa em texto puro
  transcript_words      JSONB,    -- [{ "word": "...", "start": 0.0, "end": 0.4 }, ...] do Whisper

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_videos_channel_id ON source_videos (youtube_channel_id);
CREATE INDEX idx_source_videos_status ON source_videos (status);

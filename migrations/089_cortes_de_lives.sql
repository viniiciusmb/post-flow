-- Modulo de cortes de lives da Twitch (fase de validacao, so admin).
--
-- Nenhuma tabela existente e alterada: tudo aqui e novo e comeca com "live_",
-- pra dar pra desligar e apagar o modulo inteiro sem encostar no fluxo do
-- YouTube. Reversao em migrations/reversao/089_cortes_de_lives.down.sql.
--
-- A chave geral (settings.lives_enabled) nasce DESLIGADA: aplicar esta
-- migration nao faz nada acontecer sozinho.

-- Um canal existe UMA vez, nao importa quantos usuarios o acompanhem: a
-- gravacao e compartilhada (uma por canal), e so a escolha dos cortes e de
-- cada um.
CREATE TABLE live_channels (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'twitch' CHECK (platform IN ('twitch')),
  login TEXT NOT NULL,
  display_name TEXT,
  platform_user_id TEXT,
  profile_image_url TEXT,
  is_live BOOLEAN NOT NULL DEFAULT false,
  stream_title TEXT,
  game_name TEXT,
  viewer_count INTEGER,
  last_checked_at TIMESTAMPTZ,
  last_live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, login)
);

CREATE TABLE live_channel_follows (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_channel_id BIGINT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, live_channel_id)
);
CREATE INDEX idx_live_channel_follows_channel ON live_channel_follows (live_channel_id) WHERE is_active;

-- Uma sessao = uma transmissao gravada. Os tempos dos segmentos, das
-- transcricoes e dos cortes sao OFFSETS em segundos desde o inicio da
-- gravacao (started_at), nao carimbos de relogio: e o eixo que o ffmpeg
-- entrega, e o que da pra usar direto pra cortar.
CREATE TABLE live_sessions (
  id BIGSERIAL PRIMARY KEY,
  live_channel_id BIGINT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
  platform_stream_id TEXT,
  title TEXT,
  game_name TEXT,
  status TEXT NOT NULL DEFAULT 'gravando'
    CHECK (status IN ('gravando', 'encerrada', 'interrompida', 'erro')),
  stop_reason TEXT,
  dir_path TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  recorded_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  triaged_until NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_selection_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Nunca duas gravacoes do mesmo canal ao mesmo tempo: e a trava que torna
-- "uma gravacao por canal" verdade mesmo se o supervisor tentar duas vezes.
CREATE UNIQUE INDEX uq_live_sessions_gravando ON live_sessions (live_channel_id) WHERE status = 'gravando';
CREATE INDEX idx_live_sessions_channel ON live_sessions (live_channel_id, started_at DESC);

CREATE TABLE live_segments (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'audio')),
  seq INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  start_offset NUMERIC(10,3) NOT NULL,
  end_offset NUMERIC(10,3) NOT NULL,
  bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (session_id, kind, seq)
);
CREATE INDEX idx_live_segments_limpeza ON live_segments (created_at) WHERE deleted_at IS NULL;

-- Uma linha por bloco de audio de ~30s. Bloco silencioso tambem ganha linha
-- (status 'silencio'), senao a triagem nao saberia distinguir "nao foi
-- transcrito ainda" de "nao tinha nada para transcrever".
CREATE TABLE live_transcripts (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  audio_segment_id BIGINT NOT NULL UNIQUE REFERENCES live_segments(id) ON DELETE CASCADE,
  start_offset NUMERIC(10,3) NOT NULL,
  end_offset NUMERIC(10,3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'feito', 'silencio', 'erro')),
  text TEXT,
  loudness_lufs NUMERIC(6,2),
  peak_db NUMERIC(6,2),
  silence_seconds NUMERIC(6,2),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_transcripts_sessao ON live_transcripts (session_id, start_offset);

CREATE TABLE live_candidates (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('triagem', 'clipar_agora')),
  start_offset NUMERIC(10,3) NOT NULL,
  end_offset NUMERIC(10,3) NOT NULL,
  reason TEXT,
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'escolhido', 'descartado', 'erro')),
  requested_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_offset > start_offset)
);
CREATE INDEX idx_live_candidates_pendentes ON live_candidates (session_id) WHERE status = 'pendente';

-- O corte pertence a quem vai receber (user_id): com um canal compartilhado,
-- cada usuario ve os cortes que foram feitos pra ele.
CREATE TABLE live_clips (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES live_sessions(id) ON DELETE SET NULL,
  live_channel_id BIGINT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id BIGINT REFERENCES live_candidates(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('triagem', 'clipar_agora')),
  start_offset NUMERIC(10,3) NOT NULL,
  end_offset NUMERIC(10,3) NOT NULL,
  title TEXT,
  hook TEXT,
  score INTEGER,
  status TEXT NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'renderizando', 'pronto', 'erro')),
  render_progress INTEGER NOT NULL DEFAULT 0,
  local_clip_path TEXT,
  thumbnail_path TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at TIMESTAMPTZ
);
CREATE INDEX idx_live_clips_usuario ON live_clips (user_id, created_at DESC);
CREATE INDEX idx_live_clips_fila ON live_clips (created_at) WHERE status = 'na_fila';

-- Livro de custo do modulo, separado do video_costs (que e amarrado a
-- source_videos). Sobrevive a sessao apagada, igual o livro do YouTube.
CREATE TABLE live_costs (
  id BIGSERIAL PRIMARY KEY,
  live_channel_id BIGINT REFERENCES live_channels(id) ON DELETE SET NULL,
  session_id BIGINT REFERENCES live_sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora')),
  audio_seconds NUMERIC(10,2) NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_costs_canal_dia ON live_costs (live_channel_id, created_at);

INSERT INTO settings (key, value) VALUES
  ('lives_enabled', 'false'::jsonb),
  ('lives_config', '{"maxCanais": 2, "qualidade": "480p", "retencaoHoras": 24, "cortesPorHora": 5, "discoMaxPercent": 80, "horasPorCanalDia": 8}'::jsonb)
ON CONFLICT (key) DO NOTHING;

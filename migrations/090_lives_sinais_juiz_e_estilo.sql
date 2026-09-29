-- Cortes de lives, segunda versao: o primeiro teste real (28/09/2026) mostrou
-- cortes fracos. A IA barata so via TEXTO e marcou quase todo trecho de 30s
-- como "momento" (nota 7). O que muda:
--
--  1. SINAIS DO PUBLICO: ritmo e risadas do chat (IRC anonimo), clipes que os
--     proprios espectadores criam na Twitch, e picos de volume segundo a
--     segundo. Sao a melhor pista de momento que viraliza.
--  2. JUIZ mais forte (gpt-5-mini) dando a nota final a cada candidato.
--  3. QUALIDADE por usuario (1 a 5): quanto mais alta, menos cortes e mais
--     rigor. A avaliacao e feita uma vez por canal; cada usuario recebe os
--     que passam no nivel dele.
--  4. ESTILO proprio dos cortes de live, com a opcao de usar o dos videos, e
--     o layout com a camera do streamer.
--
-- Continua mexendo SO em tabelas live_*. Reversao manual em
-- migrations/reversao/090_lives_sinais_juiz_e_estilo.down.sql.

-- Hora de relogio em que o ffmpeg FECHOU cada pedaco (mtime do arquivo). E o
-- que liga um evento com hora de relogio (mensagem do chat, clipe de
-- espectador) ao tempo da gravacao - inclusive depois de uma pausa pra
-- anuncio, quando a gravacao para de andar e o relogio nao.
ALTER TABLE live_segments ADD COLUMN closed_at TIMESTAMPTZ;

-- Volume momentaneo maximo de cada segundo do bloco (LUFS). A media de 30s
-- quase nao varia (desvio de 1,4 LU no teste): o grito vive no segundo.
ALTER TABLE live_transcripts ADD COLUMN momentary_1s JSONB;

-- Chat agregado em baldes de 5s de relogio.
CREATE TABLE live_chat_buckets (
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  bucket_at TIMESTAMPTZ NOT NULL,
  msgs INTEGER NOT NULL DEFAULT 0,
  risadas INTEGER NOT NULL DEFAULT 0,
  hype INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, bucket_at)
);

-- Clipes criados pelos espectadores durante a gravacao.
CREATE TABLE live_viewer_clips (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  twitch_clip_id TEXT NOT NULL UNIQUE,
  title TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds NUMERIC(6,2) NOT NULL,
  clip_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_viewer_clips_sessao ON live_viewer_clips (session_id, clip_created_at);

-- Candidatos: nova origem ('sinal' = pico do publico) e o resultado do juiz.
ALTER TABLE live_candidates DROP CONSTRAINT live_candidates_source_check;
ALTER TABLE live_candidates ADD CONSTRAINT live_candidates_source_check
  CHECK (source IN ('triagem', 'sinal', 'clipar_agora'));
ALTER TABLE live_candidates
  ADD COLUMN signals JSONB,
  ADD COLUMN final_score INTEGER,
  ADD COLUMN final_start NUMERIC(10,3),
  ADD COLUMN final_end NUMERIC(10,3),
  ADD COLUMN title TEXT,
  ADD COLUMN hook TEXT,
  ADD COLUMN judged_at TIMESTAMPTZ;

ALTER TABLE live_clips DROP CONSTRAINT live_clips_source_check;
ALTER TABLE live_clips ADD CONSTRAINT live_clips_source_check
  CHECK (source IN ('triagem', 'sinal', 'clipar_agora'));
-- Posicao da camera usada no render (o que a deteccao achou), pra conferir.
ALTER TABLE live_clips ADD COLUMN webcam JSONB;
-- Um candidato vira no maximo UM corte por usuario.
CREATE UNIQUE INDEX uq_live_clips_candidato_usuario ON live_clips (candidate_id, user_id) WHERE candidate_id IS NOT NULL;

ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera'));

-- Configuracao dos cortes de live, por usuario. Separada da de videos de
-- proposito (pedido do fundador), com a opcao de usar a mesma.
CREATE TABLE live_clip_settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  usar_estilo_dos_videos BOOLEAN NOT NULL DEFAULT true,
  -- Mesmo formato das colunas de client_video_settings (caption_style,
  -- title_style...), pra o render consumir sem traducao.
  estilo JSONB NOT NULL DEFAULT '{}'::jsonb,
  qualidade INTEGER NOT NULL DEFAULT 3 CHECK (qualidade BETWEEN 1 AND 5),
  camera_modo TEXT NOT NULL DEFAULT 'auto' CHECK (camera_modo IN ('auto', 'desligado')),
  camera_posicao TEXT NOT NULL DEFAULT 'top' CHECK (camera_posicao IN ('top', 'bottom')),
  camera_altura_percent INTEGER NOT NULL DEFAULT 40 CHECK (camera_altura_percent BETWEEN 20 AND 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A camera recortada de uma gravacao em 480p fica com ~150px de largura e sai
-- borrada quando esticada pra 1080. 720p (30 fps quando o canal oferece) e o
-- minimo pra camera ficar apresentavel: ~1,5 GB/h em vez de 0,65.
UPDATE settings SET value = jsonb_set(value, '{qualidade}', '"720p"')
 WHERE key = 'lives_config' AND value->>'qualidade' = '480p';

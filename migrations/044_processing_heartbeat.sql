-- Sinal de vida do processamento de video.
--
-- Problema real (aconteceu 3x em 01/08/2026, videos #988, #1838 e #1683):
-- quando o video-worker morre no meio de um video (deploy, crash, OOM), a
-- linha fica presa em 'downloading'/'transcribing'/'cutting' pra sempre e so
-- um UPDATE manual no banco resolvia.
--
-- Nao da pra detectar isso so por tempo: os deploys usam update_order
-- start-first (o container novo sobe ANTES do antigo desligar), entao um
-- video que esta ha 40 minutos em 'cutting' pode estar processando
-- perfeitamente no container antigo - resetar ele corromperia o corte.
--
-- A resposta e este sinal de vida: o processVideoJob toca esta coluna a cada
-- 60s ENQUANTO trabalha. Quem nao bate ha varios minutos esta morto de
-- verdade, nao lento. O contador limita quantas vezes o mesmo video pode ser
-- ressuscitado antes de virar erro de verdade (evita loop infinito de
-- ressuscitar/morrer se a causa for o proprio video).

ALTER TABLE source_videos
  ADD COLUMN IF NOT EXISTS processing_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stuck_recovery_count SMALLINT NOT NULL DEFAULT 0;

-- Consulta do job de recuperacao: "quem esta em andamento e nao bate ha X".
CREATE INDEX IF NOT EXISTS idx_source_videos_heartbeat
  ON source_videos (processing_heartbeat_at)
  WHERE status IN ('downloading', 'transcribing', 'selecting_clips', 'cutting');

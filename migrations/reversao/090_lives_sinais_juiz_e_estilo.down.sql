-- Desfaz migrations/090_lives_sinais_juiz_e_estilo.sql (rodar a mao, com o
-- modulo de lives desligado). Linhas com origem 'sinal' e custos dos tipos
-- novos sao apagadas antes de voltar as restricoes antigas.
BEGIN;
DROP TABLE IF EXISTS live_clip_settings;
DELETE FROM live_costs WHERE kind IN ('juiz', 'ajuste_fino', 'camera');
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora'));
DROP INDEX IF EXISTS uq_live_clips_candidato_usuario;
ALTER TABLE live_clips DROP COLUMN IF EXISTS webcam;
DELETE FROM live_clips WHERE source = 'sinal';
ALTER TABLE live_clips DROP CONSTRAINT live_clips_source_check;
ALTER TABLE live_clips ADD CONSTRAINT live_clips_source_check CHECK (source IN ('triagem', 'clipar_agora'));
DELETE FROM live_candidates WHERE source = 'sinal';
ALTER TABLE live_candidates DROP COLUMN IF EXISTS signals, DROP COLUMN IF EXISTS final_score,
  DROP COLUMN IF EXISTS final_start, DROP COLUMN IF EXISTS final_end, DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS hook, DROP COLUMN IF EXISTS judged_at;
ALTER TABLE live_candidates DROP CONSTRAINT live_candidates_source_check;
ALTER TABLE live_candidates ADD CONSTRAINT live_candidates_source_check CHECK (source IN ('triagem', 'clipar_agora'));
DROP TABLE IF EXISTS live_viewer_clips;
DROP TABLE IF EXISTS live_chat_buckets;
ALTER TABLE live_transcripts DROP COLUMN IF EXISTS momentary_1s;
ALTER TABLE live_segments DROP COLUMN IF EXISTS closed_at;
DELETE FROM schema_migrations WHERE name = '090_lives_sinais_juiz_e_estilo.sql';
COMMIT;

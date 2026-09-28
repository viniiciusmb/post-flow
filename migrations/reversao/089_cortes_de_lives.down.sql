-- Desfaz migrations/089_cortes_de_lives.sql. NAO e aplicado pelo
-- scripts/migrate.js (fica fora da pasta que ele le): rodar a mao, e so
-- depois de desligar settings.lives_enabled e parar o live-worker.
--
--   docker exec -i postflow_db psql -U postgres -d postflow < migrations/reversao/089_cortes_de_lives.down.sql
--
-- Os ARQUIVOS gravados ficam em <VIDEO_WORK_DIR>/lives/ e precisam ser
-- apagados a parte.
BEGIN;
DROP TABLE IF EXISTS live_costs;
DROP TABLE IF EXISTS live_clips;
DROP TABLE IF EXISTS live_candidates;
DROP TABLE IF EXISTS live_transcripts;
DROP TABLE IF EXISTS live_segments;
DROP TABLE IF EXISTS live_sessions;
DROP TABLE IF EXISTS live_channel_follows;
DROP TABLE IF EXISTS live_channels;
DELETE FROM settings WHERE key IN ('lives_enabled', 'lives_config');
DELETE FROM schema_migrations WHERE name = '089_cortes_de_lives.sql';
COMMIT;

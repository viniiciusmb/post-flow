DELETE FROM live_costs WHERE kind = 'revisao';
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera'));
DELETE FROM live_clips WHERE status = 'descartado';
ALTER TABLE live_clips DROP COLUMN IF EXISTS review;
ALTER TABLE live_clips DROP CONSTRAINT live_clips_status_check;
ALTER TABLE live_clips ADD CONSTRAINT live_clips_status_check
  CHECK (status IN ('na_fila', 'renderizando', 'pronto', 'erro'));
ALTER TABLE live_clip_settings DROP COLUMN IF EXISTS categorias;
-- Pausado volta a ser "removido" (era o unico estado parado que existia).
UPDATE live_channel_follows SET is_active = false WHERE paused_at IS NOT NULL;
ALTER TABLE live_channel_follows DROP COLUMN IF EXISTS paused_at;

DELETE FROM live_costs WHERE kind = 'monitor_transcricao';
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera', 'revisao'));
ALTER TABLE live_transcripts DROP COLUMN IF EXISTS check_similarity;
ALTER TABLE live_costs DROP COLUMN IF EXISTS service_tier;

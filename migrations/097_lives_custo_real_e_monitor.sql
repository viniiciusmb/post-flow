-- Lives, 04/10/2026: medir custo e qualidade de verdade.
-- 1. Por qual fila da OpenAI cada chamada de texto passou ('flex' = metade do
--    preco; 'default' = quando o flex nao tinha capacidade e caiu no normal).
ALTER TABLE live_costs ADD COLUMN service_tier TEXT;
-- 2. Monitor da transcricao acelerada: em parte dos blocos o mesmo audio e
--    transcrito tambem em velocidade normal, e aqui fica o quanto os dois
--    textos concordam (0 a 100). NULL = bloco nao amostrado.
ALTER TABLE live_transcripts ADD COLUMN check_similarity NUMERIC(5,2);
-- 3. Custo do monitor separado no livro.
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera', 'revisao', 'monitor_transcricao'));

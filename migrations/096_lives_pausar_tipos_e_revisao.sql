-- Lives, pedido de 04/10/2026: mais cortes por hora, escolha dos TIPOS de
-- corte, canal salvo com pausar/retomar, e uma revisao final por IA que pode
-- descartar um corte que nao se sustenta sozinho. So tabelas live_*.

-- 1. Pausar um canal sem deixar de acompanhar. Antes o unico jeito de parar
--    de gravar era remover o canal (is_active = false), e ele sumia da tela.
ALTER TABLE live_channel_follows ADD COLUMN paused_at TIMESTAMPTZ;

-- Quem "removeu" um canal ate hoje so queria pausar (era o unico jeito): os
-- canais voltam pra lista, PAUSADOS - nada passa a gravar sozinho.
UPDATE live_channel_follows SET is_active = true, paused_at = now() WHERE NOT is_active;

-- 2. Tipos de corte que cada usuario quer receber (NULL = todos).
ALTER TABLE live_clip_settings ADD COLUMN categorias TEXT[];

-- 3. Corte que a revisao final reprovou: nao renderiza (economiza CPU) e
--    abre a vaga pro proximo candidato. "review" guarda o parecer da IA, pra
--    conferir depois por que o corte saiu, mudou ou foi descartado.
ALTER TABLE live_clips DROP CONSTRAINT live_clips_status_check;
ALTER TABLE live_clips ADD CONSTRAINT live_clips_status_check
  CHECK (status IN ('na_fila', 'renderizando', 'pronto', 'erro', 'descartado'));
ALTER TABLE live_clips ADD COLUMN review JSONB;

-- 4. Custo da revisao final, separado no livro (pra medir quanto ela custa).
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera', 'revisao'));

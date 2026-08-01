-- Marca o fim de cada etapa do pipeline (download/transcricao/selecao de
-- cortes) - sem isso so dava pra saber o tempo TOTAL (processing_started_at
-- ate updated_at em 'ready'), porque updated_at e uma coluna so, sobrescrita
-- a cada transicao de status (perde o valor anterior). Com essas 3 marcas
-- extras da pra calcular quanto tempo cada etapa levou de verdade, pro
-- card de metricas de tempo na Fila de Processamento do admin.
ALTER TABLE source_videos
  ADD COLUMN download_completed_at TIMESTAMPTZ,
  ADD COLUMN transcription_completed_at TIMESTAMPTZ,
  ADD COLUMN clip_selection_completed_at TIMESTAMPTZ;

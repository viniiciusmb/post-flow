-- Suporte a metricas de negocio/custo/saude do pipeline (painel admin) e uso
-- (painel cliente), sem depender de nenhum servico externo novo.

-- "Cliente ativo" = teve alguma sessao logada recentemente.
ALTER TABLE users ADD COLUMN last_active_at TIMESTAMPTZ;

-- processing_started_at marca quando o worker de video pegou o item da fila
-- (status muda pra 'downloading') - da pra separar "tempo esperando na fila"
-- (processing_started_at - created_at) de "tempo de processamento"
-- (updated_at - processing_started_at). Custos das APIs externas ficam no
-- video-fonte porque a chamada e feita uma vez por video (nao por corte).
ALTER TABLE source_videos
  ADD COLUMN processing_started_at TIMESTAMPTZ,
  ADD COLUMN whisper_audio_seconds NUMERIC(10,2),
  ADD COLUMN whisper_cost_usd NUMERIC(10,4),
  ADD COLUMN claude_input_tokens INTEGER,
  ADD COLUMN claude_output_tokens INTEGER,
  ADD COLUMN claude_cost_usd NUMERIC(10,4);

-- Cada processo (web, worker de postagem, worker de video) atualiza sua
-- propria linha periodicamente - da pra saber se algum caiu (ver
-- metricsRepository.listServiceStatus, considera "fora do ar" sem heartbeat
-- recente).
CREATE TABLE service_heartbeats (
  service_name TEXT PRIMARY KEY,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resumo diario, calculado uma vez por dia (ver metricsRollupJob). Existe
-- pra sobreviver a retencao: quando o texto/palavras da transcricao de um
-- video antigo e apagado (ver retentionJob), os numeros agregados do dia
-- continuam preservados aqui.
CREATE TABLE metrics_daily (
  day DATE PRIMARY KEY,
  videos_detected INTEGER NOT NULL DEFAULT 0,
  clips_generated INTEGER NOT NULL DEFAULT 0,
  clips_posted INTEGER NOT NULL DEFAULT 0,
  pipeline_errors INTEGER NOT NULL DEFAULT 0,
  whisper_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  claude_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  avg_processing_seconds NUMERIC(10,2),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

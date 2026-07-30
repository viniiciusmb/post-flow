-- Ate aqui cada cliente so podia ter UMA conta TikTok ativa por vez
-- (uq_tiktok_accounts_one_active_per_client) - reconectar substituia a
-- anterior. Agora um cliente pode ter varias contas TikTok simultaneas,
-- cada uma usada por canais/fontes diferentes.

DROP INDEX uq_tiktok_accounts_one_active_per_client;

-- Reconectar a MESMA conta (mesmo tiktok_open_id) deve atualizar a linha
-- existente, nao criar uma duplicata - conectar uma conta DIFERENTE sempre
-- insere uma linha nova ativa, sem mexer nas outras.
CREATE UNIQUE INDEX uq_tiktok_accounts_client_open_id
  ON tiktok_accounts (client_user_id, tiktok_open_id);

-- Cada canal do YouTube passa a apontar pra UMA conta TikTok especifica -
-- e nela que os cortes gerados a partir desse canal sao publicados.
ALTER TABLE youtube_channels
  ADD COLUMN tiktok_account_id BIGINT REFERENCES tiktok_accounts(id) ON DELETE SET NULL;

-- Video avulso (upload direto ou link colado, sem canal) pode ser vinculado
-- a MAIS DE UMA conta TikTok ao mesmo tempo - o cliente escolhe na hora de
-- enviar. Vale pra todos os cortes gerados desse video-fonte.
CREATE TABLE source_video_tiktok_targets (
  source_video_id    BIGINT NOT NULL REFERENCES source_videos(id) ON DELETE CASCADE,
  tiktok_account_id  BIGINT NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (source_video_id, tiktok_account_id)
);

-- Pasta-fonte do proprio cliente no Drive (drive_folders.type = 'client')
-- tambem pode alimentar mais de uma conta TikTok - escolhido ao configurar
-- a pasta (nao ha um "momento de envio" por video aqui, e deteccao
-- automatica em segundo plano).
CREATE TABLE drive_folder_tiktok_targets (
  drive_folder_id    BIGINT NOT NULL REFERENCES drive_folders(id) ON DELETE CASCADE,
  tiktok_account_id  BIGINT NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (drive_folder_id, tiktok_account_id)
);

-- Backfill: todo cliente que ja tinha 1 conta ativa antes dessa migration
-- continua com o mesmo comportamento de hoje - canais, videos avulsos e
-- pasta-fonte existentes passam a apontar explicitamente pra essa conta.
UPDATE youtube_channels yc
SET tiktok_account_id = ta.id
FROM tiktok_accounts ta
WHERE ta.client_user_id = yc.client_user_id AND ta.is_active = true;

INSERT INTO source_video_tiktok_targets (source_video_id, tiktok_account_id)
SELECT sv.id, ta.id
FROM source_videos sv
JOIN tiktok_accounts ta ON ta.client_user_id = sv.client_user_id AND ta.is_active = true
WHERE sv.input_type IN ('manual', 'upload');

INSERT INTO drive_folder_tiktok_targets (drive_folder_id, tiktok_account_id)
SELECT df.id, ta.id
FROM drive_folders df
JOIN tiktok_accounts ta ON ta.client_user_id = df.client_user_id AND ta.is_active = true
WHERE df.type = 'client';

-- Amostras periodicas de uso da VPS (CPU/memoria/disco), pro admin
-- acompanhar o gasto do servidor compartilhado - ver systemMetricsSampleJob.
CREATE TABLE system_metrics_samples (
  id             BIGSERIAL PRIMARY KEY,
  sampled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  load_avg_1m    NUMERIC(6,2),
  cpu_cores      SMALLINT,
  mem_used_mb    INTEGER,
  mem_total_mb   INTEGER,
  disk_used_gb   NUMERIC(8,2),
  disk_total_gb  NUMERIC(8,2)
);

CREATE INDEX idx_system_metrics_samples_sampled_at ON system_metrics_samples (sampled_at);

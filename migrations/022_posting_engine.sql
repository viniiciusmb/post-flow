-- Fase 3: motor de publicacao no TikTok (ate aqui a tabela "postings" so
-- ficava parada em 'pending' pra sempre - nada consumia essa fila). Tambem
-- inclui correcoes de seguranca no pipeline de video pedidas junto: cancelar
-- processamento em andamento e retry automatico de erro transitorio.

-- Cancelamento cooperativo: o worker confere essa flag entre etapas e para
-- no proximo checkpoint (nao mata o ffmpeg/yt-dlp na hora).
ALTER TABLE source_videos
  ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN auto_retry_count SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE source_videos
  DROP CONSTRAINT source_videos_status_check,
  ADD CONSTRAINT source_videos_status_check CHECK (status IN (
    'detected', 'downloading', 'transcribing',
    'selecting_clips', 'cutting', 'ready', 'error', 'cancelled'
  ));

-- Legenda de fato enviada ao TikTok - copiada de clips.description quando a
-- postagem e criada, mas editavel a parte sem afetar o corte original.
-- 'skipped' = cliente decidiu nao postar esse corte (sai da fila sem erro).
ALTER TABLE postings
  ADD COLUMN caption TEXT;

ALTER TABLE postings
  DROP CONSTRAINT postings_status_check,
  ADD CONSTRAINT postings_status_check CHECK (status IN (
    'pending', 'queued', 'processing', 'posted', 'error', 'skipped'
  ));

-- Configuracao de agendamento por conta TikTok: horario manual (lista de
-- horarios) ou automatico (o sistema espalha ao longo do dia), quantos por
-- dia, e depois de quanto tempo apagar uma postagem ja publicada sozinho.
CREATE TABLE posting_schedule_settings (
  tiktok_account_id     BIGINT PRIMARY KEY REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'manual')),
  videos_per_day        SMALLINT NOT NULL DEFAULT 3 CHECK (videos_per_day BETWEEN 1 AND 20),
  manual_times          TEXT[] NOT NULL DEFAULT '{}',  -- ex: ['09:00','15:00','20:00'], so usado no modo manual
  timezone              TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  auto_delete_after_hours INT DEFAULT 168,              -- NULL = nunca apagar automaticamente; padrao 7 dias
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

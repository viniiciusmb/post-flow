-- Pausar um video em processamento agora retoma de onde parou (nao apaga
-- nada e reinicia do zero como o cancelamento anterior fazia) - status novo
-- "paused", distinto de "cancelled" (mantido pra linhas antigas, mas nao
-- e mais usado por codigo novo).
ALTER TABLE source_videos
  DROP CONSTRAINT source_videos_status_check,
  ADD CONSTRAINT source_videos_status_check CHECK (status IN (
    'detected', 'downloading', 'transcribing',
    'selecting_clips', 'cutting', 'ready', 'error', 'cancelled', 'paused'
  ));

-- Cada canal decide se os cortes prontos sao enviados pro Drive de destino
-- sozinhos (auto) ou se o cliente escolhe corte a corte na tela de Videos &
-- Cortes (manual, padrao - menos surpresa).
ALTER TABLE youtube_channels
  ADD COLUMN drive_export_mode TEXT NOT NULL DEFAULT 'manual' CHECK (drive_export_mode IN ('auto', 'manual'));

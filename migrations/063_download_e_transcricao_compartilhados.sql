-- Reaproveitar o download e a transcrição entre clientes que monitoram o
-- mesmo canal do YouTube.
--
-- O problema: cada cliente tem a própria linha em youtube_channels, então dois
-- clientes que monitoram o canal "TOGURO" viram dois source_videos diferentes
-- para o MESMO vídeo do YouTube (a unicidade é por (vídeo, dono) desde a
-- migration 042, e isso está certo — cada um processa e paga o seu). O efeito
-- colateral é que o mesmo arquivo era baixado N vezes e mandado pro Whisper N
-- vezes. Em 21/08/2026, 20 vídeos em produção já estavam duplicados assim.
--
-- O que é compartilhado e o que NÃO é:
--   compartilha  -> o arquivo baixado (banda) e a transcrição (Whisper),
--                   que são idênticos por definição: é o mesmo vídeo.
--   não compartilha -> a escolha dos trechos pela IA, o corte, a legenda, o
--                   título, o enquadramento. Cada cliente configura o dele,
--                   então a partir da transcrição tudo volta a ser individual.
--
-- O cliente continua pagando o mesmo crédito (a economia é de custo nosso,
-- não de preço dele) — ver creditsService.confirmAfterDownload.
CREATE TABLE shared_video_assets (
  id                     BIGSERIAL PRIMARY KEY,

  -- A identidade é o vídeo do YouTube em si, não o canal nem o cliente.
  youtube_video_id       TEXT NOT NULL UNIQUE,

  -- Arquivo baixado, fora das pastas por vídeo (workDir/<id>) de propósito:
  -- apagar um source_video não pode levar junto o arquivo que outro cliente
  -- ainda vai usar. NULL depois que o sharedAssetsCleanupJob apaga o arquivo.
  local_video_path       TEXT,
  video_bytes            BIGINT,
  downloaded_at          TIMESTAMPTZ,
  download_egress_type   TEXT,
  download_tunnel_id     BIGINT REFERENCES download_tunnels(id) ON DELETE SET NULL,
  download_reuse_count   INT NOT NULL DEFAULT 0,

  -- A transcrição é barata de guardar (JSONB) e cara de refazer (Whisper),
  -- então fica MUITO mais tempo que o arquivo de vídeo: mesmo depois do
  -- arquivo ser apagado, um cliente novo que adicionar o canal depois ainda
  -- pula o Whisper (só o download é refeito, porque cortar exige o arquivo).
  transcript_text        TEXT,
  transcript_words       JSONB,
  whisper_audio_seconds  NUMERIC(10,2),
  whisper_cost_usd       NUMERIC(10,4),
  transcript_language    TEXT,
  transcribed_at         TIMESTAMPTZ,
  transcript_reuse_count INT NOT NULL DEFAULT 0,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O job de limpeza varre só quem ainda tem arquivo em disco.
CREATE INDEX idx_shared_video_assets_com_arquivo
  ON shared_video_assets (downloaded_at)
  WHERE local_video_path IS NOT NULL;

-- 'reuse' = não houve egress nenhum, o arquivo já estava em disco. Fica com
-- download_bytes = 0, que é a verdade: o painel "Banda" mede banda gasta, e
-- reaproveitamento não gasta banda.
ALTER TABLE source_videos DROP CONSTRAINT IF EXISTS source_videos_download_egress_type_check;
ALTER TABLE source_videos
  ADD CONSTRAINT source_videos_download_egress_type_check
    CHECK (download_egress_type IN ('client_tunnel', 'founder_tunnel', 'proxy', 'direct', 'reuse'));

-- Marca explícita em vez de deduzir por "whisper_cost_usd = 0": vídeo em modo
-- "vídeo inteiro" também pode ter custo zero por outros motivos, e métrica que
-- se deduz de ausência de dado mente cedo ou tarde.
ALTER TABLE source_videos ADD COLUMN transcript_reused BOOLEAN NOT NULL DEFAULT false;

-- O job de limpeza precisa saber, para um youtube_video_id, se ainda existe
-- algum vídeo pendente que vai precisar do arquivo.
CREATE INDEX idx_source_videos_youtube_video_id_status
  ON source_videos (youtube_video_id, status)
  WHERE youtube_video_id IS NOT NULL;

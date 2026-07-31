-- Rastreamento de banda por origem (tunel do cliente / tunel de fallback do
-- founder / proxy pago / direto), pra painel de custo/margem. Ver
-- src/services/ytDlpService.js (qual candidato realmente baixou o video) e
-- src/worker/videoJobs/processVideoJob.js (mede o tamanho do arquivo).
ALTER TABLE source_videos
  ADD COLUMN download_bytes BIGINT,
  ADD COLUMN download_egress_type TEXT CHECK (download_egress_type IN ('client_tunnel', 'founder_tunnel', 'proxy', 'direct')),
  ADD COLUMN download_tunnel_id BIGINT REFERENCES download_tunnels(id) ON DELETE SET NULL;

-- Liga/desliga por tunel (admin pode desativar o proprio ou o de um
-- cliente especifico sem derrubar a conexao SSH em si).
ALTER TABLE download_tunnels
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;

-- Indices que faltavam em chaves estrangeiras e nas consultas mais chamadas.
--
-- Levantado com uma varredura no catalogo do Postgres (pg_constraint x
-- pg_index) procurando toda FK sem indice que comece pela propria coluna.
-- Postgres NAO cria indice automatico pra chave estrangeira (so pra chave
-- primaria e UNIQUE) - entao toda consulta que filtra ou junta por essas
-- colunas fazia varredura da tabela inteira, e todo DELETE do lado "pai"
-- precisava varrer a tabela "filha" pra checar a referencia.
--
-- Com o volume de hoje (48 videos, 106 cortes) nada disso e perceptivel. O
-- ponto e nao deixar a conta pra depois: essas tabelas so crescem, e um
-- indice criado agora sai de graca.

-- Usada toda vez que um canal e listado/aberto no painel e, principalmente,
-- ao desativar/apagar uma conta TikTok (precisa achar quais canais apontavam
-- pra ela).
CREATE INDEX IF NOT EXISTS idx_youtube_channels_tiktok_account
  ON youtube_channels (tiktok_account_id)
  WHERE tiktok_account_id IS NOT NULL;

-- Painel /admin/bandwidth agrupa consumo por tunel; e a limpeza de um tunel
-- desconectado precisa achar os videos que sairam por ele.
CREATE INDEX IF NOT EXISTS idx_source_videos_download_tunnel
  ON source_videos (download_tunnel_id)
  WHERE download_tunnel_id IS NOT NULL;

-- owner_client_user_id e o dono real do video (inclusive de video de canal,
-- onde client_user_id fica NULL). Usado nas contas de uso por cliente.
CREATE INDEX IF NOT EXISTS idx_source_videos_owner
  ON source_videos (owner_client_user_id);

-- Tabelas de vinculo: sempre consultadas dos dois lados.
CREATE INDEX IF NOT EXISTS idx_source_video_targets_account
  ON source_video_tiktok_targets (tiktok_account_id);

CREATE INDEX IF NOT EXISTS idx_drive_folder_targets_account
  ON drive_folder_tiktok_targets (tiktok_account_id);

-- /admin/billing lista assinatura + plano de todos os clientes.
CREATE INDEX IF NOT EXISTS idx_client_subscriptions_plan
  ON client_subscriptions (plan_id);

-- A consulta mais quente do painel do cliente: a fila de postagem de uma
-- conta, filtrada por status e ordenada pela posicao na fila. Indice
-- composto atende filtro + ordenacao de uma vez.
CREATE INDEX IF NOT EXISTS idx_postings_account_status_order
  ON postings (tiktok_account_id, status, queue_order);

-- Tela "Videos & Cortes" lista os videos do cliente por data, e faz polling
-- de 8 em 8 segundos enquanto ha video em andamento - vale o indice composto.
CREATE INDEX IF NOT EXISTS idx_source_videos_client_created
  ON source_videos (client_user_id, created_at DESC)
  WHERE client_user_id IS NOT NULL;

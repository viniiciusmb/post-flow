-- Contagem de seguidores/curtidas/videos, buscada da API do TikTok (escopo
-- user.info.stats) periodicamente pelo worker. NULL ate a primeira busca -
-- contas conectadas antes dessa migration so tem esses numeros depois de
-- reconectar (o token antigo nao tem a permissao nova).
ALTER TABLE tiktok_accounts
  ADD COLUMN follower_count INTEGER,
  ADD COLUMN following_count INTEGER,
  ADD COLUMN likes_count INTEGER,
  ADD COLUMN video_count INTEGER,
  ADD COLUMN stats_updated_at TIMESTAMPTZ;

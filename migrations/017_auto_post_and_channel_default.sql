-- Controle explicito do cliente sobre automacao: precisa ligar, nao vem
-- ligado sozinho.
--   - Canais do YouTube: is_active ja existia (usado como pausar/retomar),
--     agora passa a comecar DESLIGADO ao cadastrar (feito no codigo, so
--     documentando aqui).
--   - Postagem automatica: nova, por conta TikTok - so entra na fila de
--     postagem o corte pronto se o cliente tiver ligado isso.
ALTER TABLE tiktok_accounts ADD COLUMN auto_post_enabled BOOLEAN NOT NULL DEFAULT false;

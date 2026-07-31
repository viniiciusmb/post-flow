-- Limpeza de codigo morto pedida pelo usuario: tudo aqui foi confirmado sem
-- nenhuma referencia no codigo atual antes de remover.
--
-- Tailscale por cliente: feature pausada por custo (2026-07-30) e nunca
-- ligada a nada - o codigo (docker/tailscale-relay/, controllers/rotas/
-- pagina admin/job) foi removido junto com essa migration. Substituida pelo
-- tunel SSH (download_tunnels, migration 030), que continua ativo.
DROP TABLE IF EXISTS client_tailscale_connections;

-- Nunca lido/escrito em lugar nenhum do codigo - era pra confirmar Target
-- User da TikTok Sandbox manualmente, mas esse fluxo nunca foi construido.
ALTER TABLE tiktok_accounts DROP COLUMN IF EXISTS sandbox_target_user_confirmed;

-- Reservada pra login via Google (Fase 4), nunca implementada - login hoje
-- e so email+senha (ver authService.js). O OAuth do Google que existe e
-- pra conectar o Drive (drive_connections), sem relacao com essa coluna.
ALTER TABLE users DROP COLUMN IF EXISTS google_id;

-- 'draft_inbox'/'direct_post' nunca foi lido/gravado em nenhuma query -
-- hoje so existe o fluxo de rascunho/inbox mesmo (guiado pelo Sandbox da
-- TikTok, nao por essa coluna).
ALTER TABLE postings DROP COLUMN IF EXISTS post_mode;

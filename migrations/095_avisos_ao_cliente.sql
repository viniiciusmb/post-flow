-- Aviso que aparece como pop-up no painel de UM cliente, uma vez (01/10/2026).
-- Primeiro uso: avisar sobre a manutencao do servidor e o credito devolvido.
-- Some quando o cliente clica em "Entendi" (dismissed_at); nada e apagado,
-- pra ficar o registro de que ele foi avisado.
CREATE TABLE client_notices (
  id             BIGSERIAL PRIMARY KEY,
  client_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed_at   TIMESTAMPTZ
);

CREATE INDEX idx_client_notices_abertos ON client_notices (client_user_id) WHERE dismissed_at IS NULL;

-- Conexao OAuth do Google Drive do ADMIN (esperamos uma unica linha ativa em uso).
-- Os clientes nao fazem OAuth do Google: eles apenas recebem um link de pasta
-- compartilhada dentro do Drive do admin.
CREATE TABLE drive_connections (
  id                        BIGSERIAL PRIMARY KEY,
  admin_user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_account_email      TEXT NOT NULL,

  access_token_encrypted    TEXT NOT NULL,
  access_token_iv           TEXT NOT NULL,
  refresh_token_encrypted   TEXT NOT NULL,
  refresh_token_iv          TEXT NOT NULL,
  token_expires_at          TIMESTAMPTZ NOT NULL,

  connected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drive_connections_admin_user_id ON drive_connections (admin_user_id);

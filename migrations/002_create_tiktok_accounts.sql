-- Contas TikTok conectadas por cliente. Guardamos historico (is_active = false
-- em conexoes antigas), mas so pode existir UMA conexao ativa por cliente.
CREATE TABLE tiktok_accounts (
  id                             BIGSERIAL PRIMARY KEY,
  client_user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tiktok_open_id                 TEXT NOT NULL,
  tiktok_union_id                TEXT,
  display_name                   TEXT,
  avatar_url                     TEXT,

  -- Tokens sempre guardados criptografados (AES-256-GCM) via src/lib/crypto.js.
  access_token_encrypted         TEXT NOT NULL,
  access_token_iv                TEXT NOT NULL,
  refresh_token_encrypted        TEXT NOT NULL,
  refresh_token_iv               TEXT NOT NULL,
  token_expires_at               TIMESTAMPTZ NOT NULL,
  scopes                         TEXT[] NOT NULL DEFAULT '{}',

  is_active                      BOOLEAN NOT NULL DEFAULT true,
  receives_general_content       BOOLEAN NOT NULL DEFAULT true,  -- recebe videos da pasta "Geral"?
  sandbox_target_user_confirmed  BOOLEAN NOT NULL DEFAULT false, -- admin ja cadastrou como Target User no TikTok?

  connected_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tiktok_accounts_client_user_id ON tiktok_accounts (client_user_id);

-- Garante no maximo uma conta TikTok ativa por cliente.
CREATE UNIQUE INDEX uq_tiktok_accounts_one_active_per_client
  ON tiktok_accounts (client_user_id)
  WHERE is_active = true;

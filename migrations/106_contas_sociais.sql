-- Contas do Instagram e do Facebook conectadas pela Outstand (08/10/2026).
--
-- A Outstand é a API unificada que publica por nós com o app dela, já aprovado
-- pela Meta - o quebra-galho enquanto o Post Flow não tem app próprio
-- aprovado. O que guardamos aqui é só o vínculo "esta conta da Outstand é deste
-- cliente": token de acesso nunca passa por nós, fica com a Outstand.
--
-- outstand_account_id é UNIQUE: uma conta conectada pertence a um cliente só.
-- Desconectar marca disconnected_at em vez de apagar, pra ficar o registro.
CREATE TABLE social_accounts (
  id                  BIGSERIAL PRIMARY KEY,
  client_user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  network             TEXT NOT NULL CHECK (network IN ('instagram', 'facebook')),
  outstand_account_id TEXT NOT NULL UNIQUE,
  network_unique_id   TEXT,
  username            TEXT,
  display_name        TEXT,
  avatar_url          TEXT,
  account_type        TEXT,
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at     TIMESTAMPTZ
);

CREATE INDEX idx_social_accounts_cliente ON social_accounts (client_user_id) WHERE disconnected_at IS NULL;

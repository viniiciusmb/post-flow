-- Recuperação de senha por e-mail.
--
-- Até agora, cliente que esquecia a senha só voltava com o admin trocando na
-- mão no banco.
--
-- O token NÃO é guardado em texto: gravamos o hash SHA-256 dele, do mesmo jeito
-- que se faz com senha. Quem tiver acesso de leitura ao banco (backup vazado,
-- consulta de suporte, dump de desenvolvimento) não consegue usar um token pra
-- entrar na conta de ninguém.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 do token que foi enviado por e-mail. O valor original só existe
  -- dentro do link que o cliente recebeu.
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  -- Marcado no momento em que a senha é trocada. Serve pra garantir uso único:
  -- reabrir o mesmo link depois não funciona.
  used_at        TIMESTAMPTZ,
  -- De onde veio o pedido. Não identifica ninguém sozinho, mas ajuda a
  -- investigar um caso de abuso ("alguém pediu 40 redefinições").
  requested_ip   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta do fluxo: achar o token válido pelo hash.
CREATE INDEX IF NOT EXISTS idx_password_reset_lookup
  ON password_reset_tokens (token_hash)
  WHERE used_at IS NULL;

-- Usada pra invalidar os pedidos anteriores quando o cliente pede um novo, e
-- pela limpeza dos expirados.
CREATE INDEX IF NOT EXISTS idx_password_reset_user
  ON password_reset_tokens (user_id, expires_at);

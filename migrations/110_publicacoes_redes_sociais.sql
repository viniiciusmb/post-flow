-- Publicação de cortes no Instagram e no Facebook pela Outstand (10/10/2026).
--
-- Até aqui as contas dessas redes só CONECTAVAM: o feed as mostrava como
-- "publicação em breve". Esta tabela é a fila delas.
--
-- Tabela própria, e não `postings`: a fila do TikTok é amarrada à conta do
-- TikTok (tiktok_account_id NOT NULL, horários, agrupamento por vídeo, envio em
-- pedaços), e nada disso vale aqui - a Outstand recebe o arquivo e publica.
--
-- Um corte por conta: UNIQUE em (conta, corte) para cada um dos dois tipos de
-- corte. Mandar de novo um corte que deu erro reaproveita a
-- linha em vez de criar outra - é o que impede o mesmo vídeo de sair duas
-- vezes no perfil da pessoa.
--
-- `tentativa` entra na chave de idempotência enviada à Outstand: ela só muda
-- quando se SABE que a publicação anterior não saiu (erro confirmado, ou o
-- cliente pediu de novo). Uma queda no meio da chamada repete a mesma chave, e a
-- Outstand devolve a postagem já criada em vez de criar outra.
CREATE TABLE social_postings (
  id                 BIGSERIAL PRIMARY KEY,
  client_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  social_account_id  BIGINT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  clip_id            BIGINT REFERENCES clips(id) ON DELETE CASCADE,
  live_clip_id       BIGINT REFERENCES live_clips(id) ON DELETE CASCADE,
  caption            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sending', 'processing', 'posted', 'error')),
  tentativa          INTEGER NOT NULL DEFAULT 1,
  falhas_de_envio    INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TIMESTAMPTZ,
  outstand_media_url TEXT,
  outstand_post_id   TEXT,
  platform_post_url  TEXT,
  error_message      TEXT,
  sent_at            TIMESTAMPTZ,
  posted_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_social_postings_um_corte CHECK ((clip_id IS NULL) <> (live_clip_id IS NULL))
);

CREATE UNIQUE INDEX uq_social_postings_clip ON social_postings (social_account_id, clip_id) WHERE clip_id IS NOT NULL;
CREATE UNIQUE INDEX uq_social_postings_live_clip ON social_postings (social_account_id, live_clip_id) WHERE live_clip_id IS NOT NULL;
CREATE INDEX idx_social_postings_a_fazer ON social_postings (status) WHERE status IN ('pending', 'sending', 'processing');
CREATE INDEX idx_social_postings_clip ON social_postings (clip_id) WHERE clip_id IS NOT NULL;
CREATE INDEX idx_social_postings_live_clip ON social_postings (live_clip_id) WHERE live_clip_id IS NOT NULL;
CREATE INDEX idx_social_postings_cliente ON social_postings (client_user_id);

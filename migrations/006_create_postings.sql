-- O coracao do sistema: uma linha por combinacao (video, conta TikTok de destino).
-- E essa tabela que alimenta os paineis de status do admin e do cliente.
CREATE TABLE postings (
  id                 BIGSERIAL PRIMARY KEY,
  video_id           BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tiktok_account_id  BIGINT NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,

  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'queued', 'processing', 'posted', 'error')),

  -- Enquanto o app TikTok nao for aprovado para "Direct Post", todo posting
  -- e feito no modo rascunho/inbox (post_mode = 'draft_inbox').
  post_mode          TEXT NOT NULL DEFAULT 'draft_inbox'
                       CHECK (post_mode IN ('draft_inbox', 'direct_post')),

  tiktok_publish_id  TEXT,   -- id retornado pela chamada de inbox-init do TikTok
  tiktok_post_id     TEXT,   -- id final do post, quando confirmado
  error_message      TEXT,
  attempts           INT NOT NULL DEFAULT 0,

  queued_at          TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  posted_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Garante que o mesmo video nunca e postado duas vezes na mesma conta TikTok.
  UNIQUE (video_id, tiktok_account_id)
);

CREATE INDEX idx_postings_status ON postings (status);
CREATE INDEX idx_postings_tiktok_account_id ON postings (tiktok_account_id);

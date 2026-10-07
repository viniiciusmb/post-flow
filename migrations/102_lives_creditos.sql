-- Cortes de live passam a consumir o MESMO credito dos cortes do YouTube
-- (decisao do fundador, 06/10/2026): 3 minutos de live clipada = 1 credito.
-- Uma linha por (sessao gravada, pessoa que recebe cortes dela). A cobranca e
-- ADIANTADA: paid_until_seconds diz ate que segundo da gravacao ja esta pago.
-- last_seen_seconds detecta o tempo em que a pessoa NAO estava recebendo
-- (pausou e voltou): esse buraco nao e cobrado.
-- out_of_credit_at: o credito acabou nesta live - a pessoa para de receber
-- cortes dela ate ter credito de novo.
-- isento: conta de admin (nao debita nada, mas o contador mostra quanto
-- teria custado).
CREATE TABLE live_credit_usage (
  session_id BIGINT NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  live_channel_id BIGINT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
  paid_until_seconds NUMERIC(10,2) NOT NULL,
  last_seen_seconds NUMERIC(10,2) NOT NULL,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  isento BOOLEAN NOT NULL DEFAULT false,
  out_of_credit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX idx_live_credit_usage_user ON live_credit_usage (user_id, created_at DESC);

-- "Clipar este momento" cobra 1 credito no clique; guardado no corte.
ALTER TABLE live_clips ADD COLUMN credits_charged INTEGER NOT NULL DEFAULT 0;

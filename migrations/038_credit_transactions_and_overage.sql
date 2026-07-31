-- Historico de consumo de credito por video-fonte. UNIQUE (source_video_id)
-- e a trava que garante "reprocessar nao gera novo debito" - o banco recusa
-- uma segunda linha pro mesmo video, nao depende de disciplina no codigo.
-- status: 'reservado' (credito ja tirado do saldo, download em andamento),
-- 'confirmado' (download terminou com sucesso), 'liberado' (download falhou
-- antes de completar, credito devolvido - minutes_from_quota/extra dizem
-- exatamente quanto devolver de cada bolso).
CREATE TABLE credit_transactions (
  id                 BIGSERIAL PRIMARY KEY,
  client_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_video_id    BIGINT NOT NULL UNIQUE REFERENCES source_videos(id) ON DELETE CASCADE,
  bucket             TEXT NOT NULL CHECK (bucket IN ('normal', 'bonus')),
  status             TEXT NOT NULL CHECK (status IN ('reservado', 'confirmado', 'liberado')),
  minutes_charged    INTEGER NOT NULL,
  minutes_from_quota INTEGER NOT NULL DEFAULT 0,
  minutes_from_extra INTEGER NOT NULL DEFAULT 0,
  download_path      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_transactions_client ON credit_transactions (client_user_id);

-- Cobranca de excedente por video (quando o cliente tem cartao de excedente
-- ligado e o saldo normal/bonus nao bastava - o video segue processando em
-- vez de travar). rate_cents_per_min e um snapshot da taxa vigente no
-- momento (25 ou 15), pra nao mudar retroativamente se a taxa for ajustada
-- depois. Acumula durante o ciclo, fechado pelo overageBillingJob semanal.
CREATE TABLE client_overage_charges (
  id                 BIGSERIAL PRIMARY KEY,
  client_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_video_id    BIGINT NOT NULL UNIQUE REFERENCES source_videos(id) ON DELETE CASCADE,
  bucket             TEXT NOT NULL CHECK (bucket IN ('normal', 'bonus')),
  minutes            INTEGER NOT NULL,
  rate_cents_per_min INTEGER NOT NULL,
  amount_cents       INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'faturado', 'pago', 'falhou')),
  stripe_invoice_id  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_overage_charges_client ON client_overage_charges (client_user_id, status);

-- Planos de assinatura (Starter/Pro/Max). Fica em tabela (nao hardcoded no
-- codigo) pra dar pra ajustar preco/cota/limite sem precisar de deploy - mas
-- so 3 linhas fixas por enquanto, seed abaixo. queue_priority alimenta a
-- prioridade da fila de processamento (Max > Pro > Starter, ver
-- videoScheduler.js). max_youtube_channels/max_tiktok_accounts NULL = sem
-- limite (plano Max).
CREATE TABLE subscription_plans (
  id                    BIGSERIAL PRIMARY KEY,
  key                   TEXT NOT NULL UNIQUE CHECK (key IN ('starter', 'pro', 'max')),
  name                  TEXT NOT NULL,
  price_cents           INTEGER NOT NULL,
  stripe_price_id       TEXT,
  weekly_minutes_normal INTEGER NOT NULL,
  weekly_minutes_bonus  INTEGER NOT NULL,
  max_youtube_channels  INTEGER,
  max_tiktok_accounts   INTEGER,
  queue_priority        SMALLINT NOT NULL DEFAULT 0,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO subscription_plans
  (key, name, price_cents, weekly_minutes_normal, weekly_minutes_bonus, max_youtube_channels, max_tiktok_accounts, queue_priority)
VALUES
  ('starter', 'Starter', 5990, 90,  120, 1,    1,    0),
  ('pro',     'Pro',     9990, 150, 200, 3,    3,    5),
  ('max',     'Max',     14990, 250, 333, NULL, NULL, 10);

-- Pacote avulso de credito comprado pelo cliente (via Stripe Checkout, modo
-- pagamento unico) - engorda extra_normal/extra_bonus em client_credits
-- quando o pagamento confirma (webhook checkout.session.completed).
CREATE TABLE credit_purchases (
  id                          BIGSERIAL PRIMARY KEY,
  client_user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket                      TEXT NOT NULL CHECK (bucket IN ('normal', 'bonus')),
  minutes                     INTEGER NOT NULL,
  amount_cents                INTEGER NOT NULL,
  stripe_checkout_session_id  TEXT,
  stripe_payment_intent_id    TEXT,
  status                      TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'falhou')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_purchases_client ON credit_purchases (client_user_id);

-- Preco/tamanho do pacote avulso, ajustavel sem deploy (mesmo padrao ja
-- usado por drive_poll_interval_minutes/post_stagger_seconds).
INSERT INTO settings (key, value) VALUES
  ('credit_package_minutes', '100'),
  ('credit_package_price_cents', '4990');

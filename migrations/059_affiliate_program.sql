-- Programa de afiliados/comissoes. Todo cliente ganha 1 link automatico
-- (is_default=true); o admin pode criar quantos links proprios quiser pra
-- campanhas de divulgacao (bio do Instagram, TikTok, curso etc) - nesse caso
-- owner_user_id e o proprio admin, e nao gera comissao (ver affiliateService,
-- admin e isento igual ja e no sistema de credito).
CREATE TABLE affiliate_links (
  id             BIGSERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  owner_user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliate_links_owner ON affiliate_links (owner_user_id);
-- So pode existir 1 link "padrao" (o automatico) por dono - links extras
-- criados pelo admin sao sempre is_default=false.
CREATE UNIQUE INDEX idx_affiliate_links_owner_default ON affiliate_links (owner_user_id) WHERE is_default = true;

-- Saldo/config de comissao do afiliado (1:1 com users, criado sob demanda -
-- mesmo padrao de client_subscriptions). commission_percent_override NULL
-- significa "usa o % padrao global" (settings.affiliate_commission_percent_default).
-- balance_reserved_cents fica preso enquanto um saque esta pendente de
-- aprovacao do admin; balance_available_cents e o que pode ser sacado agora;
-- total_earned_cents e o historico (nunca diminui, so serve pra estatistica).
CREATE TABLE affiliates (
  user_id                      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  commission_percent_override  NUMERIC(5,2) CHECK (commission_percent_override IS NULL OR (commission_percent_override >= 0 AND commission_percent_override <= 100)),
  pix_key                      TEXT,
  pix_key_type                 TEXT CHECK (pix_key_type IS NULL OR pix_key_type IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  balance_available_cents      INTEGER NOT NULL DEFAULT 0,
  balance_reserved_cents       INTEGER NOT NULL DEFAULT 0,
  total_earned_cents           INTEGER NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atribuicao de origem de cada usuario, capturada uma unica vez no cadastro
-- (referred_user_id UNIQUE - nunca muda depois). affiliate_link_id fica NULL
-- pra cadastro direto/organico, mas as UTMs sao capturadas de qualquer forma
-- (pedido explicito: ver origem de QUALQUER usuario, nao so indicado).
-- referrer_user_id e um snapshot do dono do link no momento do cadastro, pra
-- nao depender de join com affiliate_links pra saber quem indicou.
CREATE TABLE referrals (
  id                 BIGSERIAL PRIMARY KEY,
  referred_user_id   BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  affiliate_link_id  BIGINT REFERENCES affiliate_links(id) ON DELETE SET NULL,
  referrer_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  utm_source         TEXT,
  utm_medium         TEXT,
  utm_campaign       TEXT,
  utm_content        TEXT,
  utm_term           TEXT,
  landing_path       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_referrer ON referrals (referrer_user_id);

-- Livro-razao de comissao. UNIQUE (stripe_invoice_id) e a trava de
-- idempotencia - reenvio de webhook da Stripe nunca duplica credito, mesmo
-- padrao de credit_transactions.source_video_id. commission_percent e
-- commission_cents sao um SNAPSHOT do % vigente no momento do pagamento -
-- mudar o % depois (global ou individual) nunca recalcula comissao ja paga.
CREATE TABLE commission_entries (
  id                  BIGSERIAL PRIMARY KEY,
  affiliate_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_invoice_id   TEXT NOT NULL UNIQUE,
  amount_paid_cents   INTEGER NOT NULL,
  commission_percent  NUMERIC(5,2) NOT NULL,
  commission_cents    INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_commission_entries_affiliate ON commission_entries (affiliate_user_id, created_at);
CREATE INDEX idx_commission_entries_referred ON commission_entries (referred_user_id);

-- Pedido de saque. pix_key/pix_key_type sao um SNAPSHOT do momento do pedido
-- (nao o cadastro atual do afiliado, que pode mudar depois do pedido feito).
-- 'pago' e final (o dinheiro ja saiu, balance_reserved so e zerado, nao volta
-- pro disponivel); 'recusado' devolve o valor reservado pro saldo disponivel.
CREATE TABLE affiliate_withdrawals (
  id                    BIGSERIAL PRIMARY KEY,
  affiliate_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents          INTEGER NOT NULL,
  pix_key               TEXT NOT NULL,
  pix_key_type          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'recusado')),
  admin_note            TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  resolved_by_admin_id  BIGINT REFERENCES users(id)
);

CREATE INDEX idx_affiliate_withdrawals_affiliate ON affiliate_withdrawals (affiliate_user_id);
CREATE INDEX idx_affiliate_withdrawals_status ON affiliate_withdrawals (status);

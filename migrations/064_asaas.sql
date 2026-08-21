-- Asaas ao lado da Stripe.
--
-- A mensalidade e a compra de crédito avulso passam para o Asaas (PIX e
-- cartão, mercado brasileiro). A cobrança automática de excedente CONTINUA na
-- Stripe por enquanto: ela depende de tokenização de cartão, que na produção
-- só é liberada pelo gerente da conta Asaas. Ou seja, por um tempo os dois
-- conviverão, e por isso cada registro passa a dizer de quem ele é em vez de
-- se deduzir isso pela presença de um id — dedução é o tipo de coisa que
-- funciona até o dia em que os dois ids existem na mesma linha.
ALTER TABLE client_subscriptions
  ADD COLUMN asaas_customer_id     TEXT,
  ADD COLUMN asaas_subscription_id TEXT,
  -- De quem é a ASSINATURA desta linha. O cartão de excedente continua tendo
  -- os campos stripe_* próprios, independentes disto.
  ADD COLUMN subscription_provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (subscription_provider IN ('stripe', 'asaas'));

CREATE INDEX idx_client_subscriptions_asaas_customer
  ON client_subscriptions (asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

ALTER TABLE credit_purchases
  ADD COLUMN asaas_payment_id TEXT,
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'asaas'));

-- Todo checkout que criamos no Asaas, e para que ele servia.
--
-- Existe porque o aviso de pagamento (CHECKOUT_PAID) traz o id do checkout e
-- mais nada de nosso: não há garantia de que a nossa referência
-- (externalReference) chegue de volta. Guardando o id aqui no momento em que
-- o checkout é criado, o aviso vira uma consulta direta — sem adivinhação
-- sobre de quem era aquele pagamento.
CREATE TABLE asaas_checkouts (
  id                  BIGSERIAL PRIMARY KEY,
  asaas_checkout_id   TEXT NOT NULL UNIQUE,
  client_user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'subscription' = mensalidade (usa plan_id)
  -- 'credit_package' = crédito avulso (usa credit_purchase_id)
  purpose             TEXT NOT NULL CHECK (purpose IN ('subscription', 'credit_package')),
  plan_id             BIGINT REFERENCES subscription_plans(id),
  credit_purchase_id  BIGINT REFERENCES credit_purchases(id) ON DELETE CASCADE,

  -- 'pago' é o estado que impede o crédito de ser liberado duas vezes: o
  -- Asaas garante entrega "pelo menos uma vez", então reenvio do mesmo aviso
  -- é esperado, não excepcional.
  status              TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente', 'pago', 'expirado', 'cancelado')),
  amount_cents        INTEGER NOT NULL,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cada finalidade usa a sua coluna, e só a sua. Sem isto, uma compra de
  -- crédito poderia nascer apontando para um plano (ou nenhum dos dois) e o
  -- erro só apareceria na hora de liberar o crédito, com o dinheiro já pago.
  CONSTRAINT chk_asaas_checkouts_alvo CHECK (
    (purpose = 'subscription'   AND plan_id IS NOT NULL AND credit_purchase_id IS NULL) OR
    (purpose = 'credit_package' AND credit_purchase_id IS NOT NULL AND plan_id IS NULL)
  )
);

CREATE INDEX idx_asaas_checkouts_client ON asaas_checkouts (client_user_id, created_at DESC);

-- A comissão de afiliado deixa de ser "id de fatura da Stripe" e passa a ser
-- "id do pagamento, seja lá de quem for". A coluna é a mesma (o índice único
-- continua sendo o que impede pagar comissão duas vezes pelo mesmo
-- pagamento), só deixa de mentir sobre a origem.
ALTER TABLE commission_entries RENAME COLUMN stripe_invoice_id TO external_payment_id;

ALTER TABLE commission_entries
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'asaas'));

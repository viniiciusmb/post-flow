-- Livro de receita: todo dinheiro que ENTROU, com o que ele pagou.
--
-- Até hoje não havia como responder "quanto faturamos este mês". Cada produto
-- guardava o próprio pagamento num lugar (asaas_payments, credit_purchases,
-- client_overage_charges, asaas_checkouts) e - o buraco maior - a mensalidade
-- do 2º mês em diante não ficava gravada em LUGAR NENHUM: quem cobra é a
-- assinatura recorrente do Asaas, e o aviso dela só reativava o plano e pagava
-- a comissão. Ou seja, a receita recorrente, que é o que sustenta um SaaS, era
-- exatamente a parte invisível.
--
-- Uma linha por pagamento recebido. O tipo é decidido no momento em que o
-- dinheiro entra e fica congelado (mesmo princípio de commission_entries.kind):
--
--   primeira_mensalidade  a primeira mensalidade paga por este cliente
--   recorrencia           mensalidade do 2º pagamento em diante
--   credito_avulso        pacote de minutos
--   excedente             minutos cobrados além da cota
--   conexoes_extras       canal/conta extra (compra e renovação)
--
-- Estorno MARCA a linha (refunded_at), nunca apaga: apagar faria a próxima
-- mensalidade daquele cliente contar como "primeira venda" de novo, e o extrato
-- do mês passado mudaria sozinho.
--
-- `client_user_id` vira NULL se o cliente for apagado, mas o valor fica: a
-- receita de um mês não pode encolher porque alguém excluiu uma conta.
CREATE TABLE revenue_entries (
  id             BIGSERIAL PRIMARY KEY,
  client_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('primeira_mensalidade', 'recorrencia', 'credito_avulso', 'excedente', 'conexoes_extras')),
  provider       TEXT NOT NULL CHECK (provider IN ('asaas', 'stripe')),
  -- Id do pagamento no provedor. É ele que torna o registro idempotente: os
  -- dois provedores entregam aviso "pelo menos uma vez", e o caminho síncrono
  -- do checkout e o webhook passam os dois por aqui.
  external_id    TEXT NOT NULL,
  plan_id        BIGINT REFERENCES subscription_plans(id) ON DELETE SET NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  billing_type   TEXT,
  paid_at        TIMESTAMPTZ NOT NULL,
  refunded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_revenue_entries_paid_at ON revenue_entries (paid_at);
CREATE INDEX idx_revenue_entries_client ON revenue_entries (client_user_id);

-- Quando a assinatura foi cancelada. `updated_at` muda por qualquer motivo
-- (trocar cartão, mexer em extras) e não serve pra dizer "quantos cancelaram
-- este mês".
ALTER TABLE client_subscriptions ADD COLUMN canceled_at TIMESTAMPTZ;
UPDATE client_subscriptions SET canceled_at = updated_at WHERE status = 'cancelado';

-- ---------------------------------------------------------------------------
-- Histórico: tudo que já foi pago antes de o livro existir.
-- ---------------------------------------------------------------------------

-- 1. Checkout hospedado do Asaas (antes de 31/08/2026). Vem primeiro porque é
--    o mais antigo: a primeira mensalidade de um cliente tem que ser a dele.
INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, paid_at)
SELECT ck.client_user_id,
       CASE
         WHEN ck.purpose = 'credit_package' THEN 'credito_avulso'
         WHEN row_number() OVER (PARTITION BY ck.client_user_id, ck.purpose ORDER BY ck.paid_at, ck.id) = 1
           THEN 'primeira_mensalidade'
         ELSE 'recorrencia'
       END,
       'asaas', 'checkout:' || ck.asaas_checkout_id, ck.plan_id, ck.amount_cents,
       COALESCE(ck.paid_at, ck.updated_at)
  FROM asaas_checkouts ck
 WHERE ck.status = 'pago'
ON CONFLICT (provider, external_id) DO NOTHING;

-- 2. Checkout transparente (asaas_payments).
INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, billing_type, paid_at, refunded_at)
SELECT ap.client_user_id,
       CASE
         WHEN ap.purpose = 'credit_package' THEN 'credito_avulso'
         WHEN ap.purpose = 'extra_slots' THEN 'conexoes_extras'
         WHEN row_number() OVER (PARTITION BY ap.client_user_id, ap.purpose ORDER BY ap.paid_at, ap.id) = 1
              AND NOT EXISTS (
                SELECT 1 FROM revenue_entries re
                 WHERE re.client_user_id = ap.client_user_id
                   AND re.kind IN ('primeira_mensalidade', 'recorrencia'))
           THEN 'primeira_mensalidade'
         ELSE 'recorrencia'
       END,
       'asaas', ap.asaas_payment_id, ap.plan_id, ap.amount_cents, ap.billing_type,
       COALESCE(ap.paid_at, ap.updated_at),
       CASE WHEN ap.status = 'estornado' THEN ap.updated_at END
  FROM asaas_payments ap
 WHERE ap.status IN ('pago', 'estornado')
ON CONFLICT (provider, external_id) DO NOTHING;

-- 3. Crédito avulso que não passou por nenhum dos dois checkouts acima (a
--    compra pela Stripe, antes de o Asaas existir).
INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, amount_cents, paid_at)
SELECT cp.client_user_id, 'credito_avulso', COALESCE(cp.provider, 'stripe'),
       COALESCE(cp.stripe_payment_intent_id, cp.asaas_payment_id, 'credit_purchase:' || cp.id),
       cp.amount_cents, cp.created_at
  FROM credit_purchases cp
 WHERE cp.status = 'pago'
   AND NOT EXISTS (SELECT 1 FROM asaas_payments ap WHERE ap.credit_purchase_id = cp.id)
   AND NOT EXISTS (SELECT 1 FROM asaas_checkouts ck WHERE ck.credit_purchase_id = cp.id AND ck.status = 'pago')
ON CONFLICT (provider, external_id) DO NOTHING;

-- 4. Excedente cobrado no cartão.
INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, amount_cents, paid_at)
SELECT oc.client_user_id, 'excedente',
       CASE WHEN oc.asaas_payment_id IS NOT NULL THEN 'asaas' ELSE 'stripe' END,
       COALESCE(oc.asaas_payment_id, oc.stripe_payment_intent_id, 'overage:' || oc.id),
       oc.amount_cents, COALESCE(oc.charged_at, oc.updated_at)
  FROM client_overage_charges oc
 WHERE oc.status = 'pago'
ON CONFLICT (provider, external_id) DO NOTHING;

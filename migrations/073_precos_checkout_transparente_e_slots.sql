-- Reforma de preços + checkout transparente + slots extras.
--
-- Três mudanças que andam juntas porque tocam a mesma tabela de planos:
--
--  1. PREÇO EM DOIS DEGRAUS. O que era `price_cents` (um preço só) vira o
--     preço CHEIO da mensalidade, e nasce `first_month_price_cents` com o
--     preço promocional do primeiro mês (40% de desconto). O preço que os
--     clientes viam até hoje é exatamente o promocional — ou seja, quem já
--     assinou não sofre reajuste retroativo, porque nenhuma assinatura
--     recorrente do Asaas existia ainda (conferido no banco de produção antes
--     desta migration: todas as linhas de client_subscriptions eram atribuição
--     manual do admin, sem asaas_subscription_id).
--
--  2. TAXA DE EXCEDENTE POR PLANO. Era uma constante única no código (25/15
--     centavos por minuto). Vira coluna: quanto maior o plano, mais barato o
--     minuto excedente. Snapshot continua sendo gravado em
--     client_overage_charges.rate_cents_per_min, então cobrança antiga não
--     muda de valor retroativamente.
--
--  3. SLOTS EXTRAS. No plano mais caro o cliente pode comprar conexões a mais
--     (1 canal do YouTube + 1 conta do TikTok por slot). `extra_slot_price_cents`
--     NULL = o plano não vende slot extra, que é o caso dos dois menores.

ALTER TABLE subscription_plans
  -- NULL = plano sem promoção; o cliente paga o preço cheio já no primeiro
  -- mês. Coluna separada (em vez de um percentual de desconto) porque é ela
  -- que aparece na landing e no checkout, e um preço exibido nunca deve
  -- depender de arredondamento feito na hora de mostrar.
  ADD COLUMN first_month_price_cents INTEGER
    CHECK (first_month_price_cents IS NULL OR first_month_price_cents > 0),
  ADD COLUMN overage_cents_normal INTEGER NOT NULL DEFAULT 25
    CHECK (overage_cents_normal > 0),
  ADD COLUMN overage_cents_bonus INTEGER NOT NULL DEFAULT 15
    CHECK (overage_cents_bonus > 0),
  ADD COLUMN extra_slot_price_cents INTEGER
    CHECK (extra_slot_price_cents IS NULL OR extra_slot_price_cents > 0);

-- Preço cheio = preço atual desfazendo o desconto de 40% (atual / 0,6),
-- arredondado para terminar em ,90. Minutos proporcionais ao número de
-- conexões do plano (90 min por conta conectada), e o bônus mantém a mesma
-- proporção de sempre (4/3 do normal).
UPDATE subscription_plans SET
  first_month_price_cents = 5990,
  price_cents = 9990,
  weekly_minutes_normal = 90,
  weekly_minutes_bonus = 120,
  max_youtube_channels = 1,
  max_tiktok_accounts = 1,
  overage_cents_normal = 25,
  overage_cents_bonus = 15,
  extra_slot_price_cents = NULL,
  queue_priority = 0
WHERE key = 'starter';

UPDATE subscription_plans SET
  first_month_price_cents = 9990,
  price_cents = 16690,
  weekly_minutes_normal = 180,
  weekly_minutes_bonus = 240,
  max_youtube_channels = 2,
  max_tiktok_accounts = 2,
  overage_cents_normal = 20,
  overage_cents_bonus = 12,
  extra_slot_price_cents = NULL,
  queue_priority = 5
WHERE key = 'pro';

UPDATE subscription_plans SET
  first_month_price_cents = 13990,
  price_cents = 23390,
  weekly_minutes_normal = 270,
  weekly_minutes_bonus = 360,
  max_youtube_channels = 3,
  max_tiktok_accounts = 3,
  overage_cents_normal = 18,
  overage_cents_bonus = 11,
  extra_slot_price_cents = 2990,
  queue_priority = 10
WHERE key = 'max';

-- O plano maior deixou de ser "ilimitado" e passou a ter 3 conexões + slots
-- comprados. Cliente que hoje tem mais canais do que o novo limite continua
-- com todos eles funcionando (o limite só barra ADICIONAR); ninguém perde
-- nada por causa desta migration.

ALTER TABLE client_subscriptions
  -- Cartão tokenizado no Asaas. O número do cartão NUNCA é guardado aqui (nem
  -- em lugar nenhum do nosso banco): o token é uma referência opaca que só
  -- serve para cobrar naquela conta do Asaas. Bandeira/últimos 4/validade são
  -- guardados só para a tela poder dizer qual cartão está salvo.
  ADD COLUMN asaas_card_token TEXT,
  ADD COLUMN asaas_card_brand TEXT,
  ADD COLUMN asaas_card_last4 TEXT,
  ADD COLUMN asaas_card_exp   TEXT,

  -- Conexões compradas além do que o plano dá. Cada slot = 1 canal do YouTube
  -- + 1 conta do TikTok.
  ADD COLUMN extra_slots INTEGER NOT NULL DEFAULT 0 CHECK (extra_slots >= 0),
  ADD COLUMN asaas_extra_slots_subscription_id TEXT,

  -- Quando o cliente consumiu a promoção de primeiro mês. Existe para que
  -- cancelar e reassinar não vire desconto infinito, e para que trocar de
  -- plano no meio do caminho cobre o preço cheio.
  ADD COLUMN first_month_used_at TIMESTAMPTZ;

-- Pagamento criado direto pela API (checkout transparente), sem tela do Asaas.
--
-- A tabela asaas_checkouts continua existindo para os checkouts hospedados já
-- criados; esta é a equivalente do caminho novo. Separada em vez de reaproveitada
-- porque a chave é outra (id de PAGAMENTO, não de checkout) e misturar as duas
-- faria toda consulta ter que adivinhar qual id está em qual coluna.
CREATE TABLE asaas_payments (
  id                 BIGSERIAL PRIMARY KEY,
  asaas_payment_id   TEXT NOT NULL UNIQUE,
  client_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'subscription'   = primeira mensalidade (usa plan_id)
  -- 'credit_package' = crédito avulso (usa credit_purchase_id)
  -- 'extra_slots'    = conexões extras (usa slots)
  purpose            TEXT NOT NULL CHECK (purpose IN ('subscription', 'credit_package', 'extra_slots')),
  plan_id            BIGINT REFERENCES subscription_plans(id),
  credit_purchase_id BIGINT REFERENCES credit_purchases(id) ON DELETE CASCADE,
  slots              INTEGER,

  billing_type       TEXT NOT NULL CHECK (billing_type IN ('CREDIT_CARD', 'PIX')),
  -- 'pago' é o estado que impede liberar o mesmo pagamento duas vezes: o Asaas
  -- entrega "pelo menos uma vez", então aviso repetido é o normal.
  status             TEXT NOT NULL DEFAULT 'pendente'
                       CHECK (status IN ('pendente', 'pago', 'falhou', 'cancelado')),
  amount_cents       INTEGER NOT NULL,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cada finalidade usa a sua coluna, e só a sua. Sem isto, uma compra de
  -- crédito poderia nascer apontando para um plano e o erro só apareceria na
  -- hora de liberar, com o dinheiro já pago.
  CONSTRAINT chk_asaas_payments_alvo CHECK (
    (purpose = 'subscription'   AND plan_id IS NOT NULL AND credit_purchase_id IS NULL AND slots IS NULL) OR
    (purpose = 'credit_package' AND credit_purchase_id IS NOT NULL AND plan_id IS NULL AND slots IS NULL) OR
    (purpose = 'extra_slots'    AND slots IS NOT NULL AND slots > 0 AND plan_id IS NULL AND credit_purchase_id IS NULL)
  )
);

CREATE INDEX idx_asaas_payments_client ON asaas_payments (client_user_id, created_at DESC);

-- Excedente cobrado pelo Asaas (o campo da Stripe continua para o histórico já
-- gravado). Igual ao resto: origem explícita em vez de deduzida de qual id
-- está preenchido.
ALTER TABLE client_overage_charges
  ADD COLUMN IF NOT EXISTS asaas_payment_id TEXT;

ALTER TABLE credit_purchases
  DROP CONSTRAINT IF EXISTS credit_purchases_provider_check;
ALTER TABLE credit_purchases
  ADD CONSTRAINT credit_purchases_provider_check CHECK (provider IN ('stripe', 'asaas'));

'use strict';

const pool = require('../db/pool');

// Toda leitura passa por aqui - garante que a linha existe (status
// 'sem_plano', plan_id NULL) mesmo pra cliente que nunca teve nenhum plano
// atribuido, sem precisar mexer no fluxo de cadastro de cliente.
async function getOrCreate(clientUserId) {
  await pool.query(
    `INSERT INTO client_subscriptions (client_user_id) VALUES ($1)
     ON CONFLICT (client_user_id) DO NOTHING`,
    [clientUserId]
  );
  const { rows } = await pool.query(
    `SELECT cs.*, sp.key AS plan_key, sp.name AS plan_name, sp.weekly_minutes_normal, sp.weekly_minutes_bonus,
            sp.max_youtube_channels, sp.max_tiktok_accounts, sp.queue_priority,
            sp.price_cents AS plan_price_cents, sp.first_month_price_cents AS plan_first_month_price_cents,
            sp.overage_cents_normal, sp.overage_cents_bonus, sp.extra_slot_price_cents
     FROM client_subscriptions cs
     LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
     WHERE cs.client_user_id = $1`,
    [clientUserId]
  );
  return rows[0];
}

async function listAllWithPlan() {
  const { rows } = await pool.query(
    `SELECT cs.*, u.email, u.business_name, sp.key AS plan_key, sp.name AS plan_name
     FROM client_subscriptions cs
     JOIN users u ON u.id = cs.client_user_id
     LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
     ORDER BY u.business_name NULLS LAST, u.email`
  );
  return rows;
}

// Atribuicao manual pelo admin - usada tanto pra ativar um cliente sem
// plano nenhum quanto pra trocar de plano na mao (sem depender da Stripe).
// firstActivation=true (cliente estava 'sem_plano' ou nunca teve
// client_credits) aplica a cota nova JA - nao ha ciclo atual pra proteger.
// Troca de plano de um cliente ja ativo (firstActivation=false) so muda
// plan_id/prioridade/limites na hora; a cota so muda no proximo reset
// semanal (ver creditWeeklyResetJob) - e por isso que essa funcao nao mexe
// em client_credits sozinha, quem decide se aplica a cota na hora e o
// creditsService (so ele sabe se e primeira ativacao ou troca).
async function setPlan(clientUserId, planId) {
  const { rows } = await pool.query(
    `INSERT INTO client_subscriptions (client_user_id, plan_id, status, cycle_anchor_dow)
     VALUES ($1, $2, 'ativo', EXTRACT(DOW FROM now())::smallint)
     ON CONFLICT (client_user_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = 'ativo',
       cycle_anchor_dow = COALESCE(client_subscriptions.cycle_anchor_dow, EXCLUDED.cycle_anchor_dow),
       updated_at = now()
     RETURNING *`,
    [clientUserId, planId]
  );
  return rows[0];
}

async function findByStripeCustomerId(stripeCustomerId) {
  const { rows } = await pool.query('SELECT * FROM client_subscriptions WHERE stripe_customer_id = $1', [stripeCustomerId]);
  return rows[0] || null;
}

// ---------- Asaas (mensalidade) ----------
//
// O cartao de excedente continua na Stripe, com os campos stripe_* proprios -
// por isso a origem da ASSINATURA e uma coluna separada. Deduzir de qual id
// esta preenchido funcionaria ate o dia em que os dois existem na mesma linha,
// que e exatamente o periodo de convivencia em que estamos.
async function setAsaasSubscription(clientUserId, { customerId, subscriptionId }) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET asaas_customer_id = $2,
            asaas_subscription_id = $3,
            subscription_provider = 'asaas',
            updated_at = now()
      WHERE client_user_id = $1
      RETURNING *`,
    [clientUserId, customerId, subscriptionId]
  );
  return rows[0] || null;
}

// PIX Automatico: nao ha "assinatura" no sentido do Asaas ate a autorizacao
// ser ativada - quem manda e a autorizacao, entao e ela que guardamos.
async function setAsaasPixAuthorization(clientUserId, { customerId, authorizationId }) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET asaas_customer_id = $2,
            asaas_pix_authorization_id = $3,
            subscription_provider = 'asaas_pix',
            updated_at = now()
      WHERE client_user_id = $1
      RETURNING *`,
    [clientUserId, customerId, authorizationId]
  );
  return rows[0] || null;
}

async function findByAsaasCustomerId(asaasCustomerId) {
  const { rows } = await pool.query('SELECT * FROM client_subscriptions WHERE asaas_customer_id = $1', [asaasCustomerId]);
  return rows[0] || null;
}

async function findByAsaasSubscriptionId(asaasSubscriptionId) {
  const { rows } = await pool.query('SELECT * FROM client_subscriptions WHERE asaas_subscription_id = $1', [
    asaasSubscriptionId,
  ]);
  return rows[0] || null;
}

async function setStatus(clientUserId, status) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions SET status = $2, updated_at = now() WHERE client_user_id = $1 RETURNING *`,
    [clientUserId, status]
  );
  return rows[0] || null;
}

async function setStripeCustomer(clientUserId, stripeCustomerId) {
  await pool.query(
    `INSERT INTO client_subscriptions (client_user_id, stripe_customer_id) VALUES ($1, $2)
     ON CONFLICT (client_user_id) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
    [clientUserId, stripeCustomerId]
  );
}

// Zera TODOS os ids da Stripe de uma vez. Usado quando o customer guardado
// nao existe mais do lado da Stripe (troca de chave teste->producao, ou conta
// trocada): a assinatura e o cartao padrao pertenciam aquele customer morto,
// entao continuam apontando pro nada. Deixar esses dois preenchidos faria a
// cobranca automatica de excedente falhar depois, longe da tela, sem ninguem
// ver. NAO mexe em status/plano: quem decide isso e o admin, e o cliente
// segue com o plano que tem enquanto recadastra o pagamento.
async function clearStripeLinks(clientUserId) {
  await pool.query(
    `UPDATE client_subscriptions
     SET stripe_customer_id = NULL, stripe_subscription_id = NULL,
         stripe_default_payment_method_id = NULL, overage_card_enabled = false,
         updated_at = now()
     WHERE client_user_id = $1`,
    [clientUserId]
  );
}

async function setStripeSubscription(clientUserId, stripeSubscriptionId) {
  await pool.query(
    `UPDATE client_subscriptions SET stripe_subscription_id = $2, updated_at = now() WHERE client_user_id = $1`,
    [clientUserId, stripeSubscriptionId]
  );
}

// ---------- cartão tokenizado no Asaas ----------
//
// Guarda a REFERÊNCIA ao cartão, nunca o cartão. O token só vale dentro da
// conta do Asaas; vazado, não dá para usá-lo em lugar nenhum além de cobrar
// nesta mesma conta. Bandeira/últimos 4/validade existem só para a tela poder
// dizer qual cartão está salvo.
async function setAsaasCard(clientUserId, { customerId, token, brand, last4, exp, enableOverage = true }) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET asaas_customer_id = COALESCE($2, asaas_customer_id),
            asaas_card_token = $3,
            asaas_card_brand = $4,
            asaas_card_last4 = $5,
            asaas_card_exp = $6,
            overage_card_enabled = CASE WHEN $7 THEN true ELSE overage_card_enabled END,
            updated_at = now()
      WHERE client_user_id = $1
      RETURNING *`,
    [clientUserId, customerId, token, brand, last4, exp, enableOverage]
  );
  return rows[0] || null;
}

// Apaga o cartão salvo E desliga a cobrança automática junto. Separar as duas
// coisas deixaria a assinatura marcada como "cobra automático" sem cartão
// nenhum para cobrar — um estado que só falharia longe da tela, no meio de um
// processamento.
async function clearAsaasCard(clientUserId) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET asaas_card_token = NULL, asaas_card_brand = NULL, asaas_card_last4 = NULL,
            asaas_card_exp = NULL, overage_card_enabled = false, updated_at = now()
      WHERE client_user_id = $1
      RETURNING *`,
    [clientUserId]
  );
  return rows[0] || null;
}

// ---------- conexões extras ----------

async function setExtraSlots(clientUserId, { slots, asaasSubscriptionId = null }) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET extra_slots = $2,
            asaas_extra_slots_subscription_id = COALESCE($3, asaas_extra_slots_subscription_id),
            updated_at = now()
      WHERE client_user_id = $1
      RETURNING *`,
    [clientUserId, slots, asaasSubscriptionId]
  );
  return rows[0] || null;
}

async function clearExtraSlotsSubscription(clientUserId) {
  await pool.query(
    `UPDATE client_subscriptions
        SET extra_slots = 0, asaas_extra_slots_subscription_id = NULL, updated_at = now()
      WHERE client_user_id = $1`,
    [clientUserId]
  );
}

async function findByAsaasExtraSlotsSubscriptionId(asaasSubscriptionId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_subscriptions WHERE asaas_extra_slots_subscription_id = $1',
    [asaasSubscriptionId]
  );
  return rows[0] || null;
}

// ---------- promoção de primeiro mês ----------

// Marca a promoção como consumida, uma vez só. O `IS NULL` na cláusula é o que
// impede cancelar e reassinar virar desconto infinito: a segunda chamada não
// atualiza nada e devolve null.
async function markFirstMonthUsed(clientUserId) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
        SET first_month_used_at = now(), updated_at = now()
      WHERE client_user_id = $1 AND first_month_used_at IS NULL
      RETURNING *`,
    [clientUserId]
  );
  return rows[0] || null;
}

async function setOverageCard(clientUserId, { enabled, stripeDefaultPaymentMethodId = null }) {
  const { rows } = await pool.query(
    `UPDATE client_subscriptions
     SET overage_card_enabled = $2, stripe_default_payment_method_id = COALESCE($3, stripe_default_payment_method_id), updated_at = now()
     WHERE client_user_id = $1
     RETURNING *`,
    [clientUserId, enabled, stripeDefaultPaymentMethodId]
  );
  return rows[0] || null;
}

module.exports = {
  getOrCreate,
  listAllWithPlan,
  findByStripeCustomerId,
  setPlan,
  setStatus,
  setStripeCustomer,
  clearStripeLinks,
  setStripeSubscription,
  setAsaasSubscription,
  setAsaasPixAuthorization,
  findByAsaasCustomerId,
  findByAsaasSubscriptionId,
  findByAsaasExtraSlotsSubscriptionId,
  setOverageCard,
  setAsaasCard,
  clearAsaasCard,
  setExtraSlots,
  clearExtraSlotsSubscription,
  markFirstMonthUsed,
};

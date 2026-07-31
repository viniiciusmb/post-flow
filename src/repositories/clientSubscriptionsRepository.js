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
            sp.max_youtube_channels, sp.max_tiktok_accounts, sp.queue_priority
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

async function setStripeSubscription(clientUserId, stripeSubscriptionId) {
  await pool.query(
    `UPDATE client_subscriptions SET stripe_subscription_id = $2, updated_at = now() WHERE client_user_id = $1`,
    [clientUserId, stripeSubscriptionId]
  );
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
  setStripeSubscription,
  setOverageCard,
};

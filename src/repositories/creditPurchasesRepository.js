'use strict';

const pool = require('../db/pool');

async function create({ clientUserId, bucket, minutes, amountCents, stripeCheckoutSessionId }) {
  const { rows } = await pool.query(
    `INSERT INTO credit_purchases (client_user_id, bucket, minutes, amount_cents, stripe_checkout_session_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [clientUserId, bucket, minutes, amountCents, stripeCheckoutSessionId]
  );
  return rows[0];
}

async function markPaidByCheckoutSession(stripeCheckoutSessionId, stripePaymentIntentId) {
  const { rows } = await pool.query(
    `UPDATE credit_purchases SET status = 'pago', stripe_payment_intent_id = $2
     WHERE stripe_checkout_session_id = $1 AND status = 'pendente'
     RETURNING *`,
    [stripeCheckoutSessionId, stripePaymentIntentId]
  );
  return rows[0] || null;
}

async function listByClientId(clientUserId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_purchases WHERE client_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientUserId, limit]
  );
  return rows;
}

module.exports = {
  create,
  markPaidByCheckoutSession,
  listByClientId,
};

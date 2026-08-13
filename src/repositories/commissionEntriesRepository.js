'use strict';

const pool = require('../db/pool');

// Inserida dentro da MESMA transacao que credita affiliates (ver
// affiliateService.recordCommissionForInvoice) - por isso recebe o `client`
// da transacao em vez de usar o pool direto. ON CONFLICT DO NOTHING e a
// trava de idempotencia: reenvio do mesmo webhook nunca duplica.
async function insertIfNotExists(client, {
  affiliateUserId,
  referredUserId,
  stripeInvoiceId,
  amountPaidCents,
  commissionPercent,
  commissionCents,
}) {
  const { rows } = await client.query(
    `INSERT INTO commission_entries
       (affiliate_user_id, referred_user_id, stripe_invoice_id, amount_paid_cents, commission_percent, commission_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING *`,
    [affiliateUserId, referredUserId, stripeInvoiceId, amountPaidCents, commissionPercent, commissionCents]
  );
  return rows[0] || null;
}

async function countByReferredUser(referredUserId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM commission_entries WHERE referred_user_id = $1',
    [referredUserId]
  );
  return rows[0].n;
}

async function sumTotal({ from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT coalesce(sum(commission_cents), 0)::int AS total_cents, count(*)::int AS n
     FROM commission_entries
     WHERE ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at <= $2)`,
    [from || null, to || null]
  );
  return rows[0];
}

async function listRecentByAffiliate(affiliateUserId, { from, to, limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT ce.*, u.email AS referred_email, u.business_name AS referred_business_name
     FROM commission_entries ce
     JOIN users u ON u.id = ce.referred_user_id
     WHERE ce.affiliate_user_id = $1
       AND ($2::timestamptz IS NULL OR ce.created_at >= $2)
       AND ($3::timestamptz IS NULL OR ce.created_at <= $3)
     ORDER BY ce.created_at DESC
     LIMIT $4`,
    [affiliateUserId, from || null, to || null, limit]
  );
  return rows;
}

module.exports = {
  insertIfNotExists,
  countByReferredUser,
  sumTotal,
  listRecentByAffiliate,
};

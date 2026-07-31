'use strict';

const pool = require('../db/pool');

async function create({ clientUserId, sourceVideoId, bucket, minutes, rateCentsPerMin }) {
  const amountCents = Math.round(minutes * rateCentsPerMin);
  const { rows } = await pool.query(
    `INSERT INTO client_overage_charges (client_user_id, source_video_id, bucket, minutes, rate_cents_per_min, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [clientUserId, sourceVideoId, bucket, minutes, rateCentsPerMin, amountCents]
  );
  return rows[0];
}

async function findBySourceVideoId(sourceVideoId) {
  const { rows } = await pool.query('SELECT * FROM client_overage_charges WHERE source_video_id = $1', [sourceVideoId]);
  return rows[0] || null;
}

async function listPendingByClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM client_overage_charges WHERE client_user_id = $1 AND status = 'pendente' ORDER BY created_at ASC`,
    [clientUserId]
  );
  return rows;
}

// Todos os clientes com pelo menos 1 cobranca pendente - usado pelo
// overageBillingJob semanal pra saber quem faturar.
async function listClientsWithPending() {
  const { rows } = await pool.query(
    `SELECT DISTINCT client_user_id FROM client_overage_charges WHERE status = 'pendente'`
  );
  return rows.map((r) => r.client_user_id);
}

async function markInvoiced(ids, stripeInvoiceId) {
  if (ids.length === 0) return;
  await pool.query(
    `UPDATE client_overage_charges SET status = 'faturado', stripe_invoice_id = $2, updated_at = now() WHERE id = ANY($1)`,
    [ids, stripeInvoiceId]
  );
}

async function markPaid(ids) {
  if (ids.length === 0) return;
  await pool.query(`UPDATE client_overage_charges SET status = 'pago', updated_at = now() WHERE id = ANY($1)`, [ids]);
}

async function markFailed(ids) {
  if (ids.length === 0) return;
  await pool.query(`UPDATE client_overage_charges SET status = 'falhou', updated_at = now() WHERE id = ANY($1)`, [ids]);
}

// Visao do admin: total pendente/faturado/pago por cliente.
async function summaryByClient() {
  const { rows } = await pool.query(
    `SELECT u.id AS client_user_id, u.email, u.business_name,
            COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pendente'), 0) AS pending_cents,
            COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('faturado', 'pago')), 0) AS billed_cents
     FROM users u
     JOIN client_overage_charges c ON c.client_user_id = u.id
     GROUP BY u.id, u.email, u.business_name
     ORDER BY pending_cents DESC`
  );
  return rows;
}

module.exports = {
  create,
  findBySourceVideoId,
  listPendingByClient,
  listClientsWithPending,
  markInvoiced,
  markPaid,
  markFailed,
  summaryByClient,
};

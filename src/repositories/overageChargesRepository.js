'use strict';

const pool = require('../db/pool');

// UNIQUE(source_video_id) garante que o mesmo video nunca gere duas cobrancas
// de excedente. Sem o ON CONFLICT abaixo, porem, a SEGUNDA tentativa lancava
// erro de constraint: o cliente mandava reprocessar um video que ja tinha sido
// cobrado, a excecao subia ate o catch do processVideoJob e o video era marcado
// como ERRO. A protecao contra cobranca dupla funcionava, mas quebrava o
// reprocessamento.
//
// Agora a segunda chamada e silenciosa e devolve a cobranca que ja existia, que
// e o que o chamador espera: "essa conta ja foi feita, segue o jogo".
async function create({ clientUserId, sourceVideoId, bucket, minutes, rateCentsPerMin }) {
  const amountCents = Math.round(minutes * rateCentsPerMin);
  const { rows } = await pool.query(
    `INSERT INTO client_overage_charges (client_user_id, source_video_id, bucket, minutes, rate_cents_per_min, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_video_id) DO NOTHING
     RETURNING *`,
    [clientUserId, sourceVideoId, bucket, minutes, rateCentsPerMin, amountCents]
  );
  if (rows[0]) return rows[0];
  return findBySourceVideoId(sourceVideoId);
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

// Excedente agrupado por fatura da Stripe - usado pelo extrato pra dizer
// quantos minutos entraram em cada cobranca (uma fatura junta varios videos).
async function listInvoicedByClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT stripe_invoice_id, sum(minutes)::int AS minutes, sum(amount_cents)::int AS amount_cents,
            count(*)::int AS videos
     FROM client_overage_charges
     WHERE client_user_id = $1 AND stripe_invoice_id IS NOT NULL
     GROUP BY stripe_invoice_id`,
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

// Lancamento que ja nasce pago: a cobranca acontece ANTES do processamento,
// entao quando chega aqui o dinheiro ja entrou. O ON CONFLICT garante que
// reprocessar um video nunca cria um segundo lancamento.
async function createAlreadyPaid({
  clientUserId,
  sourceVideoId,
  bucket,
  minutes,
  rateCentsPerMin,
  stripePaymentIntentId = null,
  asaasPaymentId = null,
}) {
  const amountCents = Math.round(minutes * rateCentsPerMin);
  const { rows } = await pool.query(
    `INSERT INTO client_overage_charges
       (client_user_id, source_video_id, bucket, minutes, rate_cents_per_min, amount_cents,
        status, stripe_payment_intent_id, asaas_payment_id, charged_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pago', $7, $8, now())
     ON CONFLICT (source_video_id) DO NOTHING
     RETURNING *`,
    [clientUserId, sourceVideoId, bucket, minutes, rateCentsPerMin, amountCents, stripePaymentIntentId, asaasPaymentId]
  );
  if (rows[0]) return rows[0];
  return findBySourceVideoId(sourceVideoId);
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
  createAlreadyPaid,
  findBySourceVideoId,
  listPendingByClient,
  listInvoicedByClient,
  listClientsWithPending,
  markInvoiced,
  markPaid,
  markFailed,
  summaryByClient,
};

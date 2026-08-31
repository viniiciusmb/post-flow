// Cobranças criadas direto pela API do Asaas (checkout transparente), com a
// finalidade de cada uma.
//
// Existe pelo mesmo motivo de asaas_checkouts: o aviso de pagamento traz o id
// da COBRANÇA e mais nada de nosso. Guardando aqui no momento em que ela é
// criada, o aviso vira uma consulta direta, sem adivinhar de quem era aquele
// dinheiro.
'use strict';

const pool = require('../db/pool');

async function create({
  asaasPaymentId,
  clientUserId,
  purpose,
  billingType,
  amountCents,
  planId = null,
  creditPurchaseId = null,
  slots = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO asaas_payments
       (asaas_payment_id, client_user_id, purpose, billing_type, amount_cents, plan_id, credit_purchase_id, slots)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [asaasPaymentId, clientUserId, purpose, billingType, amountCents, planId, creditPurchaseId, slots]
  );
  return rows[0];
}

async function findByAsaasId(asaasPaymentId) {
  const { rows } = await pool.query('SELECT * FROM asaas_payments WHERE asaas_payment_id = $1', [asaasPaymentId]);
  return rows[0] || null;
}

// Condicionado a 'pendente': o Asaas entrega "pelo menos uma vez", então
// receber o mesmo aviso duas vezes é o normal. Devolver null na segunda é o
// que impede creditar/ativar em dobro — a decisão fica no banco, não na
// disciplina de quem chama.
async function markPaidOnce(asaasPaymentId) {
  const { rows } = await pool.query(
    `UPDATE asaas_payments SET status = 'pago', paid_at = now(), updated_at = now()
      WHERE asaas_payment_id = $1 AND status = 'pendente'
      RETURNING *`,
    [asaasPaymentId]
  );
  return rows[0] || null;
}

async function markStatusIfPending(asaasPaymentId, status) {
  const { rows } = await pool.query(
    `UPDATE asaas_payments SET status = $2, updated_at = now()
      WHERE asaas_payment_id = $1 AND status = 'pendente'
      RETURNING *`,
    [asaasPaymentId, status]
  );
  return rows[0] || null;
}

async function listForClient(clientUserId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM asaas_payments WHERE client_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientUserId, limit]
  );
  return rows;
}

module.exports = {
  create,
  findByAsaasId,
  markPaidOnce,
  markStatusIfPending,
  listForClient,
};

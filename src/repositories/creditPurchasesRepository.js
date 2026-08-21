'use strict';

const pool = require('../db/pool');

// provider diz de quem e a compra. O id da sessao da Stripe fica nulo nas
// compras do Asaas (la o vinculo e pela tabela asaas_checkouts) - por isso a
// origem e uma coluna explicita, e nao algo deduzido de qual id esta
// preenchido.
async function create({ clientUserId, bucket, minutes, amountCents, stripeCheckoutSessionId = null, provider = 'stripe' }) {
  const { rows } = await pool.query(
    `INSERT INTO credit_purchases
       (client_user_id, bucket, minutes, amount_cents, stripe_checkout_session_id, provider)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [clientUserId, bucket, minutes, amountCents, stripeCheckoutSessionId, provider]
  );
  return rows[0];
}

// Pagamento confirmado pelo Asaas. Condicionado a 'pendente' pelo mesmo
// motivo da versao da Stripe: aviso reenviado (o Asaas entrega "pelo menos
// uma vez") nao pode creditar duas vezes.
async function markPaidById(id, asaasPaymentId = null) {
  const { rows } = await pool.query(
    `UPDATE credit_purchases SET status = 'pago', asaas_payment_id = $2
     WHERE id = $1 AND status = 'pendente'
     RETURNING *`,
    [id, asaasPaymentId]
  );
  return rows[0] || null;
}

// Compra que nunca vai poder ser paga (o checkout nao chegou a ser criado, ou
// expirou). Deixa-la 'pendente' faria o historico do cliente mostrar pra
// sempre uma compra que ele nao fez e nao tem como concluir.
async function markFailedById(id) {
  const { rows } = await pool.query(
    `UPDATE credit_purchases SET status = 'falhou'
     WHERE id = $1 AND status = 'pendente'
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM credit_purchases WHERE id = $1', [id]);
  return rows[0] || null;
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

// Checkout que o cliente abandonou (a Stripe expira sozinha em ~24h). Sem
// isso a compra ficava "pendente" pra sempre no historico dele - o pior
// estado possivel numa tela de pagamento, porque nao da pra saber se pagou.
// Condicionado a status = 'pendente' pra nunca reescrever uma compra ja paga
// (evento fora de ordem ou reenviado nao pode desfazer credito).
async function markExpiredByCheckoutSession(stripeCheckoutSessionId) {
  const { rows } = await pool.query(
    `UPDATE credit_purchases SET status = 'falhou'
     WHERE stripe_checkout_session_id = $1 AND status = 'pendente'
     RETURNING *`,
    [stripeCheckoutSessionId]
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
  findById,
  markPaidById,
  markFailedById,
  markPaidByCheckoutSession,
  markExpiredByCheckoutSession,
  listByClientId,
};

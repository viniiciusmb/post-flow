// Todo checkout criado no Asaas e para que ele servia.
//
// O aviso de pagamento do Asaas (CHECKOUT_PAID) traz o id do checkout e mais
// nada de nosso — não há garantia de que a nossa referência volte junto.
// Guardar o id aqui no momento da criação transforma o aviso numa consulta
// direta, em vez de adivinhação sobre de quem era aquele dinheiro.
'use strict';

const pool = require('../db/pool');

async function create({ asaasCheckoutId, clientUserId, purpose, planId = null, creditPurchaseId = null, amountCents }) {
  const { rows } = await pool.query(
    `INSERT INTO asaas_checkouts
       (asaas_checkout_id, client_user_id, purpose, plan_id, credit_purchase_id, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [asaasCheckoutId, clientUserId, purpose, planId, creditPurchaseId, amountCents]
  );
  return rows[0];
}

async function findByAsaasId(asaasCheckoutId) {
  const { rows } = await pool.query('SELECT * FROM asaas_checkouts WHERE asaas_checkout_id = $1', [asaasCheckoutId]);
  return rows[0] || null;
}

// Marca como pago e devolve a linha SÓ na primeira vez.
//
// O `WHERE status <> 'pago'` é o que impede crédito em dobro: o Asaas entrega
// os avisos "pelo menos uma vez", então receber o mesmo CHECKOUT_PAID duas
// vezes é comportamento normal, não exceção. Na segunda vez o UPDATE não
// encontra linha, devolve null, e quem chamou sabe que não há o que fazer.
async function markPaidOnce(asaasCheckoutId) {
  const { rows } = await pool.query(
    `UPDATE asaas_checkouts
        SET status = 'pago', paid_at = now(), updated_at = now()
      WHERE asaas_checkout_id = $1 AND status <> 'pago'
      RETURNING *`,
    [asaasCheckoutId]
  );
  return rows[0] || null;
}

// Só sai de 'pendente': checkout que já foi pago não pode ser marcado como
// expirado por um aviso atrasado (o Asaas pode entregar fora de ordem).
async function markStatusIfPending(asaasCheckoutId, status) {
  const { rows } = await pool.query(
    `UPDATE asaas_checkouts
        SET status = $2, updated_at = now()
      WHERE asaas_checkout_id = $1 AND status = 'pendente'
      RETURNING *`,
    [asaasCheckoutId, status]
  );
  return rows[0] || null;
}

async function listForClient(clientUserId, { limit = 20 } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM asaas_checkouts WHERE client_user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [clientUserId, limit]
  );
  return rows;
}

module.exports = { create, findByAsaasId, markPaidOnce, markStatusIfPending, listForClient };

// Autorizações de PIX Automático: o cliente lê um QR Code que paga a primeira
// mensalidade e autoriza as próximas de uma vez só.
'use strict';

const pool = require('../db/pool');

async function create({ asaasAuthorizationId, clientUserId, planId, asaasCustomerId, amountCents }) {
  const { rows } = await pool.query(
    `INSERT INTO asaas_pix_authorizations
       (asaas_authorization_id, client_user_id, plan_id, asaas_customer_id, amount_cents)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [asaasAuthorizationId, clientUserId, planId, asaasCustomerId, amountCents]
  );
  return rows[0];
}

async function findByAsaasId(asaasAuthorizationId) {
  const { rows } = await pool.query('SELECT * FROM asaas_pix_authorizations WHERE asaas_authorization_id = $1', [
    asaasAuthorizationId,
  ]);
  return rows[0] || null;
}

// Ativa uma vez só. Mesmo motivo do checkout: o Asaas entrega os avisos "pelo
// menos uma vez", então receber a mesma ativação duas vezes é o normal - e
// ativar duas vezes aplicaria a cota do plano em dobro.
async function markActiveOnce(asaasAuthorizationId) {
  const { rows } = await pool.query(
    `UPDATE asaas_pix_authorizations
        SET status = 'ativa', activated_at = now(), updated_at = now()
      WHERE asaas_authorization_id = $1 AND status <> 'ativa'
      RETURNING *`,
    [asaasAuthorizationId]
  );
  return rows[0] || null;
}

// Só sai de 'criada': autorização já ativa não pode ser derrubada por um
// aviso atrasado de recusa/expiração.
async function markFinalIfPending(asaasAuthorizationId, status) {
  const { rows } = await pool.query(
    `UPDATE asaas_pix_authorizations
        SET status = $2, updated_at = now()
      WHERE asaas_authorization_id = $1 AND status = 'criada'
      RETURNING *`,
    [asaasAuthorizationId, status]
  );
  return rows[0] || null;
}

async function findLatestForClient(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM asaas_pix_authorizations WHERE client_user_id = $1 ORDER BY id DESC LIMIT 1',
    [clientUserId]
  );
  return rows[0] || null;
}

module.exports = { create, findByAsaasId, markActiveOnce, markFinalIfPending, findLatestForClient };

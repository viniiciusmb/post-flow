// Ver src/lib/assinaturaEmDia.js.
'use strict';

const pool = require('../db/pool');
const { sqlEmDia } = require('../lib/assinaturaEmDia');

async function emDia(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(`SELECT ${sqlEmDia('$1::bigint')} AS ok`, [userId]);
  return Boolean(rows[0] && rows[0].ok);
}

// Só a mensalidade vencida trava o painel inteiro (com o pop-up para pagar).
// Quem nunca assinou ou cancelou continua vendo o painel para escolher um plano.
async function pagamentoPendente(userId) {
  const { rows } = await pool.query('SELECT status FROM client_subscriptions WHERE client_user_id = $1', [userId]);
  return Boolean(rows[0] && rows[0].status === 'inadimplente');
}

module.exports = { emDia, pagamentoPendente };

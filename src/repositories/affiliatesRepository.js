'use strict';

const pool = require('../db/pool');

// Garante que a linha existe (mesmo padrao de client_subscriptions.getOrCreate)
// - qualquer leitura de saldo/config passa por aqui primeiro.
async function getOrCreate(userId) {
  await pool.query(
    `INSERT INTO affiliates (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const { rows } = await pool.query('SELECT * FROM affiliates WHERE user_id = $1', [userId]);
  return rows[0];
}

async function setPercentOverride(userId, percent) {
  await getOrCreate(userId);
  const { rows } = await pool.query(
    `UPDATE affiliates SET commission_percent_override = $2, updated_at = now() WHERE user_id = $1 RETURNING *`,
    [userId, percent]
  );
  return rows[0];
}

async function setPixKey(userId, { pixKey, pixKeyType }) {
  await getOrCreate(userId);
  const { rows } = await pool.query(
    `UPDATE affiliates SET pix_key = $2, pix_key_type = $3, updated_at = now() WHERE user_id = $1 RETURNING *`,
    [userId, pixKey, pixKeyType]
  );
  return rows[0];
}

// Credita uma comissao no saldo disponivel (chamado de dentro da mesma
// transacao que insere a commission_entries - ver affiliateService).
async function credit(client, userId, cents) {
  await client.query(
    `INSERT INTO affiliates (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await client.query(
    `UPDATE affiliates
     SET balance_available_cents = balance_available_cents + $2,
         total_earned_cents = total_earned_cents + $2,
         updated_at = now()
     WHERE user_id = $1`,
    [userId, cents]
  );
}

// Reserva atomicamente o valor do saque (mesmo padrao CTE + FOR UPDATE de
// clientCreditsRepository.reserve) - so aplica se houver saldo disponivel
// suficiente, tudo numa unica query. Devolve null se o saldo nao bastar.
async function reserveForWithdrawal(userId, cents) {
  const { rows } = await pool.query(
    `WITH old AS (
       SELECT balance_available_cents FROM affiliates WHERE user_id = $1 FOR UPDATE
     )
     UPDATE affiliates a
     SET balance_available_cents = a.balance_available_cents - $2,
         balance_reserved_cents = a.balance_reserved_cents + $2,
         updated_at = now()
     FROM old
     WHERE a.user_id = $1 AND old.balance_available_cents >= $2
     RETURNING a.*`,
    [userId, cents]
  );
  return rows[0] || null;
}

// Saque recusado - devolve o valor reservado pro saldo disponivel.
async function releaseReserved(userId, cents) {
  await pool.query(
    `UPDATE affiliates
     SET balance_available_cents = balance_available_cents + $2,
         balance_reserved_cents = balance_reserved_cents - $2,
         updated_at = now()
     WHERE user_id = $1`,
    [userId, cents]
  );
}

// Saque aprovado/pago - o dinheiro ja saiu de verdade, so zera o reservado
// (nao volta pro disponivel).
async function confirmWithdrawn(userId, cents) {
  await pool.query(
    `UPDATE affiliates SET balance_reserved_cents = balance_reserved_cents - $2, updated_at = now() WHERE user_id = $1`,
    [userId, cents]
  );
}

async function listAllWithStats({ from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.email, u.business_name,
            a.commission_percent_override, a.pix_key, a.pix_key_type,
            a.balance_available_cents, a.balance_reserved_cents, a.total_earned_cents,
            count(DISTINCT r.id)::int AS referral_count,
            count(DISTINCT r.id) FILTER (WHERE cs.status = 'ativo')::int AS active_subscription_count,
            coalesce(sum(ce.commission_cents) FILTER (
              WHERE ($1::timestamptz IS NULL OR ce.created_at >= $1)
                AND ($2::timestamptz IS NULL OR ce.created_at <= $2)
            ), 0)::int AS period_commission_cents
     FROM users u
     JOIN affiliate_links al ON al.owner_user_id = u.id AND al.is_default = true
     LEFT JOIN referrals r ON r.referrer_user_id = u.id
     LEFT JOIN client_subscriptions cs ON cs.client_user_id = r.referred_user_id
     LEFT JOIN affiliates a ON a.user_id = u.id
     LEFT JOIN commission_entries ce ON ce.affiliate_user_id = u.id
     WHERE u.role = 'client'
     GROUP BY u.id, a.commission_percent_override, a.pix_key, a.pix_key_type,
              a.balance_available_cents, a.balance_reserved_cents, a.total_earned_cents
     HAVING count(DISTINCT r.id) > 0 OR coalesce(a.total_earned_cents, 0) > 0
     ORDER BY coalesce(a.total_earned_cents, 0) DESC, u.email`,
    [from || null, to || null]
  );
  return rows;
}

module.exports = {
  getOrCreate,
  setPercentOverride,
  setPixKey,
  credit,
  reserveForWithdrawal,
  releaseReserved,
  confirmWithdrawn,
  listAllWithStats,
};

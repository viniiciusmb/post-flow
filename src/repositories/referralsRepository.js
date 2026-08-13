'use strict';

const pool = require('../db/pool');

async function create({ referredUserId, affiliateLinkId, referrerUserId, utm, landingPath }) {
  const { rows } = await pool.query(
    `INSERT INTO referrals (referred_user_id, affiliate_link_id, referrer_user_id,
                             utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (referred_user_id) DO NOTHING
     RETURNING *`,
    [
      referredUserId,
      affiliateLinkId || null,
      referrerUserId || null,
      (utm && utm.source) || null,
      (utm && utm.medium) || null,
      (utm && utm.campaign) || null,
      (utm && utm.content) || null,
      (utm && utm.term) || null,
      landingPath || null,
    ]
  );
  return rows[0] || null;
}

async function findByReferredUserId(referredUserId) {
  const { rows } = await pool.query('SELECT * FROM referrals WHERE referred_user_id = $1', [referredUserId]);
  return rows[0] || null;
}

async function countByReferrer(referrerUserId, { from, to } = {}) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM referrals
     WHERE referrer_user_id = $1
       AND ($2::timestamptz IS NULL OR created_at >= $2)
       AND ($3::timestamptz IS NULL OR created_at <= $3)`,
    [referrerUserId, from || null, to || null]
  );
  return rows[0].n;
}

async function countActiveSubscriptionsByReferrer(referrerUserId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM referrals r
     JOIN client_subscriptions cs ON cs.client_user_id = r.referred_user_id
     WHERE r.referrer_user_id = $1 AND cs.status = 'ativo'`,
    [referrerUserId]
  );
  return rows[0].n;
}

async function listRecentByReferrer(referrerUserId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT r.*, u.email, u.business_name, cs.status AS subscription_status
     FROM referrals r
     JOIN users u ON u.id = r.referred_user_id
     LEFT JOIN client_subscriptions cs ON cs.client_user_id = r.referred_user_id
     WHERE r.referrer_user_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [referrerUserId, limit]
  );
  return rows;
}

// Origem de todo cliente - pra tela admin "Clientes" mostrar quem indicou
// (ou a UTM, ou "Direto"). Um LEFT JOIN so, sem N+1.
async function originByUser() {
  const { rows } = await pool.query(
    `SELECT r.referred_user_id, r.utm_source, r.utm_medium, r.utm_campaign,
            ru.email AS referrer_email, ru.business_name AS referrer_business_name,
            al.label AS affiliate_link_label
     FROM referrals r
     LEFT JOIN users ru ON ru.id = r.referrer_user_id
     LEFT JOIN affiliate_links al ON al.id = r.affiliate_link_id`
  );
  return rows;
}

module.exports = {
  create,
  findByReferredUserId,
  countByReferrer,
  countActiveSubscriptionsByReferrer,
  listRecentByReferrer,
  originByUser,
};

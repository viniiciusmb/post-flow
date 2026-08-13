'use strict';

const pool = require('../db/pool');

async function create({ affiliateUserId, amountCents, pixKey, pixKeyType }) {
  const { rows } = await pool.query(
    `INSERT INTO affiliate_withdrawals (affiliate_user_id, amount_cents, pix_key, pix_key_type)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [affiliateUserId, amountCents, pixKey, pixKeyType]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM affiliate_withdrawals WHERE id = $1', [id]);
  return rows[0] || null;
}

async function resolve(id, { status, adminId, note }) {
  const { rows } = await pool.query(
    `UPDATE affiliate_withdrawals
     SET status = $2, admin_note = $3, resolved_at = now(), resolved_by_admin_id = $4
     WHERE id = $1 AND status = 'pendente'
     RETURNING *`,
    [id, status, note || null, adminId]
  );
  return rows[0] || null;
}

async function listByStatus(status) {
  const { rows } = await pool.query(
    `SELECT w.*, u.email, u.business_name
     FROM affiliate_withdrawals w
     JOIN users u ON u.id = w.affiliate_user_id
     WHERE ($1::text IS NULL OR w.status = $1)
     ORDER BY w.requested_at DESC`,
    [status || null]
  );
  return rows;
}

async function listByAffiliate(affiliateUserId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM affiliate_withdrawals WHERE affiliate_user_id = $1 ORDER BY requested_at DESC LIMIT $2`,
    [affiliateUserId, limit]
  );
  return rows;
}

module.exports = {
  create,
  findById,
  resolve,
  listByStatus,
  listByAffiliate,
};

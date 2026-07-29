'use strict';

const pool = require('../db/pool');

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ email, passwordHash, role, businessName = null }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, role, businessName]
  );
  return rows[0];
}

async function listByRole(role) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC',
    [role]
  );
  return rows;
}

async function setActive(id, isActive) {
  const { rows } = await pool.query(
    'UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, isActive]
  );
  return rows[0] || null;
}

async function touchLastActive(id) {
  await pool.query('UPDATE users SET last_active_at = now() WHERE id = $1', [id]);
}

// Lista clientes com contagem de canais e status da conta TikTok - usada na
// tela admin "Clientes".
async function listClientsWithStats() {
  const { rows } = await pool.query(
    `SELECT u.*,
            count(DISTINCT yc.id)::int AS channel_count,
            ta.display_name AS tiktok_display_name
     FROM users u
     LEFT JOIN youtube_channels yc ON yc.client_user_id = u.id
     LEFT JOIN tiktok_accounts ta ON ta.client_user_id = u.id AND ta.is_active = true
     WHERE u.role = 'client'
     GROUP BY u.id, ta.display_name
     ORDER BY u.created_at DESC`
  );
  return rows;
}

module.exports = { findByEmail, findById, create, listByRole, setActive, touchLastActive, listClientsWithStats };

'use strict';

const pool = require('../db/pool');

async function findActiveByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM tiktok_accounts WHERE client_user_id = $1 AND is_active = true',
    [clientUserId]
  );
  return rows[0] || null;
}

async function listActive() {
  const { rows } = await pool.query(
    `SELECT ta.*, u.email, u.business_name
     FROM tiktok_accounts ta
     JOIN users u ON u.id = ta.client_user_id
     WHERE ta.is_active = true
     ORDER BY ta.connected_at DESC`
  );
  return rows;
}

async function listReceivingGeneralContent() {
  const { rows } = await pool.query(
    `SELECT * FROM tiktok_accounts
     WHERE is_active = true AND receives_general_content = true`
  );
  return rows;
}

async function setReceivesGeneralContent(id, receives) {
  const { rows } = await pool.query(
    'UPDATE tiktok_accounts SET receives_general_content = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, receives]
  );
  return rows[0] || null;
}

module.exports = {
  findActiveByClientId,
  listActive,
  listReceivingGeneralContent,
  setReceivesGeneralContent,
};

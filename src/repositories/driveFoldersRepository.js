'use strict';

const pool = require('../db/pool');

async function listAll() {
  const { rows } = await pool.query('SELECT * FROM drive_folders ORDER BY created_at DESC');
  return rows;
}

async function findGeneralFolder() {
  const { rows } = await pool.query("SELECT * FROM drive_folders WHERE type = 'general' LIMIT 1");
  return rows[0] || null;
}

async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    "SELECT * FROM drive_folders WHERE type = 'client' AND client_user_id = $1",
    [clientUserId]
  );
  return rows[0] || null;
}

module.exports = { listAll, findGeneralFolder, findByClientId };

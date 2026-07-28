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

// Substitui a pasta "Geral" atual (so pode existir uma).
async function upsertGeneralFolder({ driveFolderId, folderName }) {
  await pool.query("DELETE FROM drive_folders WHERE type = 'general'");
  const { rows } = await pool.query(
    `INSERT INTO drive_folders (type, drive_folder_id, folder_name) VALUES ('general', $1, $2) RETURNING *`,
    [driveFolderId, folderName]
  );
  return rows[0];
}

// Substitui a pasta de um cliente especifico (um cliente so tem uma pasta).
async function upsertClientFolder({ clientUserId, driveFolderId, folderName }) {
  await pool.query("DELETE FROM drive_folders WHERE type = 'client' AND client_user_id = $1", [clientUserId]);
  const { rows } = await pool.query(
    `INSERT INTO drive_folders (type, client_user_id, drive_folder_id, folder_name)
     VALUES ('client', $1, $2, $3) RETURNING *`,
    [clientUserId, driveFolderId, folderName]
  );
  return rows[0];
}

async function updateLastPolled(id) {
  await pool.query('UPDATE drive_folders SET last_polled_at = now() WHERE id = $1', [id]);
}

module.exports = {
  listAll,
  findGeneralFolder,
  findByClientId,
  upsertGeneralFolder,
  upsertClientFolder,
  updateLastPolled,
};

'use strict';

const pool = require('../db/pool');

// Contas TikTok escolhidas pelo cliente pra receber os videos encontrados
// na propria pasta-fonte do Drive (drive_folders.type = 'client').
async function listByFolderId(driveFolderId) {
  const { rows } = await pool.query(
    'SELECT tiktok_account_id FROM drive_folder_tiktok_targets WHERE drive_folder_id = $1',
    [driveFolderId]
  );
  return rows.map((r) => r.tiktok_account_id);
}

async function setTargets(driveFolderId, tiktokAccountIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM drive_folder_tiktok_targets WHERE drive_folder_id = $1', [driveFolderId]);
    for (const tiktokAccountId of tiktokAccountIds) {
      await client.query(
        'INSERT INTO drive_folder_tiktok_targets (drive_folder_id, tiktok_account_id) VALUES ($1, $2)',
        [driveFolderId, tiktokAccountId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listByFolderId, setTargets };

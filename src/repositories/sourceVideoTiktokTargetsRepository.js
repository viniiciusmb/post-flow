'use strict';

const pool = require('../db/pool');

// Contas TikTok escolhidas pelo cliente pra receber os cortes de um video
// avulso (upload direto ou link colado - sem canal do YouTube).
async function listBySourceVideoId(sourceVideoId) {
  const { rows } = await pool.query(
    'SELECT tiktok_account_id FROM source_video_tiktok_targets WHERE source_video_id = $1',
    [sourceVideoId]
  );
  return rows.map((r) => r.tiktok_account_id);
}

async function setTargets(sourceVideoId, tiktokAccountIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM source_video_tiktok_targets WHERE source_video_id = $1', [sourceVideoId]);
    for (const tiktokAccountId of tiktokAccountIds) {
      await client.query(
        'INSERT INTO source_video_tiktok_targets (source_video_id, tiktok_account_id) VALUES ($1, $2)',
        [sourceVideoId, tiktokAccountId]
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

module.exports = { listBySourceVideoId, setTargets };

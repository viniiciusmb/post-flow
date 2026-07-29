'use strict';

const pool = require('../db/pool');

// Usa ON CONFLICT DO NOTHING: a restricao UNIQUE(video_id, tiktok_account_id)
// garante que o mesmo video nunca gera duas postagens para a mesma conta.
async function createIfNotExists({ videoId, tiktokAccountId }) {
  const { rows } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id)
     VALUES ($1, $2)
     ON CONFLICT (video_id, tiktok_account_id) DO NOTHING
     RETURNING *`,
    [videoId, tiktokAccountId]
  );
  return rows[0] || null;
}

const ORIGIN_CASE = `
  CASE
    WHEN v.source_type = 'youtube_clip' THEN 'youtube_clip'
    WHEN df.type = 'general' THEN 'drive_general'
    ELSE 'drive_client'
  END AS origin
`;

async function listForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, v.discovered_at, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     LEFT JOIN drive_folders df ON df.id = v.drive_folder_id
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1
     ORDER BY p.created_at DESC`,
    [clientUserId]
  );
  return rows;
}

async function listAllWithDetails() {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, u.email AS client_email, u.business_name AS client_business_name, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     LEFT JOIN drive_folders df ON df.id = v.drive_folder_id
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     JOIN users u ON u.id = ta.client_user_id
     ORDER BY p.created_at DESC
     LIMIT 200`
  );
  return rows;
}

async function updateStatus(id, { status, errorMessage = null, tiktokPublishId = null, tiktokPostId = null }) {
  const timestampColumn =
    status === 'queued' ? 'queued_at' : status === 'processing' ? 'started_at' : status === 'posted' ? 'posted_at' : null;

  const { rows } = await pool.query(
    `UPDATE postings
     SET status = $2,
         error_message = $3,
         tiktok_publish_id = COALESCE($4, tiktok_publish_id),
         tiktok_post_id = COALESCE($5, tiktok_post_id),
         attempts = CASE WHEN $2 = 'processing' THEN attempts + 1 ELSE attempts END,
         updated_at = now()
         ${timestampColumn ? `, ${timestampColumn} = now()` : ''}
     WHERE id = $1
     RETURNING *`,
    [id, status, errorMessage, tiktokPublishId, tiktokPostId]
  );
  return rows[0] || null;
}

module.exports = { createIfNotExists, listForClient, listAllWithDetails, updateStatus };

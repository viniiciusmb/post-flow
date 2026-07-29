'use strict';

const pool = require('../db/pool');

async function createMany(sourceVideoId, clips) {
  const created = [];
  for (const clip of clips) {
    const { rows } = await pool.query(
      `INSERT INTO clips (source_video_id, title, start_seconds, end_seconds)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [sourceVideoId, clip.title, clip.startSeconds, clip.endSeconds]
    );
    created.push(rows[0]);
  }
  return created;
}

async function listBySourceVideoId(sourceVideoId) {
  const { rows } = await pool.query(
    'SELECT * FROM clips WHERE source_video_id = $1 ORDER BY start_seconds ASC',
    [sourceVideoId]
  );
  return rows;
}

async function updateStatus(id, status, { errorMessage = null } = {}) {
  await pool.query(
    'UPDATE clips SET status = $2, error_message = $3, updated_at = now() WHERE id = $1',
    [id, status, errorMessage]
  );
}

async function saveRenderedFile(id, localClipPath) {
  await pool.query(
    "UPDATE clips SET local_clip_path = $2, status = 'ready', updated_at = now() WHERE id = $1",
    [id, localClipPath]
  );
}

async function countCreatedSince(since) {
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM clips WHERE created_at >= $1', [since]);
  return rows[0].count;
}

async function countByClientSince(clientUserId, since) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM clips c
     JOIN source_videos sv ON sv.id = c.source_video_id
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE yc.client_user_id = $1 AND c.created_at >= $2`,
    [clientUserId, since]
  );
  return rows[0].count;
}

async function countPostedByClientSince(clientUserId, since) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     JOIN clips c ON c.id = v.clip_id
     JOIN source_videos sv ON sv.id = c.source_video_id
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE yc.client_user_id = $1 AND p.status = 'posted' AND p.created_at >= $2`,
    [clientUserId, since]
  );
  return rows[0].count;
}

module.exports = {
  createMany,
  listBySourceVideoId,
  updateStatus,
  saveRenderedFile,
  countCreatedSince,
  countByClientSince,
  countPostedByClientSince,
};

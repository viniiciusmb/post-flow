'use strict';

const pool = require('../db/pool');

async function listActive() {
  const { rows } = await pool.query('SELECT * FROM youtube_channels WHERE is_active = true');
  return rows;
}

async function listByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM youtube_channels WHERE client_user_id = $1 ORDER BY created_at DESC',
    [clientUserId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM youtube_channels WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ clientUserId, youtubeChannelId, channelName, channelUrl, avatarUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_name, channel_url, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_user_id, youtube_channel_id) DO NOTHING
     RETURNING *`,
    [clientUserId, youtubeChannelId, channelName, channelUrl, avatarUrl]
  );
  return rows[0] || null;
}

async function setActive(id, clientUserId, isActive) {
  const { rows } = await pool.query(
    'UPDATE youtube_channels SET is_active = $3 WHERE id = $1 AND client_user_id = $2 RETURNING *',
    [id, clientUserId, isActive]
  );
  return rows[0] || null;
}

async function remove(id, clientUserId) {
  await pool.query('DELETE FROM youtube_channels WHERE id = $1 AND client_user_id = $2', [id, clientUserId]);
}

async function updatePollState(id, { lastVideoPublishedAt }) {
  await pool.query(
    'UPDATE youtube_channels SET last_polled_at = now(), last_video_published_at = COALESCE($2, last_video_published_at) WHERE id = $1',
    [id, lastVideoPublishedAt]
  );
}

module.exports = { listActive, listByClientId, findById, create, setActive, remove, updatePollState };

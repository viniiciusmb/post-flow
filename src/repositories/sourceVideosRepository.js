'use strict';

const pool = require('../db/pool');

async function createIfNotExists({ youtubeChannelId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (youtube_channel_id, youtube_video_id, title, thumbnail_url, published_at, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (youtube_video_id) DO NOTHING
     RETURNING *`,
    [youtubeChannelId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds]
  );
  return rows[0] || null;
}

async function findNextDetected() {
  const { rows } = await pool.query(
    "SELECT * FROM source_videos WHERE status = 'detected' ORDER BY created_at ASC LIMIT 1"
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM source_videos WHERE id = $1', [id]);
  return rows[0] || null;
}

async function updateStatus(id, status, { errorMessage = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE source_videos SET status = $2, error_message = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, errorMessage]
  );
  return rows[0] || null;
}

async function saveDownload(id, localVideoPath) {
  await pool.query(
    'UPDATE source_videos SET local_video_path = $2, updated_at = now() WHERE id = $1',
    [id, localVideoPath]
  );
}

async function saveTranscript(id, { transcriptText, transcriptWords, whisperAudioSeconds = null, whisperCostUsd = null }) {
  await pool.query(
    `UPDATE source_videos
     SET transcript_text = $2, transcript_words = $3,
         whisper_audio_seconds = $4, whisper_cost_usd = $5, updated_at = now()
     WHERE id = $1`,
    [id, transcriptText, JSON.stringify(transcriptWords), whisperAudioSeconds, whisperCostUsd]
  );
}

async function saveClaudeUsage(id, { inputTokens, outputTokens, costUsd }) {
  await pool.query(
    `UPDATE source_videos
     SET claude_input_tokens = $2, claude_output_tokens = $3, claude_cost_usd = $4, updated_at = now()
     WHERE id = $1`,
    [id, inputTokens, outputTokens, costUsd]
  );
}

async function markProcessingStarted(id) {
  await pool.query('UPDATE source_videos SET processing_started_at = now() WHERE id = $1', [id]);
}

// Lista videos-fonte de um cliente (via canal), com contagem de cortes - usada na tela "Videos & Cortes".
async function listForClient(clientUserId, { youtubeChannelId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name,
            (SELECT count(*) FROM clips c WHERE c.source_video_id = sv.id) AS clip_count
     FROM source_videos sv
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE yc.client_user_id = $1
       AND ($2::bigint IS NULL OR yc.id = $2)
     ORDER BY sv.created_at DESC
     LIMIT 100`,
    [clientUserId, youtubeChannelId]
  );
  return rows;
}

const ACTIVE_STATUSES = ['downloading', 'transcribing', 'selecting_clips', 'cutting'];

// Estatisticas pro card "Vídeos na fila" (admin) - qualquer coisa que ainda
// nao chegou em 'ready'/'error'.
async function countInProgress() {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM source_videos WHERE status NOT IN ('ready', 'error')"
  );
  return rows[0].count;
}

async function countByClientSince(clientUserId, since) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM source_videos sv
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE yc.client_user_id = $1 AND sv.created_at >= $2`,
    [clientUserId, since]
  );
  return rows[0].count;
}

// O video que esta sendo processado agora (se algum) - pro card de destaque
// da tela "Fila de Processamento" do admin.
async function findCurrentlyProcessing() {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = yc.client_user_id
     WHERE sv.status = ANY($1)
     ORDER BY sv.updated_at ASC
     LIMIT 1`,
    [ACTIVE_STATUSES]
  );
  return rows[0] || null;
}

async function listWaiting() {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = yc.client_user_id
     WHERE sv.status = 'detected'
     ORDER BY sv.created_at ASC`
  );
  return rows;
}

async function listRecentHistory({ limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = yc.client_user_id
     WHERE sv.status IN ('ready', 'error')
     ORDER BY sv.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  createIfNotExists,
  findNextDetected,
  findById,
  updateStatus,
  saveDownload,
  saveTranscript,
  saveClaudeUsage,
  markProcessingStarted,
  listForClient,
  countInProgress,
  countByClientSince,
  findCurrentlyProcessing,
  listWaiting,
  listRecentHistory,
};

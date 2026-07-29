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

// Video colado manualmente pelo cliente (input_type = 'manual') - nao tem
// canal, pertence direto ao cliente que colou o link.
async function createManual({ clientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (client_user_id, input_type, youtube_video_id, title, thumbnail_url, published_at, duration_seconds)
     VALUES ($1, 'manual', $2, $3, $4, $5, $6)
     ON CONFLICT (youtube_video_id) DO NOTHING
     RETURNING *`,
    [clientUserId, youtubeVideoId, title, thumbnailUrl, publishedAt, durationSeconds]
  );
  return rows[0] || null;
}

// Video enviado por upload direto (input_type = 'upload') - sem
// youtube_video_id nenhum, pertence direto ao cliente que enviou.
async function createUpload({ clientUserId, title, localVideoPath, durationSeconds }) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (client_user_id, input_type, title, local_video_path, duration_seconds, status)
     VALUES ($1, 'upload', $2, $3, $4, 'detected')
     RETURNING *`,
    [clientUserId, title, localVideoPath, durationSeconds]
  );
  return rows[0];
}

async function findByYoutubeVideoId(youtubeVideoId) {
  const { rows } = await pool.query('SELECT * FROM source_videos WHERE youtube_video_id = $1', [youtubeVideoId]);
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

// Mesma logica de posse do listForClient (canal ou dono direto pra video
// manual) - usado pra garantir que o cliente so mexe nos proprios videos.
async function findByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT sv.* FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE sv.id = $1 AND coalesce(yc.client_user_id, sv.client_user_id) = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Reinicia um video que ficou em erro (ex: bloqueio do YouTube que ja foi
// corrigido) - so mexe se ainda estiver em 'error', pra nao interferir com
// um processamento em andamento.
// Remove o video-fonte (cortes/videos/postagens ligados caem em cascata).
// So mexe se pertencer mesmo ao cliente pedindo.
async function deleteByIdOwnedByClient(id, clientUserId) {
  const { rowCount } = await pool.query(
    `DELETE FROM source_videos
     WHERE id = $1
       AND id IN (
         SELECT sv.id FROM source_videos sv
         LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
         WHERE coalesce(yc.client_user_id, sv.client_user_id) = $2
       )`,
    [id, clientUserId]
  );
  return rowCount > 0;
}

async function resetForRetry(id) {
  const { rows } = await pool.query(
    `UPDATE source_videos
     SET status = 'detected', error_message = NULL, local_video_path = NULL,
         transcript_text = NULL, transcript_words = NULL, processing_started_at = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'error'
     RETURNING *`,
    [id]
  );
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

// Lista videos-fonte de um cliente (via canal ou colados manualmente), com
// contagem de cortes - usada na tela "Videos & Cortes". LEFT JOIN porque
// video manual nao tem canal (yc.client_user_id seria NULL nesse caso).
async function listForClient(clientUserId, { youtubeChannelId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name,
            (SELECT count(*) FROM clips c WHERE c.source_video_id = sv.id) AS clip_count
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
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

async function countByClientSince(clientUserId, since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
       AND sv.created_at >= $2 AND sv.created_at <= $3`,
    [clientUserId, since, until]
  );
  return rows[0].count;
}

// O video que esta sendo processado agora (se algum) - pro card de destaque
// da tela "Fila de Processamento" do admin. LEFT JOIN pra cobrir video
// manual tambem (sem canal).
async function findCurrentlyProcessing() {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
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
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.status = 'detected'
     ORDER BY sv.created_at ASC`
  );
  return rows;
}

async function listRecentHistory({ limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT sv.*, yc.channel_name, u.email AS client_email, u.business_name AS client_business_name
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.status IN ('ready', 'error')
     ORDER BY sv.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  createIfNotExists,
  createManual,
  createUpload,
  findByYoutubeVideoId,
  findNextDetected,
  findById,
  findByIdOwnedByClient,
  deleteByIdOwnedByClient,
  resetForRetry,
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

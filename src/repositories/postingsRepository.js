'use strict';

const pool = require('../db/pool');

// Usa ON CONFLICT DO NOTHING: a restricao UNIQUE(video_id, tiktok_account_id)
// garante que o mesmo video nunca gera duas postagens para a mesma conta.
// caption comeca igual a descricao do corte (quando ha uma), mas depois e
// editavel a parte na fila sem afetar o corte original.
async function createIfNotExists({ videoId, tiktokAccountId, caption = null }) {
  const { rows } = await pool.query(
    `INSERT INTO postings (video_id, tiktok_account_id, caption)
     VALUES ($1, $2, $3)
     ON CONFLICT (video_id, tiktok_account_id) DO NOTHING
     RETURNING *`,
    [videoId, tiktokAccountId, caption]
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

// channel_name so existe pra postagens com origem youtube_clip (via
// video -> clip -> source_video -> canal); fica NULL pras de Drive.
const CHANNEL_JOIN = `
  LEFT JOIN clips c ON c.id = v.clip_id
  LEFT JOIN source_videos sv ON sv.id = c.source_video_id
  LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
`;

async function listForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, v.discovered_at, yc.channel_name, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     LEFT JOIN drive_folders df ON df.id = v.drive_folder_id
     ${CHANNEL_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1
     ORDER BY p.created_at DESC`,
    [clientUserId]
  );
  return rows;
}

async function listAllWithDetails() {
  const { rows } = await pool.query(
    `SELECT p.*, v.filename, u.email AS client_email, u.business_name AS client_business_name,
            yc.channel_name, ta.display_name AS tiktok_display_name, ${ORIGIN_CASE}
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     LEFT JOIN drive_folders df ON df.id = v.drive_folder_id
     ${CHANNEL_JOIN}
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

// So cortes gerados a partir do YouTube tem arquivo local pra publicar
// (postagem vinda do Drive ainda nao tem esse caminho implementado) - por
// isso o INNER JOIN ate clips exclui automaticamente as de origem Drive.
const CLIP_FILE_JOIN = `
  JOIN videos v ON v.id = p.video_id
  JOIN clips c ON c.id = v.clip_id
  JOIN source_videos sv ON sv.id = c.source_video_id
`;

// Postagem pendente mais antiga de uma conta - e o que o job de publicacao
// pega quando ha espaco na cota do dia.
async function findOldestPendingForAccount(tiktokAccountId) {
  const { rows } = await pool.query(
    `SELECT p.*, c.local_clip_path, c.title AS clip_title, v.file_size_bytes
     FROM postings p
     ${CLIP_FILE_JOIN}
     WHERE p.tiktok_account_id = $1 AND p.status = 'pending'
     ORDER BY p.created_at ASC
     LIMIT 1`,
    [tiktokAccountId]
  );
  return rows[0] || null;
}

// Quantas postagens ja saem hoje (no fuso da conta) - conta a partir do
// momento em que a postagem comecou a sair de verdade (queued_at), nao da
// criacao (que pode ser bem antes, quando o corte so ficou pronto).
async function countTodayForAccount(tiktokAccountId, timezone) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings
     WHERE tiktok_account_id = $1
       AND status IN ('queued', 'processing', 'posted')
       AND (queued_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [tiktokAccountId, timezone]
  );
  return rows[0].count;
}

// Ultima vez que essa conta mandou uma postagem pra fora (usado pelo modo
// automatico pra espacar - null se a conta nunca postou nada ainda).
// So conta postagens que realmente saíram (status='posted') - antes contava
// qualquer tentativa (inclusive as que falharam), fazendo uma conta com
// erro persistente (ex: permissão do TikTok recusada) esperar o mesmo
// espaçamento de "já postei recentemente" mesmo nunca tendo postado nada,
// travando o retry automático em horas em vez de minutos.
async function mostRecentPostedAt(tiktokAccountId) {
  const { rows } = await pool.query(
    "SELECT max(posted_at) AS last_posted_at FROM postings WHERE tiktok_account_id = $1 AND status = 'posted'",
    [tiktokAccountId]
  );
  return rows[0].last_posted_at;
}

// Postagens em 'processing' ha um tempo - o job de publicacao revarre essas
// pra fechar o status quando a TikTok ja tiver terminado de processar.
async function listStaleProcessing() {
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p
     WHERE p.status = 'processing' AND p.started_at < now() - interval '1 minute'`
  );
  return rows;
}

// Postagens 'posted' mais velhas que a retencao configurada - usado pelo
// job de limpeza automatica.
async function listPostedOlderThan(tiktokAccountId, hours) {
  const { rows } = await pool.query(
    `SELECT p.*, c.id AS clip_id, c.local_clip_path, c.thumbnail_path, sv.id AS source_video_id
     FROM postings p
     ${CLIP_FILE_JOIN}
     WHERE p.tiktok_account_id = $1 AND p.status = 'posted' AND p.posted_at < now() - ($2 || ' hours')::interval`,
    [tiktokAccountId, hours]
  );
  return rows;
}

// Fila de prontos aguardando postar - pro cliente revisar/editar legenda
// antes de sair.
async function listQueueForClient(clientUserId, tiktokAccountId = null) {
  const { rows } = await pool.query(
    `SELECT p.*, c.title AS clip_title, c.description AS clip_description, c.thumbnail_path,
            c.id AS clip_id, c.start_seconds, c.end_seconds
     FROM postings p
     ${CLIP_FILE_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'pending'
       AND ($2::bigint IS NULL OR p.tiktok_account_id = $2)
     ORDER BY p.created_at ASC`,
    [clientUserId, tiktokAccountId]
  );
  return rows;
}

async function listPostedForClient(clientUserId, tiktokAccountId = null) {
  const { rows } = await pool.query(
    `SELECT p.*, c.title AS clip_title, c.thumbnail_path, c.id AS clip_id
     FROM postings p
     ${CLIP_FILE_JOIN}
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'posted'
       AND ($2::bigint IS NULL OR p.tiktok_account_id = $2)
     ORDER BY p.posted_at DESC
     LIMIT 100`,
    [clientUserId, tiktokAccountId]
  );
  return rows;
}

async function countPendingForClient(clientUserId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings p
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE ta.client_user_id = $1 AND p.status = 'pending'`,
    [clientUserId]
  );
  return rows[0].count;
}

async function findByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p
     JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id
     WHERE p.id = $1 AND ta.client_user_id = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function updateCaptionOwnedByClient(id, clientUserId, caption) {
  const { rows } = await pool.query(
    `UPDATE postings SET caption = $3, updated_at = now()
     WHERE id = $1 AND status = 'pending'
       AND id IN (SELECT p.id FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id WHERE ta.client_user_id = $2)
     RETURNING *`,
    [id, clientUserId, caption]
  );
  return rows[0] || null;
}

async function skipOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE postings SET status = 'skipped', updated_at = now()
     WHERE id = $1 AND status = 'pending'
       AND id IN (SELECT p.id FROM postings p JOIN tiktok_accounts ta ON ta.id = p.tiktok_account_id WHERE ta.client_user_id = $2)
     RETURNING *`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

module.exports = {
  createIfNotExists,
  listForClient,
  listAllWithDetails,
  updateStatus,
  findOldestPendingForAccount,
  countTodayForAccount,
  mostRecentPostedAt,
  listStaleProcessing,
  listPostedOlderThan,
  listQueueForClient,
  listPostedForClient,
  countPendingForClient,
  findByIdOwnedByClient,
  updateCaptionOwnedByClient,
  skipOwnedByClient,
};

'use strict';

const pool = require('../db/pool');
const crypto = require('../lib/crypto');

async function listActiveByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM tiktok_accounts WHERE client_user_id = $1 AND is_active = true ORDER BY connected_at ASC',
    [clientUserId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM tiktok_accounts WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findActiveByIdAndClient(id, clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM tiktok_accounts WHERE id = $1 AND client_user_id = $2 AND is_active = true',
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function listActive() {
  const { rows } = await pool.query(
    `SELECT ta.*, u.email, u.business_name
     FROM tiktok_accounts ta
     JOIN users u ON u.id = ta.client_user_id
     WHERE ta.is_active = true
     ORDER BY ta.connected_at DESC`
  );
  return rows;
}

async function listReceivingGeneralContent() {
  const { rows } = await pool.query(
    `SELECT * FROM tiktok_accounts
     WHERE is_active = true AND receives_general_content = true AND auto_post_enabled = true`
  );
  return rows;
}

// Conecta uma conta TikTok pro cliente. Reconectar a MESMA conta (mesmo
// tiktok_open_id) atualiza a linha existente (tokens/nome/avatar) e
// reativa se tinha sido desconectada; conectar uma conta DIFERENTE insere
// uma linha nova ativa, sem mexer nas contas ja conectadas (uq_tiktok_accounts_client_open_id).
async function upsertForClient({
  clientUserId,
  tiktokOpenId,
  tiktokUnionId,
  displayName,
  avatarUrl,
  accessToken,
  refreshToken,
  expiresIn,
  scopes,
}) {
  const accessEnc = crypto.encrypt(accessToken);
  const refreshEnc = crypto.encrypt(refreshToken);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const { rows } = await pool.query(
    `INSERT INTO tiktok_accounts (
       client_user_id, tiktok_open_id, tiktok_union_id, display_name, avatar_url,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       token_expires_at, scopes, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
     ON CONFLICT (client_user_id, tiktok_open_id) DO UPDATE SET
       tiktok_union_id = EXCLUDED.tiktok_union_id,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       access_token_iv = EXCLUDED.access_token_iv,
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       refresh_token_iv = EXCLUDED.refresh_token_iv,
       token_expires_at = EXCLUDED.token_expires_at,
       scopes = EXCLUDED.scopes,
       is_active = true,
       updated_at = now()
     RETURNING *`,
    [
      clientUserId,
      tiktokOpenId,
      tiktokUnionId,
      displayName,
      avatarUrl,
      accessEnc.encrypted,
      accessEnc.iv,
      refreshEnc.encrypted,
      refreshEnc.iv,
      expiresAt,
      scopes,
    ]
  );
  return rows[0];
}

// Desconecta uma conta especifica (nao mexe nas outras do cliente). Canais
// e fontes que apontavam pra ela ficam sem conta vinculada (ON DELETE SET
// NULL / CASCADE nas tabelas de vinculo) - o cliente precisa escolher outra.
async function deactivate(id, clientUserId) {
  const { rows } = await pool.query(
    `UPDATE tiktok_accounts SET is_active = false, updated_at = now()
     WHERE id = $1 AND client_user_id = $2 AND is_active = true
     RETURNING *`,
    [id, clientUserId]
  );
  if (!rows[0]) return null;

  await pool.query('UPDATE youtube_channels SET tiktok_account_id = NULL WHERE tiktok_account_id = $1', [id]);
  await pool.query('DELETE FROM source_video_tiktok_targets WHERE tiktok_account_id = $1', [id]);
  await pool.query('DELETE FROM drive_folder_tiktok_targets WHERE tiktok_account_id = $1', [id]);
  return rows[0];
}

async function updateAccessToken(id, { accessToken, expiresIn }) {
  const accessEnc = crypto.encrypt(accessToken);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await pool.query(
    `UPDATE tiktok_accounts SET access_token_encrypted = $2, access_token_iv = $3, token_expires_at = $4, updated_at = now()
     WHERE id = $1`,
    [id, accessEnc.encrypted, accessEnc.iv, expiresAt]
  );
}

// Retorna um access token valido, renovando via refresh token se estiver
// perto de expirar (mesmo padrao do driveConnectionsRepository).
async function getValidAccessToken(tiktokService, account) {
  if (!account) return null;

  const expiresInMs = new Date(account.token_expires_at).getTime() - Date.now();
  if (expiresInMs > 60_000) {
    return crypto.decrypt(account.access_token_encrypted, account.access_token_iv);
  }

  const refreshToken = crypto.decrypt(account.refresh_token_encrypted, account.refresh_token_iv);
  const tokens = await tiktokService.refreshAccessToken(refreshToken);
  await updateAccessToken(account.id, { accessToken: tokens.access_token, expiresIn: tokens.expires_in });
  return tokens.access_token;
}

async function setAutoPostEnabled(id, enabled) {
  const { rows } = await pool.query(
    'UPDATE tiktok_accounts SET auto_post_enabled = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, enabled]
  );
  return rows[0] || null;
}

async function saveStats(id, { followerCount, followingCount, likesCount, videoCount }) {
  const { rows } = await pool.query(
    `UPDATE tiktok_accounts
     SET follower_count = $2, following_count = $3, likes_count = $4, video_count = $5, stats_updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, followerCount, followingCount, likesCount, videoCount]
  );
  return rows[0] || null;
}

module.exports = {
  findById,
  findActiveByIdAndClient,
  listActiveByClientId,
  listActive,
  listReceivingGeneralContent,
  upsertForClient,
  deactivate,
  getValidAccessToken,
  saveStats,
  setAutoPostEnabled,
};

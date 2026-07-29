'use strict';

const pool = require('../db/pool');
const crypto = require('../lib/crypto');

async function findActiveByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM tiktok_accounts WHERE client_user_id = $1 AND is_active = true',
    [clientUserId]
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
     WHERE is_active = true AND receives_general_content = true`
  );
  return rows;
}

async function setReceivesGeneralContent(id, receives) {
  const { rows } = await pool.query(
    'UPDATE tiktok_accounts SET receives_general_content = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, receives]
  );
  return rows[0] || null;
}

// Substitui a conexao TikTok ativa do cliente (se houver) por uma nova.
// Mantem a antiga no historico com is_active = false, respeitando a
// restricao de "no maximo uma ativa por cliente" (uq_tiktok_accounts_one_active_per_client).
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE tiktok_accounts SET is_active = false, updated_at = now() WHERE client_user_id = $1 AND is_active = true',
      [clientUserId]
    );
    const { rows } = await client.query(
      `INSERT INTO tiktok_accounts (
         client_user_id, tiktok_open_id, tiktok_union_id, display_name, avatar_url,
         access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
         token_expires_at, scopes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  findActiveByClientId,
  listActive,
  listReceivingGeneralContent,
  setReceivesGeneralContent,
  upsertForClient,
  getValidAccessToken,
  saveStats,
};

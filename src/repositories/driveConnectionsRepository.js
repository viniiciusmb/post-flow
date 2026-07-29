// A conexao OAuth do Google Drive de um dono (admin ou cliente). Cada dono
// tem no maximo uma linha (uq_drive_connections_owner_user_id): reconectar
// substitui a anterior.
'use strict';

const pool = require('../db/pool');
const crypto = require('../lib/crypto');

async function findByOwnerId(ownerUserId) {
  const { rows } = await pool.query('SELECT * FROM drive_connections WHERE owner_user_id = $1', [ownerUserId]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM drive_connections WHERE id = $1', [id]);
  return rows[0] || null;
}

async function upsert({ ownerUserId, googleAccountEmail, accessToken, refreshToken, expiresIn }) {
  const accessEnc = crypto.encrypt(accessToken);
  const refreshEnc = crypto.encrypt(refreshToken);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const { rows } = await pool.query(
    `INSERT INTO drive_connections (
       owner_user_id, google_account_email,
       access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
       token_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (owner_user_id) DO UPDATE SET
       google_account_email = $2,
       access_token_encrypted = $3, access_token_iv = $4,
       refresh_token_encrypted = $5, refresh_token_iv = $6,
       token_expires_at = $7, connected_at = now()
     RETURNING *`,
    [ownerUserId, googleAccountEmail, accessEnc.encrypted, accessEnc.iv, refreshEnc.encrypted, refreshEnc.iv, expiresAt]
  );
  return rows[0];
}

async function updateAccessToken(id, { accessToken, expiresIn }) {
  const accessEnc = crypto.encrypt(accessToken);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await pool.query(
    `UPDATE drive_connections
     SET access_token_encrypted = $2, access_token_iv = $3, token_expires_at = $4
     WHERE id = $1`,
    [id, accessEnc.encrypted, accessEnc.iv, expiresAt]
  );
}

// Retorna um access token valido pra usar na API do Drive, renovando
// automaticamente (via refresh token) se estiver perto de expirar.
async function getValidAccessToken(googleService, connection) {
  if (!connection) return null;

  const expiresInMs = new Date(connection.token_expires_at).getTime() - Date.now();
  if (expiresInMs > 60_000) {
    return crypto.decrypt(connection.access_token_encrypted, connection.access_token_iv);
  }

  const refreshToken = crypto.decrypt(connection.refresh_token_encrypted, connection.refresh_token_iv);
  const tokens = await googleService.refreshAccessToken(refreshToken);
  await updateAccessToken(connection.id, { accessToken: tokens.access_token, expiresIn: tokens.expires_in });
  return tokens.access_token;
}

module.exports = { findByOwnerId, findById, upsert, updateAccessToken, getValidAccessToken };

// Utilitarios compartilhados pelos testes. O Postgres em si e subido pelo
// scripts/run-tests.js (npm test) - aqui so falamos com ele.
'use strict';

const pool = require('../../src/db/pool');

let counter = 0;

// Cliente novo a cada chamada (e-mail unico) - assim os arquivos de teste
// compartilham o mesmo banco sem interferir uns nos outros.
async function createClient({ businessName = 'Cliente de teste' } = {}) {
  counter += 1;
  const email = `cliente${counter}_${Date.now()}@teste.local`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, business_name)
     VALUES ($1, 'hash-de-mentira', 'client', $2) RETURNING *`,
    [email, businessName]
  );
  return rows[0];
}

async function createSourceVideo(clientUserId, { status = 'detected', durationSeconds = 600, title = 'Video de teste' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO source_videos (title, status, input_type, client_user_id, owner_client_user_id, duration_seconds)
     VALUES ($1, $2, 'manual', $3, $3, $4) RETURNING *`,
    [title, status, clientUserId, durationSeconds]
  );
  return rows[0];
}

async function createYoutubeChannel(clientUserId, { channelId = null, name = 'Canal de teste' } = {}) {
  counter += 1;
  const ytId = channelId || `UC_teste_${counter}_${Date.now()}`;
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_name, channel_url)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [clientUserId, ytId, name, `https://youtube.com/channel/${ytId}`]
  );
  return rows[0];
}

// Da saldo pro cliente sem depender do fluxo de assinatura/Stripe.
async function giveCredits(clientUserId, { quotaNormal = 0, quotaBonus = 0, extraNormal = 0, extraBonus = 0 } = {}) {
  await pool.query(
    `INSERT INTO client_credits (client_user_id, quota_normal, quota_bonus, extra_normal, extra_bonus)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_user_id) DO UPDATE
       SET quota_normal = $2, quota_bonus = $3, extra_normal = $4, extra_bonus = $5,
           used_normal = 0, used_bonus = 0`,
    [clientUserId, quotaNormal, quotaBonus, extraNormal, extraBonus]
  );
}

async function readCredits(clientUserId) {
  const { rows } = await pool.query('SELECT * FROM client_credits WHERE client_user_id = $1', [clientUserId]);
  return rows[0];
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  createClient,
  createSourceVideo,
  createYoutubeChannel,
  giveCredits,
  readCredits,
  closePool,
};

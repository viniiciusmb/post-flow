'use strict';

const pool = require('../db/pool');

// Configuração de publicação de uma conta de Instagram/Facebook/Threads/...
// (migration 111). Mesmo formato do posting_schedule_settings do TikTok, pra a
// conta dos horários (lib/postingSchedule.js) ser a mesma nas duas.

async function find(socialAccountId) {
  const { rows } = await pool.query('SELECT * FROM social_posting_settings WHERE social_account_id = $1', [socialAccountId]);
  return rows[0] || null;
}

// Sempre devolve uma configuração usável: cria com os padrões na primeira vez.
async function findOrCreate(socialAccountId) {
  const existente = await find(socialAccountId);
  if (existente) return existente;
  await pool.query('INSERT INTO social_posting_settings (social_account_id) VALUES ($1) ON CONFLICT DO NOTHING', [socialAccountId]);
  return find(socialAccountId);
}

async function salvarHorarios(socialAccountId, { mode, videosPerDay, manualTimes }) {
  await findOrCreate(socialAccountId);
  const { rows } = await pool.query(
    `UPDATE social_posting_settings
        SET mode = $2, videos_per_day = $3, manual_times = $4, updated_at = now()
      WHERE social_account_id = $1 RETURNING *`,
    [socialAccountId, mode, videosPerDay, manualTimes]
  );
  return rows[0];
}

async function setPaused(socialAccountId, paused) {
  await findOrCreate(socialAccountId);
  const { rows } = await pool.query(
    'UPDATE social_posting_settings SET paused = $2, updated_at = now() WHERE social_account_id = $1 RETURNING *',
    [socialAccountId, paused]
  );
  return rows[0];
}

async function setAutoPost(socialAccountId, enabled) {
  await findOrCreate(socialAccountId);
  const { rows } = await pool.query(
    'UPDATE social_posting_settings SET auto_post_enabled = $2, updated_at = now() WHERE social_account_id = $1 RETURNING *',
    [socialAccountId, enabled]
  );
  return rows[0];
}

// Junta as opções novas às que já existem (mexer na privacidade do YouTube não
// apaga nada que não veio no pedido).
async function mesclarOpcoes(socialAccountId, opcoes) {
  await findOrCreate(socialAccountId);
  const { rows } = await pool.query(
    `UPDATE social_posting_settings SET options = options || $2::jsonb, updated_at = now()
      WHERE social_account_id = $1 RETURNING *`,
    [socialAccountId, JSON.stringify(opcoes)]
  );
  return rows[0];
}

module.exports = { find, findOrCreate, salvarHorarios, setPaused, setAutoPost, mesclarOpcoes };

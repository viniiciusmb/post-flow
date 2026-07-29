'use strict';

const pool = require('../db/pool');

const DEFAULTS = {
  mode: 'auto',
  videos_per_day: 3,
  manual_times: [],
  timezone: 'America/Sao_Paulo',
  auto_delete_after_hours: 168,
};

async function findByTiktokAccountId(tiktokAccountId) {
  const { rows } = await pool.query('SELECT * FROM posting_schedule_settings WHERE tiktok_account_id = $1', [
    tiktokAccountId,
  ]);
  return rows[0] || null;
}

// Sempre devolve uma configuracao usavel - cria a linha com os padroes na
// primeira vez que alguem pede (tela do cliente ou o job de postagem).
async function findOrCreateByTiktokAccountId(tiktokAccountId) {
  const existing = await findByTiktokAccountId(tiktokAccountId);
  if (existing) return existing;

  const { rows } = await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone, auto_delete_after_hours)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tiktok_account_id) DO NOTHING
     RETURNING *`,
    [
      tiktokAccountId,
      DEFAULTS.mode,
      DEFAULTS.videos_per_day,
      DEFAULTS.manual_times,
      DEFAULTS.timezone,
      DEFAULTS.auto_delete_after_hours,
    ]
  );
  return rows[0] || (await findByTiktokAccountId(tiktokAccountId));
}

async function upsert(tiktokAccountId, { mode, videosPerDay, manualTimes, timezone, autoDeleteAfterHours }) {
  const { rows } = await pool.query(
    `INSERT INTO posting_schedule_settings (tiktok_account_id, mode, videos_per_day, manual_times, timezone, auto_delete_after_hours)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tiktok_account_id) DO UPDATE SET
       mode = $2, videos_per_day = $3, manual_times = $4, timezone = $5,
       auto_delete_after_hours = $6, updated_at = now()
     RETURNING *`,
    [tiktokAccountId, mode, videosPerDay, manualTimes, timezone, autoDeleteAfterHours]
  );
  return rows[0];
}

// Contas que tem retencao automatica ligada (auto_delete_after_hours nao
// nulo) - usado pelo job de limpeza, que so precisa varrer essas.
async function listWithAutoDelete() {
  const { rows } = await pool.query(
    `SELECT pss.*, ta.client_user_id
     FROM posting_schedule_settings pss
     JOIN tiktok_accounts ta ON ta.id = pss.tiktok_account_id
     WHERE pss.auto_delete_after_hours IS NOT NULL`
  );
  return rows;
}

module.exports = { findByTiktokAccountId, findOrCreateByTiktokAccountId, upsert, listWithAutoDelete, DEFAULTS };

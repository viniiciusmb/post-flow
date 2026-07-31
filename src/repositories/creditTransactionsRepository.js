'use strict';

const pool = require('../db/pool');

// UNIQUE (source_video_id) na tabela e o que garante "reprocessar nao gera
// novo debito" - se ja existe uma linha 'confirmado'/'reservado' pra esse
// video, o creditsService nunca chega a chamar isso de novo (ver
// findBySourceVideoId usado antes de reservar). O ON CONFLICT so serve pro
// caso de uma tentativa anterior ter 'liberado' o credito (download tinha
// falhado antes) - reaproveita a mesma linha pra nova reserva em vez de
// tentar inserir e esbarrar na UNIQUE constraint.
async function createReserved({ clientUserId, sourceVideoId, bucket, minutesCharged, minutesFromQuota, minutesFromExtra }) {
  const { rows } = await pool.query(
    `INSERT INTO credit_transactions
       (client_user_id, source_video_id, bucket, status, minutes_charged, minutes_from_quota, minutes_from_extra)
     VALUES ($1, $2, $3, 'reservado', $4, $5, $6)
     ON CONFLICT (source_video_id) DO UPDATE SET
       bucket = EXCLUDED.bucket, status = 'reservado', minutes_charged = EXCLUDED.minutes_charged,
       minutes_from_quota = EXCLUDED.minutes_from_quota, minutes_from_extra = EXCLUDED.minutes_from_extra,
       updated_at = now()
     WHERE credit_transactions.status = 'liberado'
     RETURNING *`,
    [clientUserId, sourceVideoId, bucket, minutesCharged, minutesFromQuota, minutesFromExtra]
  );
  return rows[0];
}

async function findBySourceVideoId(sourceVideoId) {
  const { rows } = await pool.query('SELECT * FROM credit_transactions WHERE source_video_id = $1', [sourceVideoId]);
  return rows[0] || null;
}

async function markConfirmed(sourceVideoId, { downloadPath = null } = {}) {
  const { rows } = await pool.query(
    `UPDATE credit_transactions SET status = 'confirmado', download_path = $2, updated_at = now()
     WHERE source_video_id = $1 RETURNING *`,
    [sourceVideoId, downloadPath]
  );
  return rows[0] || null;
}

async function markReleased(sourceVideoId) {
  const { rows } = await pool.query(
    `UPDATE credit_transactions SET status = 'liberado', updated_at = now()
     WHERE source_video_id = $1 RETURNING *`,
    [sourceVideoId]
  );
  return rows[0] || null;
}

// Reconciliacao rara (egress real caiu num bolso diferente do reservado -
// ver creditsService) - reescreve a linha pro bolso/quantidades corretas.
async function moveBucket(sourceVideoId, { bucket, minutesFromQuota, minutesFromExtra, downloadPath }) {
  const { rows } = await pool.query(
    `UPDATE credit_transactions
     SET bucket = $2, minutes_from_quota = $3, minutes_from_extra = $4, download_path = $5,
         status = 'confirmado', updated_at = now()
     WHERE source_video_id = $1
     RETURNING *`,
    [sourceVideoId, bucket, minutesFromQuota, minutesFromExtra, downloadPath]
  );
  return rows[0] || null;
}

async function listByClientId(clientUserId, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_transactions WHERE client_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientUserId, limit]
  );
  return rows;
}

module.exports = {
  createReserved,
  findBySourceVideoId,
  markConfirmed,
  markReleased,
  moveBucket,
  listByClientId,
};

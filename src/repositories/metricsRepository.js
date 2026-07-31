'use strict';

const pool = require('../db/pool');

// ---------- clientes ----------

async function clientActivity(sinceActive) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE last_active_at >= $1)::int AS active,
       count(*) FILTER (WHERE last_active_at IS NULL OR last_active_at < $1)::int AS inactive
     FROM users WHERE role = 'client'`,
    [sinceActive]
  );
  return rows[0];
}

async function clientRanking({ since, until = new Date(), limit = 5 }) {
  const { rows } = await pool.query(
    `SELECT u.id, u.business_name, u.email, count(sv.id)::int AS videos_count
     FROM users u
     JOIN youtube_channels yc ON yc.client_user_id = u.id
     JOIN source_videos sv ON sv.youtube_channel_id = yc.id AND sv.created_at >= $1 AND sv.created_at <= $2
     WHERE u.role = 'client'
     GROUP BY u.id
     ORDER BY videos_count DESC
     LIMIT $3`,
    [since, until, limit]
  );
  return rows;
}

// ---------- volume / aproveitamento ----------

async function volumeSince(since, until = new Date()) {
  const [videos, clips, posted] = await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM source_videos WHERE created_at >= $1 AND created_at <= $2', [since, until]),
    pool.query('SELECT count(*)::int AS count FROM clips WHERE created_at >= $1 AND created_at <= $2', [since, until]),
    pool.query(
      `SELECT count(*)::int AS count FROM postings p
       JOIN videos v ON v.id = p.video_id
       WHERE v.source_type = 'youtube_clip' AND p.status = 'posted' AND p.created_at >= $1 AND p.created_at <= $2`,
      [since, until]
    ),
  ]);
  return {
    videosDetected: videos.rows[0].count,
    clipsGenerated: clips.rows[0].count,
    clipsPosted: posted.rows[0].count,
  };
}

// ---------- pipeline (saude, fila, tempos) ----------

async function pipelineHealthSince(since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'ready')::int AS ready,
       count(*) FILTER (WHERE status = 'error')::int AS errors,
       avg(EXTRACT(EPOCH FROM (updated_at - processing_started_at))) FILTER (WHERE status = 'ready' AND processing_started_at IS NOT NULL) AS avg_processing_seconds,
       avg(EXTRACT(EPOCH FROM (processing_started_at - created_at))) FILTER (WHERE processing_started_at IS NOT NULL) AS avg_queue_wait_seconds
     FROM source_videos
     WHERE created_at >= $1 AND created_at <= $2 AND status IN ('ready', 'error')`,
    [since, until]
  );
  const row = rows[0];
  const total = row.ready + row.errors;
  return {
    errorRate: total > 0 ? row.errors / total : 0,
    totalFinished: total,
    avgProcessingSeconds: row.avg_processing_seconds ? Number(row.avg_processing_seconds) : null,
    avgQueueWaitSeconds: row.avg_queue_wait_seconds ? Number(row.avg_queue_wait_seconds) : null,
  };
}

async function queueDepth() {
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM source_videos WHERE status = 'detected'");
  return rows[0].count;
}

// ---------- custo ----------

async function costSince(since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT
       coalesce(sum(whisper_cost_usd), 0) AS whisper_cost_usd,
       coalesce(sum(claude_cost_usd), 0) AS claude_cost_usd,
       count(*) FILTER (WHERE whisper_cost_usd IS NOT NULL OR claude_cost_usd IS NOT NULL)::int AS videos_with_cost
     FROM source_videos WHERE created_at >= $1 AND created_at <= $2`,
    [since, until]
  );
  const row = rows[0];
  const whisperCostUsd = Number(row.whisper_cost_usd);
  const claudeCostUsd = Number(row.claude_cost_usd);
  return {
    whisperCostUsd,
    claudeCostUsd,
    totalCostUsd: whisperCostUsd + claudeCostUsd,
    videosWithCost: row.videos_with_cost,
  };
}

// ---------- servicos (heartbeat) ----------

async function upsertHeartbeat(serviceName) {
  await pool.query(
    `INSERT INTO service_heartbeats (service_name, last_heartbeat_at) VALUES ($1, now())
     ON CONFLICT (service_name) DO UPDATE SET last_heartbeat_at = now()`,
    [serviceName]
  );
}

async function listServiceStatus() {
  const { rows } = await pool.query(
    `SELECT service_name, last_heartbeat_at,
            (now() - last_heartbeat_at) < interval '90 seconds' AS is_up
     FROM service_heartbeats
     ORDER BY service_name`
  );
  return rows;
}

// ---------- uso do cliente ----------

async function clientUsageSince(clientUserId, since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT count(sv.id)::int AS videos_count, coalesce(sum(sv.duration_seconds), 0)::int AS total_duration_seconds
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1 AND sv.created_at >= $2 AND sv.created_at <= $3`,
    [clientUserId, since, until]
  );
  return rows[0];
}

async function clientUsageHistory(clientUserId, since) {
  const { rows } = await pool.query(
    `SELECT date_trunc('day', sv.created_at)::date AS day, count(*)::int AS videos_count
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1 AND sv.created_at >= $2
     GROUP BY day
     ORDER BY day DESC`,
    [clientUserId, since]
  );
  return rows;
}

// ---------- rollup diario / retencao ----------

async function computeDailyRollup(day) {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int AS videos_detected,
       count(*) FILTER (WHERE status = 'error' AND updated_at >= $1 AND updated_at < $2)::int AS pipeline_errors,
       coalesce(sum(whisper_cost_usd) FILTER (WHERE updated_at >= $1 AND updated_at < $2), 0) AS whisper_cost_usd,
       coalesce(sum(claude_cost_usd) FILTER (WHERE updated_at >= $1 AND updated_at < $2), 0) AS claude_cost_usd,
       avg(EXTRACT(EPOCH FROM (updated_at - processing_started_at)))
         FILTER (WHERE status = 'ready' AND updated_at >= $1 AND updated_at < $2 AND processing_started_at IS NOT NULL) AS avg_processing_seconds
     FROM source_videos`,
    [dayStart, dayEnd]
  );

  const [clips, posted] = await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM clips WHERE created_at >= $1 AND created_at < $2', [dayStart, dayEnd]),
    pool.query(
      `SELECT count(*)::int AS count FROM postings p
       JOIN videos v ON v.id = p.video_id
       WHERE v.source_type = 'youtube_clip' AND p.status = 'posted' AND p.updated_at >= $1 AND p.updated_at < $2`,
      [dayStart, dayEnd]
    ),
  ]);

  const row = rows[0];
  await pool.query(
    `INSERT INTO metrics_daily (day, videos_detected, clips_generated, clips_posted, pipeline_errors, whisper_cost_usd, claude_cost_usd, avg_processing_seconds, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (day) DO UPDATE SET
       videos_detected = $2, clips_generated = $3, clips_posted = $4, pipeline_errors = $5,
       whisper_cost_usd = $6, claude_cost_usd = $7, avg_processing_seconds = $8, computed_at = now()`,
    [
      dayStart.toISOString().slice(0, 10),
      row.videos_detected,
      clips.rows[0].count,
      posted.rows[0].count,
      row.pipeline_errors,
      row.whisper_cost_usd,
      row.claude_cost_usd,
      row.avg_processing_seconds,
    ]
  );
}

// Video ja concluido (ready/error) ha mais de `days` dias nao precisa mais
// guardar a transcricao inteira (pode passar de varias dezenas de KB por
// video) - os numeros que importam pra sempre (custo, duracao, contagens) ja
// estao em colunas proprias e no rollup diario.
async function pruneOldTranscripts(days) {
  const { rowCount } = await pool.query(
    `UPDATE source_videos
     SET transcript_text = NULL, transcript_words = NULL
     WHERE status IN ('ready', 'error')
       AND updated_at < now() - ($1 || ' days')::interval
       AND transcript_text IS NOT NULL`,
    [days]
  );
  return rowCount;
}

// Amostra mais recente de uso da VPS (CPU/memoria/disco) - pros numeros
// "agora" no card do admin.
async function latestSystemMetric() {
  const { rows } = await pool.query('SELECT * FROM system_metrics_samples ORDER BY sampled_at DESC LIMIT 1');
  return rows[0] || null;
}

// Serie historica pro grafico (ultimas N horas).
async function systemMetricsSince(since) {
  const { rows } = await pool.query(
    'SELECT * FROM system_metrics_samples WHERE sampled_at >= $1 ORDER BY sampled_at ASC',
    [since]
  );
  return rows;
}

async function insertSystemMetricSample({ loadAvg1m, cpuCores, memUsedMb, memTotalMb, diskUsedGb, diskTotalGb }) {
  await pool.query(
    `INSERT INTO system_metrics_samples (load_avg_1m, cpu_cores, mem_used_mb, mem_total_mb, disk_used_gb, disk_total_gb)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [loadAvg1m, cpuCores, memUsedMb, memTotalMb, diskUsedGb, diskTotalGb]
  );
}

// Mantem so os ultimos 30 dias de amostras (a cada 5min isso ja da mais de
// 8 mil linhas - nao precisa crescer pra sempre).
async function pruneOldSystemMetrics() {
  await pool.query("DELETE FROM system_metrics_samples WHERE sampled_at < now() - interval '30 days'");
}

// ---------- banda (tunel/proxy) - painel "Banda", custo/margem ----------

async function bandwidthByEgressSince(since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT
       coalesce(download_egress_type, 'direct') AS egress_type,
       coalesce(sum(download_bytes), 0) AS bytes,
       count(*)::int AS videos
     FROM source_videos
     WHERE download_bytes IS NOT NULL AND created_at >= $1 AND created_at <= $2
     GROUP BY coalesce(download_egress_type, 'direct')`,
    [since, until]
  );
  return rows.map((r) => ({ egressType: r.egress_type, bytes: Number(r.bytes), videos: r.videos }));
}

// Por cliente: quanto saiu pelo tunel DELE mesmo vs quanto caiu pro
// fallback (tunel do founder ou proxy pago) - "fallback alto" sinaliza que
// o tunel daquele cliente nao estava confiavel no periodo.
async function bandwidthByClientSince(since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT
       u.id AS client_user_id, u.business_name, u.email,
       coalesce(sum(sv.download_bytes) FILTER (WHERE sv.download_egress_type = 'client_tunnel'), 0) AS own_tunnel_bytes,
       coalesce(sum(sv.download_bytes) FILTER (WHERE sv.download_egress_type != 'client_tunnel'), 0) AS fallback_bytes,
       count(sv.id)::int AS videos
     FROM source_videos sv
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     JOIN users u ON u.id = coalesce(yc.client_user_id, sv.client_user_id)
     WHERE sv.download_bytes IS NOT NULL AND sv.created_at >= $1 AND sv.created_at <= $2
     GROUP BY u.id, u.business_name, u.email
     ORDER BY sum(sv.download_bytes) DESC`,
    [since, until]
  );
  return rows.map((r) => ({
    clientUserId: r.client_user_id,
    name: r.business_name || r.email,
    ownTunnelBytes: Number(r.own_tunnel_bytes),
    fallbackBytes: Number(r.fallback_bytes),
    videos: r.videos,
  }));
}

module.exports = {
  clientActivity,
  clientRanking,
  volumeSince,
  pipelineHealthSince,
  queueDepth,
  costSince,
  upsertHeartbeat,
  listServiceStatus,
  clientUsageSince,
  clientUsageHistory,
  latestSystemMetric,
  systemMetricsSince,
  insertSystemMetricSample,
  pruneOldSystemMetrics,
  computeDailyRollup,
  bandwidthByEgressSince,
  bandwidthByClientSince,
  pruneOldTranscripts,
};

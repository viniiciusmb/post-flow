'use strict';

const metricsRepository = require('../../../repositories/metricsRepository');
const downloadTunnelsRepository = require('../../../repositories/downloadTunnelsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const { resolveRange } = require('../../../lib/dateRanges');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// O backup do banco roda por cron NO HOST da VPS (scripts/backup-db.sh), fora
// do Node - a unica coisa que ele deixa aqui e a chave "last_db_backup" em
// settings. Traduzimos isso pra um status legivel porque a falha mais perigosa
// de backup e a silenciosa: parou de rodar ha semanas e ninguem percebeu.
const BACKUP_STALE_HOURS = 36;

function buildBackupStatus(raw) {
  if (!raw || !raw.at) {
    return { status: 'nunca', lastAt: null, ageHours: null, detail: 'nenhum backup registrado ainda' };
  }
  const lastAt = new Date(raw.at);
  const ageHours = (Date.now() - lastAt.getTime()) / 3_600_000;
  let status = raw.status === 'ok' ? 'ok' : 'erro';
  if (status === 'ok' && ageHours > BACKUP_STALE_HOURS) status = 'atrasado';
  return {
    status,
    lastAt: lastAt.toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    sizeBytes: raw.bytes ? Number(raw.bytes) : null,
    detail: raw.detail || null,
  };
}

async function overview(req, res) {
  const since7d = daysAgo(7);
  const since30d = daysAgo(30);
  const { range, since, until } = resolveRange(req.query.range);

  const [
    clients,
    volume30d,
    videos7d,
    ranking,
    pipeline,
    cost7d,
    cost30d,
    queueDepth,
    services,
    volumeSelected,
    pipelineSelected,
    costSelected,
    rankingSelected,
    systemLatest,
    systemHistory,
    connectedTunnels,
    lastBackupRaw,
  ] = await Promise.all([
    metricsRepository.clientActivity(since30d),
    metricsRepository.volumeSince(since30d),
    metricsRepository.volumeSince(since7d),
    metricsRepository.clientRanking({ since: since30d, limit: 5 }),
    metricsRepository.pipelineHealthSince(since30d),
    metricsRepository.costSince(since7d),
    metricsRepository.costSince(since30d),
    metricsRepository.queueDepth(),
    metricsRepository.listServiceStatus(),
    metricsRepository.volumeSince(since, until),
    metricsRepository.pipelineHealthSince(since, until),
    metricsRepository.costSince(since, until),
    metricsRepository.clientRanking({ since, until, limit: 5 }),
    metricsRepository.latestSystemMetric(),
    metricsRepository.systemMetricsSince(daysAgo(1)),
    downloadTunnelsRepository.countConnectedClients(),
    settingsRepository.getValue('last_db_backup', null),
  ]);

  const aproveitamentoRate = volume30d.clipsGenerated > 0 ? volume30d.clipsPosted / volume30d.clipsGenerated : null;
  const avgCostPerVideo = cost30d.videosWithCost > 0 ? cost30d.totalCostUsd / cost30d.videosWithCost : null;
  const projectedMonthlyUsd = (cost7d.totalCostUsd / 7) * 30;
  const aproveitamentoRateSelected =
    volumeSelected.clipsGenerated > 0 ? volumeSelected.clipsPosted / volumeSelected.clipsGenerated : null;
  const avgCostPerVideoSelected =
    costSelected.videosWithCost > 0 ? costSelected.totalCostUsd / costSelected.videosWithCost : null;

  res.json({
    range: { key: range, since, until },
    clients: { active: clients.active, inactive: clients.inactive },
    volume: {
      videosDetected7d: videos7d.videosDetected,
      videosDetected30d: volume30d.videosDetected,
      clipsGenerated30d: volume30d.clipsGenerated,
      clipsPosted30d: volume30d.clipsPosted,
      aproveitamentoRate,
    },
    ranking: ranking.map((r) => ({ name: r.business_name || r.email, videosCount: r.videos_count })),
    pipeline: {
      errorRate30d: pipeline.errorRate,
      totalFinished30d: pipeline.totalFinished,
      avgProcessingSeconds: pipeline.avgProcessingSeconds,
      avgQueueWaitSeconds: pipeline.avgQueueWaitSeconds,
      queueDepth,
    },
    cost: {
      whisperCostUsd7d: cost7d.whisperCostUsd,
      claudeCostUsd7d: cost7d.claudeCostUsd,
      totalCostUsd7d: cost7d.totalCostUsd,
      avgCostPerVideo30d: avgCostPerVideo,
      projectedMonthlyUsd,
    },
    services: services.map((s) => ({
      name: s.service_name,
      lastHeartbeatAt: s.last_heartbeat_at,
      isUp: s.is_up,
    })),
    tunnels: { connectedClients: connectedTunnels },
    backup: buildBackupStatus(lastBackupRaw),
    system: {
      latest: systemLatest
        ? {
            sampledAt: systemLatest.sampled_at,
            loadAvg1m: Number(systemLatest.load_avg_1m),
            cpuCores: systemLatest.cpu_cores,
            memUsedMb: systemLatest.mem_used_mb,
            memTotalMb: systemLatest.mem_total_mb,
            diskUsedGb: systemLatest.disk_used_gb !== null ? Number(systemLatest.disk_used_gb) : null,
            diskTotalGb: systemLatest.disk_total_gb !== null ? Number(systemLatest.disk_total_gb) : null,
          }
        : null,
      history: systemHistory.map((s) => ({
        sampledAt: s.sampled_at,
        loadAvg1m: Number(s.load_avg_1m),
        cpuCores: s.cpu_cores,
        memUsedMb: s.mem_used_mb,
        memTotalMb: s.mem_total_mb,
      })),
    },
    // Numeros recalculados so pro periodo escolhido no filtro (Hoje/Ontem/etc) -
    // os blocos acima continuam fixos em 7d/30d como referencia de tendencia.
    selected: {
      videosDetected: volumeSelected.videosDetected,
      clipsGenerated: volumeSelected.clipsGenerated,
      clipsPosted: volumeSelected.clipsPosted,
      aproveitamentoRate: aproveitamentoRateSelected,
      errorRate: pipelineSelected.errorRate,
      totalFinished: pipelineSelected.totalFinished,
      avgProcessingSeconds: pipelineSelected.avgProcessingSeconds,
      totalCostUsd: costSelected.totalCostUsd,
      avgCostPerVideo: avgCostPerVideoSelected,
      ranking: rankingSelected.map((r) => ({ name: r.business_name || r.email, videosCount: r.videos_count })),
    },
  });
}

module.exports = { overview };

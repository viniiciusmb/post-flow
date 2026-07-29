'use strict';

const metricsRepository = require('../../../repositories/metricsRepository');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function overview(req, res) {
  const since7d = daysAgo(7);
  const since30d = daysAgo(30);

  const [clients, volume30d, videos7d, ranking, pipeline, cost7d, cost30d, queueDepth, services] = await Promise.all([
    metricsRepository.clientActivity(since30d),
    metricsRepository.volumeSince(since30d),
    metricsRepository.volumeSince(since7d),
    metricsRepository.clientRanking({ since: since30d, limit: 5 }),
    metricsRepository.pipelineHealthSince(since30d),
    metricsRepository.costSince(since7d),
    metricsRepository.costSince(since30d),
    metricsRepository.queueDepth(),
    metricsRepository.listServiceStatus(),
  ]);

  const aproveitamentoRate = volume30d.clipsGenerated > 0 ? volume30d.clipsPosted / volume30d.clipsGenerated : null;
  const avgCostPerVideo = cost30d.videosWithCost > 0 ? cost30d.totalCostUsd / cost30d.videosWithCost : null;
  const projectedMonthlyUsd = (cost7d.totalCostUsd / 7) * 30;

  res.json({
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
  });
}

module.exports = { overview };

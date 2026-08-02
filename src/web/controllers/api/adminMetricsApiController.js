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

// Cada painel da tela de metricas tem o SEU proprio filtro de periodo.
//
// Antes havia um filtro so no topo, mas os blocos "Clientes e volume", "Saude
// do pipeline" e "Custo de API" mostravam janelas fixas de 7 e 30 dias e
// simplesmente ignoravam ele - so o bloco "Periodo selecionado" respondia. Na
// pratica, escolher "Hoje" nao mudava o custo de IA, o que parecia painel
// quebrado (e era: o numero na tela nao correspondia ao filtro em cima dele).
//
// Agora o front manda uma chave por painel (?volume=today&pipeline=last7days&
// cost=this_month) e cada bloco responde pelo periodo dele. Numa chamada so,
// pra nao virar tres requisicoes a cada clique.
const PAINEIS = ['volume', 'pipeline', 'cost', 'ranking'];

async function overview(req, res) {
  // Cada painel cai no padrao (7 dias) se o front nao mandar nada, e
  // resolveRange ja ignora chave invalida.
  const periodos = Object.fromEntries(PAINEIS.map((p) => [p, resolveRange(req.query[p])]));

  const [
    clients,
    volume,
    pipeline,
    cost,
    ranking,
    costPrevisao,
    queueDepth,
    services,
    systemLatest,
    systemHistory,
    connectedTunnels,
    lastBackupRaw,
  ] = await Promise.all([
    metricsRepository.clientActivity(daysAgo(30)),
    metricsRepository.volumeSince(periodos.volume.since, periodos.volume.until),
    metricsRepository.pipelineHealthSince(periodos.pipeline.since, periodos.pipeline.until),
    metricsRepository.costSince(periodos.cost.since, periodos.cost.until),
    metricsRepository.clientRanking({ since: periodos.ranking.since, until: periodos.ranking.until, limit: 5 }),
    // A projecao mensal e a unica coisa que precisa de janela fixa: ela existe
    // justamente pra extrapolar a media recente, entao seguir o filtro
    // tornaria o numero sem sentido ("projecao do mes com base em hoje").
    metricsRepository.costSince(daysAgo(7)),
    metricsRepository.queueDepth(),
    metricsRepository.listServiceStatus(),
    metricsRepository.latestSystemMetric(),
    metricsRepository.systemMetricsSince(daysAgo(1)),
    downloadTunnelsRepository.countConnectedClients(),
    settingsRepository.getValue('last_db_backup', null),
  ]);

  const aproveitamentoRate = volume.clipsGenerated > 0 ? volume.clipsPosted / volume.clipsGenerated : null;
  const avgCostPerVideo = cost.videosWithCost > 0 ? cost.totalCostUsd / cost.videosWithCost : null;
  const projectedMonthlyUsd = (costPrevisao.totalCostUsd / 7) * 30;

  res.json({
    // Devolve a chave que cada painel realmente usou, pra tela ficar em sincronia
    // mesmo se alguem mandar uma chave invalida na URL.
    ranges: Object.fromEntries(PAINEIS.map((p) => [p, periodos[p].range])),

    clients: { active: clients.active, inactive: clients.inactive },

    volume: {
      videosDetected: volume.videosDetected,
      clipsGenerated: volume.clipsGenerated,
      clipsPosted: volume.clipsPosted,
      aproveitamentoRate,
    },

    pipeline: {
      errorRate: pipeline.errorRate,
      totalFinished: pipeline.totalFinished,
      avgProcessingSeconds: pipeline.avgProcessingSeconds,
      avgQueueWaitSeconds: pipeline.avgQueueWaitSeconds,
      // Fila agora e um retrato do instante, nao tem periodo.
      queueDepth,
    },

    cost: {
      whisperCostUsd: cost.whisperCostUsd,
      claudeCostUsd: cost.claudeCostUsd,
      totalCostUsd: cost.totalCostUsd,
      avgCostPerVideo,
      videosWithCost: cost.videosWithCost,
      projectedMonthlyUsd,
    },

    ranking: ranking.map((r) => ({ name: r.business_name || r.email, videosCount: r.videos_count })),

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
  });
}

module.exports = { overview, PAINEIS };

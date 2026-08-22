'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');
const videoConcurrencyService = require('../../../services/videoConcurrencyService');

const BYTES_POR_GB = 1024 ** 3;

// Custo do download em dinheiro. Só existe quando a banda foi COMPRADA: pelo
// túnel do cliente ou pelo do fundador a banda já está paga na conta de
// internet, e cobrar de novo aqui inventaria um custo que não existe.
//
// 'reuse' é zero por definição: o arquivo já estava em disco.
function custoDoDownload(row, precoPorGb) {
  if (row.download_egress_type !== 'proxy') return 0;
  const bytes = Number(row.download_bytes || 0);
  return (bytes / BYTES_POR_GB) * precoPorGb;
}

function summarize(row) {
  return {
    id: row.id,
    title: row.title,
    clientName: row.client_business_name || row.client_email,
    channelName: row.channel_name,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Histórico ganha o custo e o tempo de cada vídeo. Fica separado do summarize
// porque só o histórico tem esses dados fechados - vídeo em andamento ainda
// não tem tempo total nem custo final.
function summarizeComCustos(row, precoPorGb) {
  const whisper = Number(row.whisper_cost_usd || 0);
  const claude = Number(row.claude_cost_usd || 0);
  const download = custoDoDownload(row, precoPorGb);

  return {
    ...summarize(row),
    clipsCount: row.clips_count,
    processingSeconds: row.processing_seconds !== null ? Math.round(Number(row.processing_seconds)) : null,
    custos: {
      downloadUsd: download,
      transcricaoUsd: whisper,
      selecaoUsd: claude,
      totalUsd: download + whisper + claude,
      downloadBytes: Number(row.download_bytes || 0),
      // De onde veio a banda: 'reuse' significa que outro vídeo já tinha
      // baixado, e por isso este não pagou nada.
      downloadOrigem: row.download_egress_type,
      // Marcados para a tela poder dizer POR QUE o custo é zero - sem isso um
      // custo zerado parece dado faltando.
      downloadReaproveitado: row.download_egress_type === 'reuse',
      transcricaoReaproveitada: row.transcript_reused === true,
    },
  };
}

async function overview(req, res) {
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [processing, waiting, history, stageTimings, precoPorGbSalvo, maxSimultaneos] = await Promise.all([
    sourceVideosRepository.listCurrentlyProcessing(),
    sourceVideosRepository.listWaiting(),
    sourceVideosRepository.listRecentHistory({ limit: 20 }),
    metricsRepository.stageTimingsSince(since30d),
    // Quanto custa 1 GB no proxy pago. Zero enquanto ninguem informar: melhor
    // mostrar custo de banda zerado do que inventar um preco.
    settingsRepository.getValue('custo_banda_por_gb_usd', 0),
    videoConcurrencyService.obter(),
  ]);
  const precoPorGb = Number(precoPorGbSalvo) || 0;

  res.json({
    processing: processing.map(summarize),
    // A tela mostra "2 de 3" - sem o teto, ver 1 video processando nao diz se
    // e porque so tem 1 na fila ou porque o limite esta em 1.
    maxSimultaneos,
    waiting: waiting.map(summarize),
    history: history.map((r) => summarizeComCustos(r, precoPorGb)),
    stageTimings,
  });
}

// Mesma regra do retry do cliente: so em video 'error'/'cancelled', e sempre
// apagando os cortes de uma tentativa anterior antes de reenfileirar - sem
// isso, chamar retry num video 'ready' recomecava o pipeline do zero e
// duplicava os cortes que ja estavam prontos.
async function retry(req, res) {
  const sourceVideo = await sourceVideosRepository.findById(Number(req.params.id));
  if (!sourceVideo) return res.status(404).json({ error: res.locals.t('erros.videoNaoEncontrado') });
  if (!['error', 'cancelled'].includes(sourceVideo.status)) {
    return res.status(400).json({ error: res.locals.t('erros.videoNaoComErro') });
  }

  await clipsRepository.deleteBySourceVideoId(sourceVideo.id);
  const updated = await sourceVideosRepository.resetForRetry(sourceVideo.id);
  if (!updated) return res.status(409).json({ error: res.locals.t('erros.naoReiniciouVideo') });

  const clientUserId = sourceVideo.youtube_channel_id
    ? (await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id)).client_user_id
    : sourceVideo.client_user_id;
  const priority = await queuePriorityService.resolveQueuePriorityForClient(clientUserId);
  const boss = await queueService.getBoss();
  await boss.send('video-processing', { sourceVideoId: sourceVideo.id }, { priority });

  res.status(204).end();
}

module.exports = { overview, retry };

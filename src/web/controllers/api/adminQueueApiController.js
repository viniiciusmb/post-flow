'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');

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

async function overview(req, res) {
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [processing, waiting, history, stageTimings] = await Promise.all([
    sourceVideosRepository.findCurrentlyProcessing(),
    sourceVideosRepository.listWaiting(),
    sourceVideosRepository.listRecentHistory({ limit: 20 }),
    metricsRepository.stageTimingsSince(since30d),
  ]);

  res.json({
    processing: processing ? summarize(processing) : null,
    waiting: waiting.map(summarize),
    history: history.map(summarize),
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

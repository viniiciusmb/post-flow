'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const queueService = require('../../../services/queueService');

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
  const [processing, waiting, history] = await Promise.all([
    sourceVideosRepository.findCurrentlyProcessing(),
    sourceVideosRepository.listWaiting(),
    sourceVideosRepository.listRecentHistory({ limit: 20 }),
  ]);

  res.json({
    processing: processing ? summarize(processing) : null,
    waiting: waiting.map(summarize),
    history: history.map(summarize),
  });
}

async function retry(req, res) {
  const sourceVideo = await sourceVideosRepository.findById(Number(req.params.id));
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });

  await sourceVideosRepository.updateStatus(sourceVideo.id, 'detected', { errorMessage: null });

  const boss = await queueService.getBoss();
  await boss.send('video-processing', { sourceVideoId: sourceVideo.id });

  res.status(204).end();
}

module.exports = { overview, retry };

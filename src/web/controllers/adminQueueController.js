'use strict';

const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const queueService = require('../../services/queueService');

async function show(req, res) {
  const [processing, waiting, history] = await Promise.all([
    sourceVideosRepository.findCurrentlyProcessing(),
    sourceVideosRepository.listWaiting(),
    sourceVideosRepository.listRecentHistory({ limit: 20 }),
  ]);

  res.render('admin/queue', { title: 'Fila de Processamento', processing, waiting, history });
}

async function retry(req, res) {
  const sourceVideo = await sourceVideosRepository.findById(Number(req.params.id));
  if (sourceVideo) {
    await sourceVideosRepository.updateStatus(sourceVideo.id, 'detected', { errorMessage: null });
    const boss = await queueService.getBoss();
    await boss.send('video-processing', { sourceVideoId: sourceVideo.id });
  }
  res.redirect('/admin/queue');
}

module.exports = { show, retry };

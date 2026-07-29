'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const ytDlpService = require('../../../services/ytDlpService');
const queueService = require('../../../services/queueService');
const metricsRepository = require('../../../repositories/metricsRepository');
const logger = require('../../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';
// Usado quando ainda nao ha historico suficiente de processamento pra
// calcular uma media real (video tipico: download + transcricao + IA + corte).
const DEFAULT_AVG_PROCESSING_SECONDS = 480;

async function list(req, res) {
  const channelId = req.query.channelId ? Number(req.query.channelId) : null;
  const since90d = new Date();
  since90d.setDate(since90d.getDate() - 90);

  const [videos, pipelineHealth] = await Promise.all([
    sourceVideosRepository.listForClient(req.session.user.id, { youtubeChannelId: channelId }),
    metricsRepository.pipelineHealthSince(since90d),
  ]);

  res.json({
    avgProcessingSeconds: pipelineHealth.avgProcessingSeconds || DEFAULT_AVG_PROCESSING_SECONDS,
    videos: videos.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnailUrl: v.thumbnail_url,
      channelName: v.channel_name,
      publishedAt: v.published_at,
      durationSeconds: v.duration_seconds,
      status: v.status,
      errorMessage: v.error_message,
      clipCount: v.clip_count,
      processingStartedAt: v.processing_started_at,
    })),
  });
}

async function listClips(req, res) {
  const sourceVideo = await sourceVideosRepository.findById(Number(req.params.id));
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });

  const clips = await clipsRepository.listBySourceVideoId(sourceVideo.id);
  res.json({
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      startSeconds: Number(c.start_seconds),
      endSeconds: Number(c.end_seconds),
      status: c.status,
      errorMessage: c.error_message,
    })),
  });
}

// Cliente cola o link de um video avulso do YouTube - sem depender de ter um
// canal cadastrado. Busca os metadados na hora (rapido, nao baixa o video) e
// ja manda pra fila de processamento, igual a um video vindo de canal.
async function createManual(req, res) {
  const url = String(req.body.url || '').trim();
  const videoId = ytDlpService.extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'Link do YouTube invalido. Cole a URL completa do video.' });
  }

  const existing = await sourceVideosRepository.findByYoutubeVideoId(videoId);
  if (existing) {
    return res.status(409).json({ error: 'Esse video ja foi adicionado antes.' });
  }

  let metadata;
  try {
    metadata = await ytDlpService.getVideoMetadata(`https://www.youtube.com/watch?v=${videoId}`);
  } catch (err) {
    logger.error(`Falha ao adicionar video manual (${videoId}) pro cliente ${req.session.user.id}:`, err);
    return res.status(502).json({ error: `Nao foi possivel ler os dados desse video: ${err.message}` });
  }

  const sourceVideo = await sourceVideosRepository.createManual({
    clientUserId: req.session.user.id,
    youtubeVideoId: metadata.videoId,
    title: metadata.title,
    thumbnailUrl: metadata.thumbnailUrl,
    publishedAt: metadata.publishedAt,
    durationSeconds: metadata.durationSeconds,
  });
  if (!sourceVideo) {
    return res.status(409).json({ error: 'Esse video ja foi adicionado antes.' });
  }

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id });

  res.status(201).json({ id: sourceVideo.id, title: sourceVideo.title, status: sourceVideo.status });
}

// Reinicia um video que ficou em erro - ex: video que falhou por causa do
// bloqueio de bot do YouTube, ja resolvido.
async function retry(req, res) {
  const id = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });
  if (sourceVideo.status !== 'error') {
    return res.status(400).json({ error: 'Esse video nao esta com erro no momento.' });
  }

  await clipsRepository.deleteBySourceVideoId(id);
  const updated = await sourceVideosRepository.resetForRetry(id);
  if (!updated) return res.status(409).json({ error: 'Nao foi possivel reiniciar esse video agora, tente de novo.' });

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id });

  res.json({ id: updated.id, status: updated.status });
}

module.exports = { list, listClips, createManual, retry };

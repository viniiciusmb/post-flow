'use strict';

const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const ytDlpService = require('../../../services/ytDlpService');
const queueService = require('../../../services/queueService');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function list(req, res) {
  const channelId = req.query.channelId ? Number(req.query.channelId) : null;
  const videos = await sourceVideosRepository.listForClient(req.session.user.id, { youtubeChannelId: channelId });
  res.json({
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

module.exports = { list, listClips, createManual };

'use strict';

const fs = require('fs');
const path = require('path');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const googleService = require('../../../services/googleService');
const ytDlpService = require('../../../services/ytDlpService');
const videoEditingService = require('../../../services/videoEditingService');
const queueService = require('../../../services/queueService');
const metricsRepository = require('../../../repositories/metricsRepository');
const config = require('../../../config');
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
      channelId: v.youtube_channel_id,
      channelName: v.channel_name,
      publishedAt: v.published_at,
      durationSeconds: v.duration_seconds,
      status: v.status,
      errorMessage: v.error_message,
      clipCount: v.clip_count,
      readyClipCount: v.ready_clip_count,
      processingStartedAt: v.processing_started_at,
    })),
  });
}

async function listClips(req, res) {
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });

  const clips = await clipsRepository.listBySourceVideoId(sourceVideo.id);
  res.json({
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      startSeconds: Number(c.start_seconds),
      endSeconds: Number(c.end_seconds),
      status: c.status,
      errorMessage: c.error_message,
      renderProgressPercent: c.render_progress_percent,
      thumbnailUrl: c.thumbnail_path ? `/api/client/source-videos/clips/${c.id}/thumbnail` : null,
      exportedToDrive: Boolean(c.exported_to_drive_at),
    })),
  });
}

// Serve o arquivo do corte pronto pra preview (<video>) ou download - o
// mesmo endpoint funciona pros dois casos, o navegador decide com base em
// como foi chamado (tag <video> vs clique num link "baixar").
async function downloadClip(req, res) {
  const clip = await clipsRepository.findByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!clip || clip.status !== 'ready' || !clip.local_clip_path) {
    return res.status(404).json({ error: 'Corte nao encontrado ou ainda nao esta pronto.' });
  }
  if (!fs.existsSync(clip.local_clip_path)) {
    return res.status(410).json({
      error: 'O arquivo desse corte nao esta mais no servidor (isso acontece se o servico foi reiniciado antes do download).',
    });
  }

  const filename = `${clip.title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim() || 'corte'}.mp4`;
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(clip.local_clip_path);
}

// Capa do corte (frame extraido na hora que o corte terminou de renderizar).
async function clipThumbnail(req, res) {
  const clip = await clipsRepository.findByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!clip || !clip.thumbnail_path || !fs.existsSync(clip.thumbnail_path)) {
    return res.status(404).json({ error: 'Capa nao encontrada.' });
  }
  res.sendFile(clip.thumbnail_path);
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

// Cliente envia o arquivo de video direto do computador/celular - sem passar
// pelo YouTube. O arquivo ja fica salvo em disco pelo multer (ver rotas);
// aqui so confere a duracao e entra na mesma fila de processamento.
async function uploadVideo(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  let durationSeconds;
  try {
    durationSeconds = Math.round(await videoEditingService.probeDuration(req.file.path));
  } catch {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Nao foi possivel ler esse arquivo de video.' });
  }

  const title = String(req.body.title || '').trim() || path.parse(req.file.originalname).name;

  const sourceVideo = await sourceVideosRepository.createUpload({
    clientUserId: req.session.user.id,
    title,
    localVideoPath: req.file.path,
    durationSeconds,
  });

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
  if (!['error', 'cancelled'].includes(sourceVideo.status)) {
    return res.status(400).json({ error: 'Esse video nao esta com erro nem cancelado no momento.' });
  }

  await clipsRepository.deleteBySourceVideoId(id);
  const updated = await sourceVideosRepository.resetForRetry(id);
  if (!updated) return res.status(409).json({ error: 'Nao foi possivel reiniciar esse video agora, tente de novo.' });

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id });

  res.json({ id: updated.id, status: updated.status });
}

// Pausa cooperativa - so vale enquanto o video esta mesmo em andamento (o
// repository ja filtra por status, aqui so trata "nao rolou"). O progresso
// (download, transcricao, cortes ja prontos) fica preservado pra retomar.
async function pause(req, res) {
  const id = Number(req.params.id);
  const updated = await sourceVideosRepository.requestPauseByIdOwnedByClient(id, req.session.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'Esse video nao esta em processamento no momento (ou nao existe).' });
  }
  res.json({ id: updated.id, pauseRequested: true });
}

// Retoma um video pausado de onde parou - nao refaz download/transcricao/
// cortes ja prontos (ver processVideoJob.js).
async function resume(req, res) {
  const id = Number(req.params.id);
  const updated = await sourceVideosRepository.resumeByIdOwnedByClient(id, req.session.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'Esse video nao esta pausado no momento (ou nao existe).' });
  }

  const boss = await queueService.getBoss();
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id });

  res.json({ id: updated.id, status: updated.status });
}

// Remove o video e os cortes gerados a partir dele, inclusive os arquivos em
// disco (best-effort - se o arquivo ja nao existir mais, so ignora).
async function remove(req, res) {
  const id = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Video nao encontrado.' });

  const clips = await clipsRepository.listBySourceVideoId(id);
  const filesToRemove = [
    sourceVideo.local_video_path,
    ...clips.flatMap((c) => [c.local_clip_path, c.thumbnail_path]),
  ].filter(Boolean);

  const deleted = await sourceVideosRepository.deleteByIdOwnedByClient(id, req.session.user.id);
  if (!deleted) return res.status(404).json({ error: 'Video nao encontrado.' });

  for (const filePath of filesToRemove) {
    fs.rm(filePath, { force: true }, () => {});
  }
  fs.rm(path.join(config.videoProcessing.workDir, String(id)), { recursive: true, force: true }, () => {});

  res.status(204).end();
}

// Upload manual de um corte especifico pra pasta de destino ja configurada
// no canal (ver youtubeChannelsApiController.setExportFolder). So funciona
// pra corte vindo de canal (videos manuais/upload nao tem pasta associada).
async function exportClipToDrive(req, res) {
  const clip = await clipsRepository.findByIdWithChannelOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!clip || clip.status !== 'ready' || !clip.local_clip_path) {
    return res.status(404).json({ error: 'Corte nao encontrado ou ainda nao esta pronto.' });
  }
  if (!clip.youtube_channel_id) {
    return res.status(400).json({ error: 'Esse corte nao veio de um canal do YouTube, entao nao tem pasta de destino.' });
  }
  if (!fs.existsSync(clip.local_clip_path)) {
    return res.status(410).json({ error: 'O arquivo desse corte nao esta mais no servidor.' });
  }

  const folder = await driveFoldersRepository.findExportFolderByChannelId(clip.youtube_channel_id);
  if (!folder) {
    return res.status(400).json({ error: 'Configure uma pasta de destino pra esse canal primeiro (na tela Canais do YouTube).' });
  }

  let accessToken;
  try {
    const connection = await driveConnectionsRepository.findById(folder.connection_id);
    accessToken = await driveConnectionsRepository.getValidAccessToken(googleService, connection);
  } catch (err) {
    logger.error(`Falha ao renovar token do Google Drive pro corte ${clip.id}:`, err);
    accessToken = null;
  }
  if (!accessToken) {
    return res.status(400).json({ error: 'A conexao com o Google Drive nao esta mais valida - reconecte em Configurações.' });
  }

  const filename = `${(clip.title || 'corte').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()}.mp4`;
  try {
    await googleService.uploadFile(accessToken, folder.drive_folder_id, clip.local_clip_path, filename, 'video/mp4');
  } catch (err) {
    logger.error(`Falha ao enviar o corte ${clip.id} pro Drive manualmente:`, err);
    return res.status(502).json({ error: `Falha ao enviar pro Drive: ${err.message}` });
  }
  await clipsRepository.markExportedToDrive(clip.id);

  res.json({ id: clip.id, exported: true });
}

module.exports = {
  list,
  listClips,
  downloadClip,
  clipThumbnail,
  createManual,
  uploadVideo,
  retry,
  pause,
  resume,
  remove,
  exportClipToDrive,
};

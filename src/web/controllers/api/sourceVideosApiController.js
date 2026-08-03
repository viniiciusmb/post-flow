'use strict';

const fs = require('fs');
const path = require('path');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const sourceVideoTiktokTargetsRepository = require('../../../repositories/sourceVideoTiktokTargetsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const googleService = require('../../../services/googleService');
const ytDlpService = require('../../../services/ytDlpService');
const videoEditingService = require('../../../services/videoEditingService');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');
const metricsRepository = require('../../../repositories/metricsRepository');
const config = require('../../../config');
const logger = require('../../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';
// Usado quando ainda nao ha historico suficiente de processamento pra
// calcular uma media real (video tipico: download + transcricao + IA + corte).
const DEFAULT_AVG_PROCESSING_SECONDS = 480;

// Video avulso (upload/link colado) nao tem canal pra herdar a conta TikTok
// de destino - o cliente escolhe na hora do envio. Com 0 contas, segue sem
// nenhuma (corte fica pronto mas nao vira postagem); com 1, usa ela direto;
// com 2+, exige que pelo menos uma tenha sido marcada.
async function resolveTiktokAccountIds(req) {
  const accounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  if (accounts.length === 0) return { tiktokAccountIds: [] };
  if (accounts.length === 1) return { tiktokAccountIds: [accounts[0].id] };

  const raw = req.body.tiktokAccountIds;
  const requested = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? JSON.parse(raw)
      : [];
  const ids = requested.map(Number).filter((n) => Number.isInteger(n));
  // tiktok_accounts.id e BIGINT - o driver pg devolve como string, entao
  // compara convertendo os dois lados pra numero.
  const validIds = accounts.filter((a) => ids.includes(Number(a.id))).map((a) => a.id);

  if (validIds.length === 0) {
    return { error: 'Escolha pelo menos uma conta TikTok pra receber esse vídeo.' };
  }
  return { tiktokAccountIds: validIds };
}

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
      billingBlockReason: v.billing_block_reason,
      clipCount: v.clip_count,
      readyClipCount: v.ready_clip_count,
      processingStartedAt: v.processing_started_at,
      tiktokAccountNames: v.tiktok_account_names || [],
    })),
  });
}

async function listClips(req, res) {
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Vídeo não encontrado.' });

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
    return res.status(404).json({ error: 'Corte não encontrado ou ainda não está pronto.' });
  }
  if (!fs.existsSync(clip.local_clip_path)) {
    return res.status(410).json({
      error: 'O arquivo desse corte não está mais no servidor (isso acontece se o serviço foi reiniciado antes do download).',
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
    return res.status(404).json({ error: 'Capa não encontrada.' });
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
    return res.status(400).json({ error: 'Link do YouTube inválido. Cole a URL completa do vídeo.' });
  }

  // Video ja existe (pra este MESMO cliente - a unicidade e por dono, ver
  // migration 042, entao clientes diferentes nunca se bloqueiam aqui) -
  // antes so bloqueava com "ja foi adicionado", o que impedia o cliente de
  // reenviar um video que ele mesmo ja tinha tentado (ex: deu erro antes) so
  // porque a linha ja existia. Agora: se estiver com erro/cancelado,
  // reenfileira igual um retry; senao (ja em andamento ou pronto), so
  // informa o status atual em vez de um erro generico.
  const existing = await sourceVideosRepository.findByYoutubeVideoIdForOwner(videoId, req.session.user.id);
  if (existing) {
    if (['error', 'cancelled'].includes(existing.status)) {
      await clipsRepository.deleteBySourceVideoId(existing.id);
      const updated = await sourceVideosRepository.resetForRetry(existing.id);
      const boss = await queueService.getBoss();
      const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
      await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: existing.id }, { priority });
      return res.status(200).json({
        id: existing.id,
        title: existing.title,
        status: updated.status,
        message: `"${existing.title}" ja estava no sistema (com erro) - recolocamos na fila.`,
      });
    }

    return res.status(200).json({
      id: existing.id,
      title: existing.title,
      status: existing.status,
      message: `"${existing.title}" ja esta no sistema (status: ${existing.status}).`,
    });
  }

  const targets = await resolveTiktokAccountIds(req);
  if (targets.error) return res.status(400).json({ error: targets.error });

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
    return res.status(409).json({ error: 'Esse vídeo já foi adicionado antes.' });
  }

  if (targets.tiktokAccountIds.length > 0) {
    await sourceVideoTiktokTargetsRepository.setTargets(sourceVideo.id, targets.tiktokAccountIds);
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });

  res.status(201).json({ id: sourceVideo.id, title: sourceVideo.title, status: sourceVideo.status });
}

// Cliente envia o arquivo de video direto do computador/celular - sem passar
// pelo YouTube. O arquivo ja fica salvo em disco pelo multer (ver rotas);
// aqui so confere a duracao e entra na mesma fila de processamento.
async function uploadVideo(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const targets = await resolveTiktokAccountIds(req);
  if (targets.error) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: targets.error });
  }

  let durationSeconds;
  try {
    durationSeconds = Math.round(await videoEditingService.probeDuration(req.file.path));
  } catch {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Não foi possível ler esse arquivo de vídeo.' });
  }

  const title = String(req.body.title || '').trim() || path.parse(req.file.originalname).name;

  const sourceVideo = await sourceVideosRepository.createUpload({
    clientUserId: req.session.user.id,
    title,
    localVideoPath: req.file.path,
    durationSeconds,
  });

  if (targets.tiktokAccountIds.length > 0) {
    await sourceVideoTiktokTargetsRepository.setTargets(sourceVideo.id, targets.tiktokAccountIds);
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });

  res.status(201).json({ id: sourceVideo.id, title: sourceVideo.title, status: sourceVideo.status });
}

// Reinicia um video que ficou em erro - ex: video que falhou por causa do
// bloqueio de bot do YouTube, ja resolvido.
// Coloca de volta na fila um video que ficou parado em "detectado".
//
// Isso acontece quando o job se perde entre a deteccao e o processamento: o
// worker reinicia (deploy, por exemplo) na janela em que o job ja saiu da fila
// mas ainda nao comecou. O videoErrorRetryJob resgata sozinho depois de 30
// minutos, mas ate la o video fica parado na tela sem nada que o cliente possa
// fazer - e foi exatamente isso que aconteceu na producao.
//
// Nao mexe em nada que ja foi feito: so reenfileira. Se o video ja tiver
// download ou transcricao guardados, o pipeline continua de onde parou.
async function enqueue(req, res) {
  const id = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Vídeo não encontrado.' });
  if (!['detected', 'paused'].includes(sourceVideo.status)) {
    return res.status(400).json({ error: 'Esse vídeo não está esperando na fila.' });
  }

  // Um video pausado precisa da flag limpa, senao o worker para de novo no
  // primeiro checkpoint.
  if (sourceVideo.status === 'paused') {
    await sourceVideosRepository.resumeByIdOwnedByClient(id, req.session.user.id);
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id }, { priority });

  res.json({ id, status: 'detected' });
}

async function retry(req, res) {
  const id = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Vídeo não encontrado.' });
  if (!['error', 'cancelled'].includes(sourceVideo.status)) {
    return res.status(400).json({ error: 'Esse vídeo não está com erro nem cancelado no momento.' });
  }

  await clipsRepository.deleteBySourceVideoId(id);
  const updated = await sourceVideosRepository.resetForRetry(id);
  if (!updated) return res.status(409).json({ error: 'Não foi possível reiniciar esse vídeo agora, tente de novo.' });

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id }, { priority });

  res.json({ id: updated.id, status: updated.status });
}

// Pausa cooperativa - so vale enquanto o video esta mesmo em andamento (o
// repository ja filtra por status, aqui so trata "nao rolou"). O progresso
// (download, transcricao, cortes ja prontos) fica preservado pra retomar.
async function pause(req, res) {
  const id = Number(req.params.id);
  const updated = await sourceVideosRepository.requestPauseByIdOwnedByClient(id, req.session.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'Esse vídeo não está em processamento no momento (ou não existe).' });
  }
  res.json({ id: updated.id, pauseRequested: true });
}

// Retoma um video pausado de onde parou - nao refaz download/transcricao/
// cortes ja prontos (ver processVideoJob.js).
async function resume(req, res) {
  const id = Number(req.params.id);
  const updated = await sourceVideosRepository.resumeByIdOwnedByClient(id, req.session.user.id);
  if (!updated) {
    return res.status(400).json({ error: 'Esse vídeo não está pausado no momento (ou não existe).' });
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id }, { priority });

  res.json({ id: updated.id, status: updated.status });
}

// Remove o video e os cortes gerados a partir dele, inclusive os arquivos em
// disco (best-effort - se o arquivo ja nao existir mais, so ignora).
async function remove(req, res) {
  const id = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Vídeo não encontrado.' });

  const clips = await clipsRepository.listBySourceVideoId(id);
  const filesToRemove = [
    sourceVideo.local_video_path,
    ...clips.flatMap((c) => [c.local_clip_path, c.thumbnail_path]),
  ].filter(Boolean);

  const deleted = await sourceVideosRepository.deleteByIdOwnedByClient(id, req.session.user.id);
  if (!deleted) return res.status(404).json({ error: 'Vídeo não encontrado.' });

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
    return res.status(404).json({ error: 'Corte não encontrado ou ainda não está pronto.' });
  }
  if (!clip.youtube_channel_id) {
    return res.status(400).json({ error: 'Esse corte não veio de um canal do YouTube, então não tem pasta de destino.' });
  }
  if (!fs.existsSync(clip.local_clip_path)) {
    return res.status(410).json({ error: 'O arquivo desse corte não está mais no servidor.' });
  }

  const folder = await driveFoldersRepository.findExportFolderByChannelId(clip.youtube_channel_id);
  if (!folder) {
    return res.status(400).json({ error: 'Configure uma pasta de destino pra esse canal primeiro (na tela Canais).' });
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
    return res.status(400).json({ error: 'A conexão com o Google Drive não está mais válida. Reconecte em Configurações.' });
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

// Envia TODOS os cortes prontos (e ainda nao enviados) desse video-fonte pra
// pasta de destino do canal, de uma vez - pro cliente que nao quer clicar
// corte a corte. Continua o video inteiro mesmo se um corte especifico
// falhar (arquivo sumiu, Drive fora do ar etc) - devolve quantos foram e
// quantos falharam, sem um erro derrubar os outros.
async function exportAllClipsToDrive(req, res) {
  const sourceVideoId = Number(req.params.id);
  const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(sourceVideoId, req.session.user.id);
  if (!sourceVideo) return res.status(404).json({ error: 'Vídeo não encontrado.' });
  if (!sourceVideo.youtube_channel_id) {
    return res.status(400).json({ error: 'Esse vídeo não veio de um canal do YouTube, então não tem pasta de destino.' });
  }

  const folder = await driveFoldersRepository.findExportFolderByChannelId(sourceVideo.youtube_channel_id);
  if (!folder) {
    return res.status(400).json({ error: 'Configure uma pasta de destino pra esse canal primeiro (na tela Canais).' });
  }

  let accessToken;
  try {
    const connection = await driveConnectionsRepository.findById(folder.connection_id);
    accessToken = await driveConnectionsRepository.getValidAccessToken(googleService, connection);
  } catch (err) {
    logger.error(`Falha ao renovar token do Google Drive pro video ${sourceVideoId}:`, err);
    accessToken = null;
  }
  if (!accessToken) {
    return res.status(400).json({ error: 'A conexão com o Google Drive não está mais válida. Reconecte em Configurações.' });
  }

  const clips = await clipsRepository.listBySourceVideoId(sourceVideoId);
  const pending = clips.filter((c) => c.status === 'ready' && c.local_clip_path && !c.exported_to_drive_at);

  let exported = 0;
  let failed = 0;
  for (const clip of pending) {
    if (!fs.existsSync(clip.local_clip_path)) {
      failed += 1;
      continue;
    }
    const filename = `${(clip.title || 'corte').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()}.mp4`;
    try {
      await googleService.uploadFile(accessToken, folder.drive_folder_id, clip.local_clip_path, filename, 'video/mp4');
      await clipsRepository.markExportedToDrive(clip.id);
      exported += 1;
    } catch (err) {
      logger.error(`Falha ao exportar o corte ${clip.id} pro Drive (envio em lote):`, err);
      failed += 1;
    }
  }

  res.json({ exported, failed, total: pending.length });
}

// Exclusao em lote (tela "Vídeos & Cortes", selecionar varios de uma vez) -
// mesma logica do remove() de um so, so que em loop. Ids que nao existem ou
// nao pertencem ao cliente sao ignorados silenciosamente (deleteByIdOwnedByClient
// ja filtra por dono).
async function bulkRemove(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n)) : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'Nenhum vídeo selecionado.' });
  }

  let deletedCount = 0;
  for (const id of ids) {
    const sourceVideo = await sourceVideosRepository.findByIdOwnedByClient(id, req.session.user.id);
    if (!sourceVideo) continue;

    const clips = await clipsRepository.listBySourceVideoId(id);
    const filesToRemove = [
      sourceVideo.local_video_path,
      ...clips.flatMap((c) => [c.local_clip_path, c.thumbnail_path]),
    ].filter(Boolean);

    const deleted = await sourceVideosRepository.deleteByIdOwnedByClient(id, req.session.user.id);
    if (!deleted) continue;
    deletedCount += 1;

    for (const filePath of filesToRemove) {
      fs.rm(filePath, { force: true }, () => {});
    }
    fs.rm(path.join(config.videoProcessing.workDir, String(id)), { recursive: true, force: true }, () => {});
  }

  res.json({ deletedCount });
}

module.exports = {
  enqueue,
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
  bulkRemove,
  exportClipToDrive,
  exportAllClipsToDrive,
};

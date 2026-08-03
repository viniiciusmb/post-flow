'use strict';

const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const youtubeChannelService = require('../../../services/youtubeChannelService');
const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const planLimitsService = require('../../../services/planLimitsService');
const ytDlpService = require('../../../services/ytDlpService');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');
const logger = require('../../../lib/logger');
const { extractDriveFolderId } = require('../../../lib/driveFolderId');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function list(req, res) {
  const [channels, tiktokAccounts] = await Promise.all([
    youtubeChannelsRepository.listByClientId(req.session.user.id),
    tiktokAccountsRepository.listActiveByClientId(req.session.user.id),
  ]);
  const exportFolders = await driveFoldersRepository.findExportFoldersByChannelIds(channels.map((c) => c.id));
  const exportFolderByChannel = new Map(exportFolders.map((f) => [f.youtube_channel_id, f]));
  const tiktokAccountById = new Map(tiktokAccounts.map((a) => [a.id, a]));

  res.json({
    channels: channels.map((c) => {
      const exportFolder = exportFolderByChannel.get(c.id);
      const tiktokAccount = c.tiktok_account_id ? tiktokAccountById.get(c.tiktok_account_id) : null;
      return {
        id: c.id,
        channelName: c.channel_name,
        channelUrl: c.channel_url,
        avatarUrl: c.avatar_url,
        isActive: c.is_active,
        lastPolledAt: c.last_polled_at,
        lastCheckAt: c.last_check_at,
        lastCheckOk: c.last_check_ok,
        lastCheckError: c.last_check_error,
        checkFailCount: c.check_fail_count,
        exportFolder: exportFolder ? { id: exportFolder.drive_folder_id, name: exportFolder.folder_name } : null,
        driveExportMode: c.drive_export_mode,
        tiktokAccountId: c.tiktok_account_id,
        tiktokAccountName: tiktokAccount ? tiktokAccount.display_name || tiktokAccount.tiktok_open_id : null,
      };
    }),
  });
}

async function create(req, res) {
  const { channelUrl } = req.body;
  if (!channelUrl) {
    return res.status(400).json({ error: 'Informe o link ou @handle do canal.' });
  }

  const currentCount = await youtubeChannelsRepository.countByClientId(req.session.user.id);
  const limitCheck = await planLimitsService.checkChannelLimit(req.session.user.id, currentCount);
  if (!limitCheck.allowed) {
    return res.status(403).json({ error: limitCheck.reason });
  }

  let resolved;
  try {
    resolved = await youtubeChannelService.resolveChannel(channelUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let channel = await youtubeChannelsRepository.create({
    clientUserId: req.session.user.id,
    youtubeChannelId: resolved.channelId,
    channelName: resolved.channelName,
    channelUrl: resolved.channelUrl,
    avatarUrl: resolved.avatarUrl,
  });

  if (!channel) {
    return res.status(409).json({ error: 'Esse canal já está cadastrado.' });
  }

  // Cliente com uma unica conta TikTok: ja vincula sozinho (sem isso ele
  // teria que ir na tela Cortes so pra escolher a unica opcao possivel).
  const tiktokAccounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  if (tiktokAccounts.length === 1) {
    channel = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, tiktokAccounts[0].id);
  }

  // Melhor esforco: busca so o video mais recente do canal (sem baixar,
  // rapido) pra oferecer "quer processar esse ja?" na hora - se falhar (canal
  // sem video, yt-dlp indisponivel etc), nao atrapalha o cadastro do canal
  // em si, so fica sem essa sugestao.
  let latestVideo = null;
  try {
    const [video] = await ytDlpService.listChannelVideos(resolved.channelUrl, { limit: 1 });
    if (video) {
      latestVideo = {
        videoId: video.videoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds,
        publishedAt: video.publishedAt,
      };
    }
  } catch (err) {
    logger.error(`Falha ao buscar o video mais recente do canal recem-cadastrado ${channel.id}:`, err);
  }

  res.status(201).json({
    channel: {
      id: channel.id,
      channelName: channel.channel_name,
      channelUrl: channel.channel_url,
      avatarUrl: channel.avatar_url,
      isActive: channel.is_active,
      lastPolledAt: channel.last_polled_at,
      lastCheckAt: channel.last_check_at,
      lastCheckOk: channel.last_check_ok,
      lastCheckError: channel.last_check_error,
      checkFailCount: channel.check_fail_count ?? 0,
      exportFolder: null,
      driveExportMode: channel.drive_export_mode,
      tiktokAccountId: channel.tiktok_account_id,
      tiktokAccountName: tiktokAccounts.length === 1 ? tiktokAccounts[0].display_name || tiktokAccounts[0].tiktok_open_id : null,
    },
    latestVideo,
  });
}

// Cliente aceitou o popup "quer processar o video mais recente agora?" -
// busca o video de novo (nao confia em metadado vindo do cliente) e entra
// na fila igual um video de canal normal (mesma funcao createIfNotExists
// que o channelCheckJob usa) - nao mexe no watermark (last_video_id), que
// so e definido pela primeira checagem periodica do canal.
async function processLatestVideo(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  let video;
  try {
    [video] = await ytDlpService.listChannelVideos(channel.channel_url, { limit: 1 });
  } catch (err) {
    logger.error(`Falha ao buscar o video mais recente do canal ${channel.id} pra processar agora:`, err);
    return res.status(502).json({ error: `Nao foi possivel ler os dados do canal: ${err.message}` });
  }
  if (!video) {
    return res.status(404).json({ error: 'Esse canal não tem nenhum vídeo.' });
  }

  const sourceVideo = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: channel.id,
    ownerClientUserId: req.session.user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });
  if (!sourceVideo) {
    return res.status(409).json({ error: 'Você já processou esse vídeo antes.' });
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });

  res.status(201).json({ id: sourceVideo.id, title: sourceVideo.title, status: sourceVideo.status });
}

async function setTiktokAccount(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  const rawId = req.body.tiktokAccountId;
  if (rawId === null || rawId === undefined || rawId === '') {
    const updated = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, null);
    return res.json({ tiktokAccountId: updated.tiktok_account_id });
  }

  const tiktokAccountId = Number(rawId);
  const account = await tiktokAccountsRepository.findActiveByIdAndClient(tiktokAccountId, req.session.user.id);
  if (!account) {
    return res.status(400).json({ error: 'Conta TikTok inválida.' });
  }

  const updated = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, account.id);
  res.json({ tiktokAccountId: updated.tiktok_account_id, tiktokAccountName: account.display_name || account.tiktok_open_id });
}

async function setActive(req, res) {
  const channel = await youtubeChannelsRepository.setActive(
    Number(req.params.id),
    req.session.user.id,
    req.body.isActive === true
  );
  if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
  res.json({ channel: { id: channel.id, isActive: channel.is_active } });
}

async function remove(req, res) {
  await youtubeChannelsRepository.remove(Number(req.params.id), req.session.user.id);
  res.status(204).end();
}

// Pasta de destino no Drive - pra onde os cortes gerados a partir desse
// canal sao enviados automaticamente (copia de seguranca). Precisa da
// conexao Google do proprio cliente ja existente (ver clientDriveApiController).
async function setExportFolder(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: 'Canal não encontrado.' });
  }

  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  if (!driveFolderId) {
    return res.status(400).json({ error: 'Cole o link ou ID da pasta do Drive.' });
  }

  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.status(400).json({ error: 'Conecte o Google Drive primeiro, em Configurações.' });
  }

  const folder = await driveFoldersRepository.upsertChannelExportFolder({
    youtubeChannelId: channel.id,
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });

  // Ao cadastrar a pasta, o cliente ja pode marcar "salvar automaticamente"
  // de uma vez (checkbox no mesmo formulario) - sem isso o modo continua
  // 'manual' (padrao) e o cliente escolhe corte a corte.
  const updatedChannel =
    req.body.autoMode === true
      ? await youtubeChannelsRepository.setDriveExportMode(channel.id, req.session.user.id, 'auto')
      : channel;

  res.json({
    exportFolder: { id: folder.drive_folder_id, name: folder.folder_name },
    driveExportMode: updatedChannel.drive_export_mode,
  });
}

// Liga/desliga o envio automatico sem mexer na pasta ja configurada.
async function setDriveExportMode(req, res) {
  const mode = req.body.mode === 'auto' ? 'auto' : 'manual';
  const channel = await youtubeChannelsRepository.setDriveExportMode(Number(req.params.id), req.session.user.id, mode);
  if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
  res.json({ driveExportMode: channel.drive_export_mode });
}

module.exports = {
  list,
  create,
  setActive,
  remove,
  setExportFolder,
  setDriveExportMode,
  setTiktokAccount,
  processLatestVideo,
};

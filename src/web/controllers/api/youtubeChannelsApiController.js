'use strict';

const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const youtubeChannelService = require('../../../services/youtubeChannelService');
const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const { extractDriveFolderId } = require('../../../lib/driveFolderId');

async function list(req, res) {
  const channels = await youtubeChannelsRepository.listByClientId(req.session.user.id);
  const exportFolders = await driveFoldersRepository.findExportFoldersByChannelIds(channels.map((c) => c.id));
  const exportFolderByChannel = new Map(exportFolders.map((f) => [f.youtube_channel_id, f]));

  res.json({
    channels: channels.map((c) => {
      const exportFolder = exportFolderByChannel.get(c.id);
      return {
        id: c.id,
        channelName: c.channel_name,
        channelUrl: c.channel_url,
        avatarUrl: c.avatar_url,
        isActive: c.is_active,
        lastPolledAt: c.last_polled_at,
        exportFolder: exportFolder ? { id: exportFolder.drive_folder_id, name: exportFolder.folder_name } : null,
      };
    }),
  });
}

async function create(req, res) {
  const { channelUrl } = req.body;
  if (!channelUrl) {
    return res.status(400).json({ error: 'Informe o link ou @handle do canal.' });
  }

  let resolved;
  try {
    resolved = await youtubeChannelService.resolveChannel(channelUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const channel = await youtubeChannelsRepository.create({
    clientUserId: req.session.user.id,
    youtubeChannelId: resolved.channelId,
    channelName: resolved.channelName,
    channelUrl: resolved.channelUrl,
    avatarUrl: resolved.avatarUrl,
  });

  if (!channel) {
    return res.status(409).json({ error: 'Esse canal ja esta cadastrado.' });
  }

  res.status(201).json({
    channel: {
      id: channel.id,
      channelName: channel.channel_name,
      channelUrl: channel.channel_url,
      avatarUrl: channel.avatar_url,
      isActive: channel.is_active,
      lastPolledAt: channel.last_polled_at,
      exportFolder: null,
    },
  });
}

async function setActive(req, res) {
  const channel = await youtubeChannelsRepository.setActive(
    Number(req.params.id),
    req.session.user.id,
    req.body.isActive === true
  );
  if (!channel) return res.status(404).json({ error: 'Canal nao encontrado.' });
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
    return res.status(404).json({ error: 'Canal nao encontrado.' });
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
  res.json({ exportFolder: { id: folder.drive_folder_id, name: folder.folder_name } });
}

module.exports = { list, create, setActive, remove, setExportFolder };

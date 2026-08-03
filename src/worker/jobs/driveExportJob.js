// Envia cortes prontos pra pasta de destino que o cliente configurou no
// proprio Google Drive (copia de seguranca fora do Post Flow) - reaproveita
// a mesma conexao OAuth que ja existe pra ler pastas de origem. Roda a cada
// ~15 min (ver videoScheduler.js).
'use strict';

const fs = require('fs');
const driveFoldersRepository = require('../../repositories/driveFoldersRepository');
const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const googleService = require('../../services/googleService');
const errorReportService = require('../../services/errorReportService');
const logger = require('../../lib/logger');

async function run() {
  const exportFolders = await driveFoldersRepository.listExportFolders();
  for (const folder of exportFolders) {
    try {
      await exportForChannel(folder);
    } catch (err) {
      logger.error(`Falha na exportacao pro Drive do canal ${folder.youtube_channel_id}:`, err);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.DRIVE_EXPORT,
        entityType: 'youtube_channel',
        entityId: folder.youtube_channel_id,
        error: err,
      });
    }
  }
}

// Modo 'manual' (padrao) - o cliente escolhe corte a corte em Videos &
// Cortes, esse job so cuida dos canais em modo 'auto'.
async function exportForChannel(folder) {
  if (!folder.connection_id) return;
  const channel = await youtubeChannelsRepository.findById(folder.youtube_channel_id);
  if (!channel || channel.drive_export_mode !== 'auto') return;
  const connection = await driveConnectionsRepository.findById(folder.connection_id);
  const accessToken = await driveConnectionsRepository.getValidAccessToken(googleService, connection);
  if (!accessToken) return;

  const clips = await clipsRepository.listReadyNotExportedByChannelId(folder.youtube_channel_id);
  for (const clip of clips) {
    if (!clip.local_clip_path || !fs.existsSync(clip.local_clip_path)) continue;

    const filename = `${(clip.title || 'corte').replace(/[^\p{L}\p{N}\s-]/gu, '').trim()}.mp4`;
    try {
      await googleService.uploadFile(accessToken, folder.drive_folder_id, clip.local_clip_path, filename, 'video/mp4');
      await clipsRepository.markExportedToDrive(clip.id);
      logger.info(`Corte ${clip.id} exportado pro Drive do canal ${folder.youtube_channel_id}.`);
    } catch (err) {
      logger.error(`Falha ao exportar o corte ${clip.id} pro Drive:`, err);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.DRIVE_EXPORT,
        entityType: 'clip',
        entityId: clip.id,
        clientUserId: channel.client_user_id,
        error: err,
      });
    }
  }
}

module.exports = { run };

// Varre todas as pastas do Drive cadastradas, cadastra videos novos e
// gera as postagens pendentes (fan-out da pasta-fonte de cada cliente).
'use strict';

const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../repositories/driveFoldersRepository');
const videosRepository = require('../../repositories/videosRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const driveFolderTiktokTargetsRepository = require('../../repositories/driveFolderTiktokTargetsRepository');
const googleService = require('../../services/googleService');
const errorReportService = require('../../services/errorReportService');
const logger = require('../../lib/logger');

async function run() {
  const folders = await driveFoldersRepository.listAll();
  for (const folder of folders) {
    await processFolder(folder);
  }
}

// Cada pasta guarda qual conexao Google usar (a do proprio cliente que
// conectou o Drive dele) - assim cada dono usa so o token dele.
async function processFolder(folder) {
  if (!folder.connection_id) {
    logger.info(`Drive discovery: pasta "${folder.folder_name || folder.drive_folder_id}" sem conexao Google associada, pulando.`);
    return;
  }

  const connection = await driveConnectionsRepository.findById(folder.connection_id);
  const accessToken = await driveConnectionsRepository.getValidAccessToken(googleService, connection);
  if (!accessToken) {
    logger.info(`Drive discovery: conexao da pasta "${folder.folder_name || folder.drive_folder_id}" nao esta mais valida, pulando.`);
    return;
  }

  let files;
  try {
    files = await googleService.listVideosInFolder(accessToken, folder.drive_folder_id);
  } catch (err) {
    logger.error(`Drive discovery: falha ao listar a pasta "${folder.folder_name || folder.drive_folder_id}":`, err.message);
    await errorReportService.report({
      operation: errorReportService.OPERACOES.DRIVE_DISCOVERY,
      entityType: 'drive_folder',
      entityId: folder.id,
      clientUserId: folder.client_user_id || null,
      error: err,
    });
    return;
  }

  for (const file of files) {
    const video = await videosRepository.createIfNotExists({
      driveFileId: file.id,
      driveFolderId: folder.id,
      filename: file.name,
      mimeType: file.mimeType,
      fileSizeBytes: file.size ? Number(file.size) : null,
      driveModifiedTime: file.modifiedTime || null,
    });

    // Se createIfNotExists nao retornou linha, o video ja era conhecido -
    // nao faz sentido gerar postagens de novo pra ele.
    if (!video) continue;

    await fanOut(video, folder);
    logger.info(`Novo video detectado: "${video.filename}" (pasta ${folder.type}).`);
  }

  await driveFoldersRepository.updateLastPolled(folder.id);
}

async function fanOut(video, folder) {
  // Pasta-fonte do proprio cliente: contas escolhidas ao configurar a
  // pasta (ver drive_folder_tiktok_targets) - pode ser mais de uma.
  const accountIds = await driveFolderTiktokTargetsRepository.listByFolderId(folder.id);
  for (const accountId of accountIds) {
    const account = await tiktokAccountsRepository.findById(accountId);
    if (account && account.is_active && account.auto_post_enabled) {
      await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: account.id });
    }
  }
}

module.exports = { run };

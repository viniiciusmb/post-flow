// Varre todas as pastas do Drive cadastradas, cadastra videos novos e
// gera as postagens pendentes (fan-out da pasta Geral / pasta do cliente).
'use strict';

const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../repositories/driveFoldersRepository');
const videosRepository = require('../../repositories/videosRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const driveFolderTiktokTargetsRepository = require('../../repositories/driveFolderTiktokTargetsRepository');
const googleService = require('../../services/googleService');
const logger = require('../../lib/logger');
const { DRIVE_FOLDER_TYPE } = require('../../config/constants');

async function run() {
  const folders = await driveFoldersRepository.listAll();
  for (const folder of folders) {
    await processFolder(folder);
  }
}

// Cada pasta guarda qual conexao Google usar (a do admin pra "Geral" e pras
// pastas de cliente cadastradas por ele, ou a do proprio cliente quando ele
// conectou o Drive dele mesmo) - assim cada dono usa so o token dele.
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
  if (folder.type === DRIVE_FOLDER_TYPE.GENERAL) {
    const accounts = await tiktokAccountsRepository.listReceivingGeneralContent();
    for (const account of accounts) {
      await postingsRepository.createIfNotExists({ videoId: video.id, tiktokAccountId: account.id });
    }
    return;
  }

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

// Auto-atendimento: o cliente conecta o proprio Google Drive (via
// /auth/google/connect, ja liberado pro papel client) e aponta a propria
// pasta - sem depender do admin cadastrar nada. A pasta "Geral" continua
// existindo e funcionando do jeito que sempre funcionou, em paralelo.
'use strict';

const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const { extractDriveFolderId } = require('../../../lib/driveFolderId');

async function status(req, res) {
  const [connection, folder, exportFolder] = await Promise.all([
    driveConnectionsRepository.findByOwnerId(req.session.user.id),
    driveFoldersRepository.findByClientId(req.session.user.id),
    driveFoldersRepository.findExportFolderByClientId(req.session.user.id),
  ]);

  res.json({
    connected: Boolean(connection),
    googleAccountEmail: connection ? connection.google_account_email : null,
    folder: folder
      ? { id: folder.drive_folder_id, name: folder.folder_name, lastPolledAt: folder.last_polled_at }
      : null,
    exportFolder: exportFolder ? { id: exportFolder.drive_folder_id, name: exportFolder.folder_name } : null,
  });
}

async function setFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  if (!driveFolderId) {
    return res.status(400).json({ error: 'Cole o link ou ID da pasta do Drive.' });
  }

  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.status(400).json({ error: 'Conecte o Google Drive primeiro.' });
  }

  const folder = await driveFoldersRepository.upsertClientFolder({
    clientUserId: req.session.user.id,
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });
  res.json({ folder: { id: folder.drive_folder_id, name: folder.folder_name } });
}

// Pasta de destino - pra onde os cortes prontos sao enviados como copia de
// seguranca. Precisa da mesma conexao Google ja usada pra pasta de origem
// (o cliente pode ter so uma OU as duas configuradas).
async function setExportFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  if (!driveFolderId) {
    return res.status(400).json({ error: 'Cole o link ou ID da pasta do Drive.' });
  }

  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.status(400).json({ error: 'Conecte o Google Drive primeiro.' });
  }

  const folder = await driveFoldersRepository.upsertClientExportFolder({
    clientUserId: req.session.user.id,
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });
  res.json({ exportFolder: { id: folder.drive_folder_id, name: folder.folder_name } });
}

module.exports = { status, setFolder, setExportFolder };

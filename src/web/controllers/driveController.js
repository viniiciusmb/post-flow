'use strict';

const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../repositories/driveFoldersRepository');
const usersRepository = require('../../repositories/usersRepository');
const { extractDriveFolderId } = require('../../lib/driveFolderId');
const { ROLES } = require('../../config/constants');

async function manage(req, res) {
  const [connection, folders, clients] = await Promise.all([
    driveConnectionsRepository.find(),
    driveFoldersRepository.listAll(),
    usersRepository.listByRole(ROLES.CLIENT),
  ]);

  res.render('admin/drive', {
    title: 'Google Drive',
    connection,
    folders,
    clients,
    googleConnected: req.query.google_connected === '1',
    googleError: req.query.google_error || null,
  });
}

async function setGeneralFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  if (driveFolderId) {
    await driveFoldersRepository.upsertGeneralFolder({ driveFolderId, folderName: req.body.folderName || null });
  }
  res.redirect('/admin/drive');
}

async function setClientFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  const clientUserId = Number(req.body.clientUserId);
  if (driveFolderId && clientUserId) {
    await driveFoldersRepository.upsertClientFolder({
      clientUserId,
      driveFolderId,
      folderName: req.body.folderName || null,
    });
  }
  res.redirect('/admin/drive');
}

module.exports = { manage, setGeneralFolder, setClientFolder };

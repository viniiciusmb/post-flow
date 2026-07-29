'use strict';

const driveConnectionsRepository = require('../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../repositories/driveFoldersRepository');
const usersRepository = require('../../repositories/usersRepository');
const { extractDriveFolderId } = require('../../lib/driveFolderId');
const { ROLES } = require('../../config/constants');

async function manage(req, res) {
  const [connection, folders, clients] = await Promise.all([
    driveConnectionsRepository.findByOwnerId(req.session.user.id),
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
    folderSaved: req.query.folder_saved || null,
    folderError: req.query.folder_error || null,
  });
}

async function setGeneralFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  if (!driveFolderId) {
    return res.redirect('/admin/drive?folder_error=Cole+o+link+ou+ID+da+pasta');
  }
  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.redirect('/admin/drive?folder_error=Conecte+o+Google+Drive+primeiro');
  }
  await driveFoldersRepository.upsertGeneralFolder({
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });
  res.redirect('/admin/drive?folder_saved=geral');
}

async function setClientFolder(req, res) {
  const driveFolderId = extractDriveFolderId(req.body.folderLink);
  const clientUserId = Number(req.body.clientUserId);
  if (!driveFolderId || !clientUserId) {
    return res.redirect('/admin/drive?folder_error=Selecione+o+cliente+e+cole+o+link+da+pasta');
  }
  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.redirect('/admin/drive?folder_error=Conecte+o+Google+Drive+primeiro');
  }
  await driveFoldersRepository.upsertClientFolder({
    clientUserId,
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });
  res.redirect('/admin/drive?folder_saved=cliente');
}

module.exports = { manage, setGeneralFolder, setClientFolder };

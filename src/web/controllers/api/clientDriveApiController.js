// Auto-atendimento: o cliente conecta o proprio Google Drive (via
// /auth/google/connect, ja liberado pro papel client) e aponta a propria
// pasta - sem depender do admin cadastrar nada. A pasta "Geral" continua
// existindo e funcionando do jeito que sempre funcionou, em paralelo.
'use strict';

const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const driveFolderTiktokTargetsRepository = require('../../../repositories/driveFolderTiktokTargetsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const { extractDriveFolderId } = require('../../../lib/driveFolderId');

async function status(req, res) {
  const [connection, folder] = await Promise.all([
    driveConnectionsRepository.findByOwnerId(req.session.user.id),
    driveFoldersRepository.findByClientId(req.session.user.id),
  ]);

  const tiktokAccountIds = folder ? await driveFolderTiktokTargetsRepository.listByFolderId(folder.id) : [];

  res.json({
    connected: Boolean(connection),
    googleAccountEmail: connection ? connection.google_account_email : null,
    folder: folder
      ? { id: folder.drive_folder_id, name: folder.folder_name, lastPolledAt: folder.last_polled_at, tiktokAccountIds }
      : null,
  });
}

// Pasta-fonte do proprio cliente pode alimentar mais de uma conta TikTok -
// mesma regra do video avulso (ver sourceVideosApiController.resolveTiktokAccountIds):
// 0 contas = segue sem nenhuma, 1 = usa ela direto, 2+ exige escolha.
async function resolveTiktokAccountIds(req) {
  const accounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  if (accounts.length === 0) return { tiktokAccountIds: [] };
  if (accounts.length === 1) return { tiktokAccountIds: [accounts[0].id] };

  const requested = Array.isArray(req.body.tiktokAccountIds) ? req.body.tiktokAccountIds : [];
  const ids = requested.map(Number).filter((n) => Number.isInteger(n));
  // tiktok_accounts.id e BIGINT - o driver pg devolve como string, entao
  // compara convertendo os dois lados pra numero.
  const validIds = accounts.filter((a) => ids.includes(Number(a.id))).map((a) => a.id);

  if (validIds.length === 0) {
    return { error: 'Escolha pelo menos uma conta TikTok pra receber os vídeos dessa pasta.' };
  }
  return { tiktokAccountIds: validIds };
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

  const targets = await resolveTiktokAccountIds(req);
  if (targets.error) return res.status(400).json({ error: targets.error });

  const folder = await driveFoldersRepository.upsertClientFolder({
    clientUserId: req.session.user.id,
    driveFolderId,
    folderName: req.body.folderName || null,
    connectionId: connection.id,
  });

  if (targets.tiktokAccountIds.length > 0) {
    await driveFolderTiktokTargetsRepository.setTargets(folder.id, targets.tiktokAccountIds);
  }

  res.json({ folder: { id: folder.drive_folder_id, name: folder.folder_name, tiktokAccountIds: targets.tiktokAccountIds } });
}

module.exports = { status, setFolder };

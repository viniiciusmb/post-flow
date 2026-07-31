'use strict';

const pool = require('../db/pool');

async function listAll() {
  const { rows } = await pool.query('SELECT * FROM drive_folders ORDER BY created_at DESC');
  return rows;
}

async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    "SELECT * FROM drive_folders WHERE type = 'client' AND client_user_id = $1",
    [clientUserId]
  );
  return rows[0] || null;
}

// Substitui a pasta "Geral" atual (so pode existir uma).
async function upsertGeneralFolder({ driveFolderId, folderName, connectionId }) {
  await pool.query("DELETE FROM drive_folders WHERE type = 'general'");
  const { rows } = await pool.query(
    `INSERT INTO drive_folders (type, drive_folder_id, folder_name, connection_id)
     VALUES ('general', $1, $2, $3) RETURNING *`,
    [driveFolderId, folderName, connectionId]
  );
  return rows[0];
}

// Substitui a pasta de um cliente especifico (um cliente so tem uma pasta).
// connectionId e a conexao Google Drive usada pra ler essa pasta - a do
// admin quando ele cadastra pro cliente, a do proprio cliente quando ele
// conecta o Drive dele mesmo (auto-atendimento).
async function upsertClientFolder({ clientUserId, driveFolderId, folderName, connectionId }) {
  await pool.query("DELETE FROM drive_folders WHERE type = 'client' AND client_user_id = $1", [clientUserId]);
  const { rows } = await pool.query(
    `INSERT INTO drive_folders (type, client_user_id, drive_folder_id, folder_name, connection_id)
     VALUES ('client', $1, $2, $3, $4) RETURNING *`,
    [clientUserId, driveFolderId, folderName, connectionId]
  );
  return rows[0];
}

async function updateLastPolled(id) {
  await pool.query('UPDATE drive_folders SET last_polled_at = now() WHERE id = $1', [id]);
}

// Pasta de DESTINO de um canal do YouTube especifico (pra onde os cortes
// prontos GERADOS DESSE CANAL sao enviados) - separada da pasta de ORIGEM
// (findByClientId, videos a processar, essa sim por cliente).
async function findExportFolderByChannelId(youtubeChannelId) {
  const { rows } = await pool.query(
    "SELECT * FROM drive_folders WHERE type = 'client_export' AND youtube_channel_id = $1",
    [youtubeChannelId]
  );
  return rows[0] || null;
}

async function findExportFoldersByChannelIds(youtubeChannelIds) {
  if (youtubeChannelIds.length === 0) return [];
  const { rows } = await pool.query(
    "SELECT * FROM drive_folders WHERE type = 'client_export' AND youtube_channel_id = ANY($1)",
    [youtubeChannelIds]
  );
  return rows;
}

async function upsertChannelExportFolder({ youtubeChannelId, driveFolderId, folderName, connectionId }) {
  await pool.query("DELETE FROM drive_folders WHERE type = 'client_export' AND youtube_channel_id = $1", [
    youtubeChannelId,
  ]);
  const { rows } = await pool.query(
    `INSERT INTO drive_folders (type, youtube_channel_id, drive_folder_id, folder_name, connection_id)
     VALUES ('client_export', $1, $2, $3, $4) RETURNING *`,
    [youtubeChannelId, driveFolderId, folderName, connectionId]
  );
  return rows[0];
}

// Todos os clientes com pasta de destino configurada - usado pelo job de
// exportacao pra saber pra quem vale a pena olhar cortes prontos.
async function listExportFolders() {
  const { rows } = await pool.query("SELECT * FROM drive_folders WHERE type = 'client_export'");
  return rows;
}

module.exports = {
  listAll,
  findByClientId,
  upsertGeneralFolder,
  upsertClientFolder,
  updateLastPolled,
  findExportFolderByChannelId,
  findExportFoldersByChannelIds,
  upsertChannelExportFolder,
  listExportFolders,
};

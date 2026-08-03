'use strict';

const pool = require('../db/pool');

async function listActive() {
  const { rows } = await pool.query('SELECT * FROM youtube_channels WHERE is_active = true');
  return rows;
}

async function listByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM youtube_channels WHERE client_user_id = $1 ORDER BY created_at DESC',
    [clientUserId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM youtube_channels WHERE id = $1', [id]);
  return rows[0] || null;
}

// Usado pro limite de canais por plano (youtubeChannelsApiController.create).
async function countByClientId(clientUserId) {
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM youtube_channels WHERE client_user_id = $1', [
    clientUserId,
  ]);
  return rows[0].count;
}

// Comeca PAUSADO (is_active = false) - o cliente precisa ligar de proposito
// (ver setActive) pra comecar o corte automatico, controle explicito em vez
// de automatico assim que adiciona. last_video_id comeca vazio de proposito:
// a primeira checagem do canal (channelCheckJob.js) usa isso pra saber que
// e a "primeira vez" e so estabelece o marco d'agua no video mais recente
// de agora, sem enfileirar nada do historico do canal.
async function create({ clientUserId, youtubeChannelId, channelName, channelUrl, avatarUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO youtube_channels (client_user_id, youtube_channel_id, channel_name, channel_url, avatar_url, is_active)
     VALUES ($1, $2, $3, $4, $5, false)
     ON CONFLICT (client_user_id, youtube_channel_id) DO NOTHING
     RETURNING *`,
    [clientUserId, youtubeChannelId, channelName, channelUrl, avatarUrl]
  );
  return rows[0] || null;
}

// Ao RETOMAR (isActive=true), zera last_video_id - senao todo video
// publicado durante o tempo em que o canal ficou pausado entra de uma vez
// como "novo" no proximo poll (era exatamente esse o bug: canal pausado
// por um tempo, ao retomar uma leva inteira de videos antigos caia na
// fila). Zerar faz a proxima checagem tratar como "primeira vez de novo" -
// so reestabelece o marco d'agua, sem processar o que passou durante a
// pausa. Ao pausar (isActive=false) nao mexe em nada.
async function setActive(id, clientUserId, isActive) {
  const { rows } = await pool.query(
    `UPDATE youtube_channels
     SET is_active = $3, last_video_id = CASE WHEN $3 THEN NULL ELSE last_video_id END
     WHERE id = $1 AND client_user_id = $2
     RETURNING *`,
    [id, clientUserId, isActive]
  );
  return rows[0] || null;
}

async function remove(id, clientUserId) {
  await pool.query('DELETE FROM youtube_channels WHERE id = $1 AND client_user_id = $2', [id, clientUserId]);
}

// 'auto' = qualquer corte pronto desse canal e enviado sozinho pra pasta de
// destino do Drive (driveExportJob.js). 'manual' (padrao) = o cliente
// escolhe corte a corte em Videos & Cortes.
// tiktokAccountId pode ser null (desvincula - cortes ficam prontos mas nao
// viram postagem ate o cliente escolher uma conta de novo).
async function setTiktokAccount(id, clientUserId, tiktokAccountId) {
  const { rows } = await pool.query(
    'UPDATE youtube_channels SET tiktok_account_id = $3 WHERE id = $1 AND client_user_id = $2 RETURNING *',
    [id, clientUserId, tiktokAccountId]
  );
  return rows[0] || null;
}

async function setDriveExportMode(id, clientUserId, mode) {
  const { rows } = await pool.query(
    'UPDATE youtube_channels SET drive_export_mode = $3 WHERE id = $1 AND client_user_id = $2 RETURNING *',
    [id, clientUserId, mode]
  );
  return rows[0] || null;
}

async function updatePollState(id, { lastVideoId }) {
  await pool.query(
    `UPDATE youtube_channels
        SET last_polled_at = now(),
            last_video_id = COALESCE($2, last_video_id),
            last_check_at = now(),
            last_check_ok = true,
            last_check_error = NULL,
            check_fail_count = 0
      WHERE id = $1`,
    [id, lastVideoId]
  );
}

// Registra que a checagem foi TENTADA e falhou. Separado de updatePollState de
// proposito: last_polled_at continua sendo "a ultima vez que conseguimos ler o
// canal de verdade", entao nao pode avancar num erro - senao a tela diria que
// esta tudo em dia enquanto nenhum video novo e detectado ha dias.
async function markCheckFailed(id, mensagemDeErro) {
  await pool.query(
    `UPDATE youtube_channels
        SET last_check_at = now(),
            last_check_ok = false,
            last_check_error = $2,
            check_fail_count = check_fail_count + 1
      WHERE id = $1`,
    // O erro do yt-dlp vem com paginas de saida; guardar tudo so enche o banco
    // e a tela. O comeco ja identifica o problema.
    [id, String(mensagemDeErro || '').slice(0, 500)]
  );
}

module.exports = {
  listActive,
  markCheckFailed,
  listByClientId,
  findById,
  countByClientId,
  create,
  setActive,
  remove,
  updatePollState,
  setDriveExportMode,
  setTiktokAccount,
};

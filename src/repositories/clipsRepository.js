'use strict';

const pool = require('../db/pool');

// Insere SEMPRE em ordem cronologica, e nao na ordem em que a IA devolveu.
//
// Duas coisas dependem disso: o corte "Parte 1" tem que ser o do comeco do
// video, e a fila de publicacao sai por id de postagem - que segue esta ordem
// de insercao. Sem ordenar aqui, o cliente via o corte do fim do video ser
// publicado antes do comeco, porque a IA nao devolve os trechos em ordem.
async function createMany(sourceVideoId, clips) {
  const created = [];
  const emOrdem = [...clips].sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds));
  for (const clip of emOrdem) {
    const { rows } = await pool.query(
      `INSERT INTO clips (source_video_id, title, description, start_seconds, end_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [sourceVideoId, clip.title, clip.description || null, clip.startSeconds, clip.endSeconds]
    );
    created.push(rows[0]);
  }
  return created;
}

async function listBySourceVideoId(sourceVideoId) {
  const { rows } = await pool.query(
    'SELECT * FROM clips WHERE source_video_id = $1 ORDER BY start_seconds ASC',
    [sourceVideoId]
  );
  return rows;
}

// Usado pra servir o arquivo do corte (preview/download) - confere que o
// corte pertence mesmo ao cliente que esta pedindo (via canal ou video
// manual), mesma logica de posse do sourceVideosRepository.
// Sem filtro de dono: só o painel de erros do admin usa (pra descobrir de que
// vídeo é um corte que falhou). As rotas do cliente continuam obrigadas a usar
// findByIdOwnedByClient, que é o que garante o isolamento entre contas.
async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM clips WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByIdOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT c.* FROM clips c
     JOIN source_videos sv ON sv.id = c.source_video_id
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE c.id = $1 AND coalesce(yc.client_user_id, sv.client_user_id) = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

// Igual findByIdOwnedByClient, mas tambem traz o canal do YouTube (se
// houver) - usado pro upload manual pro Drive, que precisa saber qual pasta
// de destino esse canal tem configurada.
async function findByIdWithChannelOwnedByClient(id, clientUserId) {
  const { rows } = await pool.query(
    `SELECT c.*, sv.youtube_channel_id FROM clips c
     JOIN source_videos sv ON sv.id = c.source_video_id
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE c.id = $1 AND coalesce(yc.client_user_id, sv.client_user_id) = $2`,
    [id, clientUserId]
  );
  return rows[0] || null;
}

async function updateStatus(id, status, { errorMessage = null } = {}) {
  await pool.query(
    "UPDATE clips SET status = $2, error_message = $3, render_progress_percent = 0, updated_at = now() WHERE id = $1",
    [id, status, errorMessage]
  );
}

async function saveRenderedFile(id, localClipPath, thumbnailPath = null) {
  await pool.query(
    "UPDATE clips SET local_clip_path = $2, thumbnail_path = $3, render_progress_percent = 100, status = 'ready', updated_at = now() WHERE id = $1",
    [id, localClipPath, thumbnailPath]
  );
}

// Chamado periodicamente durante a renderizacao (ver videoEditingService) -
// sem "updated_at" aqui de proposito, pra nao gerar uma escrita no banco a
// cada 1.5s por corte (o progresso e so cosmetico, o front ja faz polling).
async function updateRenderProgress(id, percent) {
  await pool.query('UPDATE clips SET render_progress_percent = $2 WHERE id = $1', [id, percent]);
}

// Usado antes de reiniciar um video que falhou - limpa cortes de uma
// tentativa anterior (videos/postings ligados a eles caem em cascata).
async function deleteBySourceVideoId(sourceVideoId) {
  await pool.query('DELETE FROM clips WHERE source_video_id = $1', [sourceVideoId]);
}

// Usado pela limpeza automatica de retencao (job de fundo, sem dono pra
// checar) - o video/posting ligados a esse corte caem em cascata.
async function deleteById(id) {
  await pool.query('DELETE FROM clips WHERE id = $1', [id]);
}

// Cortes prontos que ainda nao foram enviados pra pasta de destino do Drive
// de um canal especifico - usado pelo job de exportacao.
async function listReadyNotExportedByChannelId(youtubeChannelId) {
  const { rows } = await pool.query(
    `SELECT c.* FROM clips c
     JOIN source_videos sv ON sv.id = c.source_video_id
     WHERE sv.youtube_channel_id = $1
       AND c.status = 'ready' AND c.exported_to_drive_at IS NULL AND c.local_clip_path IS NOT NULL`,
    [youtubeChannelId]
  );
  return rows;
}

async function markExportedToDrive(id) {
  await pool.query('UPDATE clips SET exported_to_drive_at = now() WHERE id = $1', [id]);
}

async function countCreatedSince(since, until = new Date()) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS count FROM clips WHERE created_at >= $1 AND created_at <= $2',
    [since, until]
  );
  return rows[0].count;
}

async function countByClientSince(clientUserId, since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM clips c
     JOIN source_videos sv ON sv.id = c.source_video_id
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
       AND c.created_at >= $2 AND c.created_at <= $3`,
    [clientUserId, since, until]
  );
  return rows[0].count;
}

async function countPostedByClientSince(clientUserId, since, until = new Date()) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count
     FROM postings p
     JOIN videos v ON v.id = p.video_id
     JOIN clips c ON c.id = v.clip_id
     JOIN source_videos sv ON sv.id = c.source_video_id
     LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
     WHERE coalesce(yc.client_user_id, sv.client_user_id) = $1
       AND p.status = 'posted' AND p.created_at >= $2 AND p.created_at <= $3`,
    [clientUserId, since, until]
  );
  return rows[0].count;
}

module.exports = {
  createMany,
  listBySourceVideoId,
  findById,
  findByIdOwnedByClient,
  findByIdWithChannelOwnedByClient,
  updateStatus,
  updateRenderProgress,
  saveRenderedFile,
  deleteBySourceVideoId,
  deleteById,
  listReadyNotExportedByChannelId,
  markExportedToDrive,
  countCreatedSince,
  countByClientSince,
  countPostedByClientSince,
};

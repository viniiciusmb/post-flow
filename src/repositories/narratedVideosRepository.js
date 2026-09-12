// Acesso a narrated_videos e narrated_video_scenes.
'use strict';

const pool = require('../db/pool');

const EM_ANDAMENTO = ['roteirizando', 'narrando', 'ilustrando', 'montando'];

async function create({
  adminUserId, title, script, aspect, imagePolicy,
  voiceProvider, voiceId, burnCaptions, musicMood,
}) {
  const { rows } = await pool.query(
    `INSERT INTO narrated_videos
       (admin_user_id, title, script, aspect, image_policy,
        voice_provider, voice_id, burn_captions, music_mood)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [adminUserId, title, script, aspect, imagePolicy, voiceProvider, voiceId, burnCaptions, musicMood]
  );
  return rows[0];
}

async function listByOwner(adminUserId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT v.*,
            -- Custo real deste video, do livro contabil. Subconsulta, e nao
            -- JOIN: com JOIN, um video com varias cenas multiplicaria o valor
            -- (fan-out) - erro que ja apareceu duas vezes neste projeto.
            (SELECT coalesce(c.whisper_usd + c.ia_usd + c.tts_usd + c.imagem_usd, 0)
               FROM video_costs c WHERE c.narrated_video_id = v.id) AS custo_usd,
            (SELECT count(*) FROM narrated_video_scenes s WHERE s.narrated_video_id = v.id) AS total_cenas,
            (SELECT count(*) FROM narrated_video_scenes s
              WHERE s.narrated_video_id = v.id AND s.image_source = 'ia') AS cenas_ia
       FROM narrated_videos v
      WHERE v.admin_user_id = $1
      ORDER BY v.created_at DESC
      LIMIT $2`,
    [adminUserId, limit]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM narrated_videos WHERE id = $1', [id]);
  return rows[0] || null;
}

// Sempre filtrando por dono: e a mesma checagem de posse que a auditoria de
// IDOR deste projeto exige em toda rota com :id.
async function findOwned(id, adminUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM narrated_videos WHERE id = $1 AND admin_user_id = $2',
    [id, adminUserId]
  );
  return rows[0] || null;
}

// Posse ATOMICA da geracao: um UPDATE ... RETURNING, e so quem muda a linha
// recebe ela de volta.
//
// Ler o status e depois decidir nao serve: dois jobs que comecam no mesmo
// segundo leem 'na_fila' os dois antes de qualquer um escrever, e os dois
// seguem. Foi exatamente esse defeito que fez dois jobs processarem o mesmo
// video em 01/09/2026, um apagando o arquivo que o outro estava usando.
async function claimForProcessing(id) {
  const { rows } = await pool.query(
    `UPDATE narrated_videos
        SET status = 'roteirizando',
            progress_percent = 0,
            error_message = NULL,
            error_transient = NULL,
            attempts = attempts + 1,
            processing_heartbeat_at = now(),
            updated_at = now()
      WHERE id = $1 AND status IN ('na_fila', 'erro')
      RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function setStatus(id, status, extra = {}) {
  const { rows } = await pool.query(
    `UPDATE narrated_videos
        SET status = $2,
            progress_percent = coalesce($3, progress_percent),
            duration_seconds = coalesce($4, duration_seconds),
            video_path = coalesce($5, video_path),
            audio_path = coalesce($6, audio_path),
            error_message = $7,
            error_transient = $8,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      id, status,
      extra.progressPercent ?? null,
      extra.durationSeconds ?? null,
      extra.videoPath ?? null,
      extra.audioPath ?? null,
      extra.errorMessage ?? null,
      extra.errorTransient ?? null,
    ]
  );
  return rows[0] || null;
}

async function setProgress(id, percent) {
  await pool.query(
    'UPDATE narrated_videos SET progress_percent = $2, updated_at = now() WHERE id = $1',
    [id, Math.max(0, Math.min(100, Math.round(percent)))]
  );
}

async function touchHeartbeat(id) {
  await pool.query('UPDATE narrated_videos SET processing_heartbeat_at = now() WHERE id = $1', [id]);
}

// Video cuja geracao morreu no meio (deploy, crash). A deteccao e por SINAL DE
// VIDA, nunca por tempo puro: os deploys sao start-first e um video "ha 40min
// montando" pode estar sendo renderizado agora pelo container antigo.
async function findStuck({ silencioMinutos = 15 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM narrated_videos
      WHERE status = ANY($1)
        AND (processing_heartbeat_at IS NULL OR processing_heartbeat_at < now() - ($2 || ' minutes')::interval)
        AND attempts < 3`,
    [EM_ANDAMENTO, String(silencioMinutos)]
  );
  return rows;
}

async function remove(id, adminUserId) {
  const { rows } = await pool.query(
    'DELETE FROM narrated_videos WHERE id = $1 AND admin_user_id = $2 RETURNING *',
    [id, adminUserId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Cenas
// ---------------------------------------------------------------------------

// Substitui as cenas do video. Apaga antes porque reprocessar um video que
// falhou tem que recomecar do roteiro - manter cena velha misturaria dois
// planos de imagem diferentes.
async function replaceScenes(narratedVideoId, cenas) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM narrated_video_scenes WHERE narrated_video_id = $1', [narratedVideoId]);
    for (const c of cenas) {
      await client.query(
        `INSERT INTO narrated_video_scenes
           (narrated_video_id, idx, text, image_query, image_prompt)
         VALUES ($1,$2,$3,$4,$5)`,
        [narratedVideoId, c.idx, c.text, c.imageQuery || null, c.imagePrompt || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return listScenes(narratedVideoId);
}

async function listScenes(narratedVideoId) {
  const { rows } = await pool.query(
    'SELECT * FROM narrated_video_scenes WHERE narrated_video_id = $1 ORDER BY idx',
    [narratedVideoId]
  );
  return rows;
}

async function updateScene(id, campos = {}) {
  const { rows } = await pool.query(
    `UPDATE narrated_video_scenes
        SET audio_path = coalesce($2, audio_path),
            duration_seconds = coalesce($3, duration_seconds),
            image_source = coalesce($4, image_source),
            image_path = coalesce($5, image_path),
            image_url = coalesce($6, image_url),
            image_license = coalesce($7, image_license),
            image_credit = coalesce($8, image_credit)
      WHERE id = $1
      RETURNING *`,
    [
      id,
      campos.audioPath ?? null,
      campos.durationSeconds ?? null,
      campos.imageSource ?? null,
      campos.imagePath ?? null,
      campos.imageUrl ?? null,
      campos.imageLicense ?? null,
      campos.imageCredit ?? null,
    ]
  );
  return rows[0] || null;
}

module.exports = {
  create,
  listByOwner,
  findById,
  findOwned,
  claimForProcessing,
  setStatus,
  setProgress,
  touchHeartbeat,
  findStuck,
  remove,
  replaceScenes,
  listScenes,
  updateScene,
  EM_ANDAMENTO,
};

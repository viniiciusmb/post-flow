'use strict';

const pool = require('../db/pool');

// Cortes prontos do cliente, do mais novo pro mais antigo, em páginas.
//
// A paginação é por id ("antes deste corte"), não por número de página: o
// feed fica aberto enquanto cortes novos ficam prontos, e uma página por
// OFFSET repetiria ou pularia cortes cada vez que um novo entrasse no topo.
//
// O dono é sempre o da sessão (owner_client_user_id), nunca um id que veio da
// tela. `canal` restringe a um canal do cliente ('avulsos' = sem canal).
async function listarCortes(clientUserId, { canal = null, soGostei = false, antes = null, limite = 12 } = {}) {
  const params = [clientUserId];
  const filtros = [];
  if (canal === 'avulsos') {
    filtros.push('sv.youtube_channel_id IS NULL');
  } else if (canal !== null) {
    params.push(canal);
    filtros.push(`sv.youtube_channel_id = $${params.length}`);
  }
  if (soGostei) filtros.push('l.clip_id IS NOT NULL');
  if (antes !== null) {
    params.push(antes);
    filtros.push(`c.id < $${params.length}`);
  }
  params.push(limite);

  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.start_seconds, c.end_seconds, c.created_at, c.local_clip_path,
            (c.thumbnail_path IS NOT NULL) AS tem_capa,
            sv.id AS source_video_id, sv.title AS source_title, sv.youtube_channel_id,
            yc.channel_name, yc.avatar_url AS channel_avatar, yc.channel_url,
            (l.clip_id IS NOT NULL) AS gostei,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'accountId', p.tiktok_account_id,
                       'status', p.status,
                       'scheduledFor', p.scheduled_for,
                       'postedAt', p.posted_at
                     ) ORDER BY p.id)
                FROM videos v JOIN postings p ON p.video_id = v.id
               WHERE v.clip_id = c.id
            ), '[]') AS postagens
       FROM clips c
       JOIN source_videos sv ON sv.id = c.source_video_id
       LEFT JOIN youtube_channels yc ON yc.id = sv.youtube_channel_id
       LEFT JOIN clip_likes l ON l.clip_id = c.id AND l.client_user_id = $1
      WHERE sv.owner_client_user_id = $1
        AND c.status = 'ready'
        AND c.local_clip_path IS NOT NULL
        ${filtros.map((f) => `AND ${f}`).join(' ')}
      ORDER BY c.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function contarGostei(clientUserId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM clip_likes l
       JOIN clips c ON c.id = l.clip_id
       JOIN source_videos sv ON sv.id = c.source_video_id
      WHERE l.client_user_id = $1 AND sv.owner_client_user_id = $1 AND c.status = 'ready' AND c.local_clip_path IS NOT NULL`,
    [clientUserId]
  );
  return rows[0].n;
}

async function marcarGostei(clientUserId, clipId, gostei) {
  if (gostei) {
    await pool.query(
      'INSERT INTO clip_likes (client_user_id, clip_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [clientUserId, clipId]
    );
  } else {
    await pool.query('DELETE FROM clip_likes WHERE client_user_id = $1 AND clip_id = $2', [clientUserId, clipId]);
  }
}

// A postagem que já existe deste corte nesta conta (qualquer status).
async function postagemDoCorte(clipId, tiktokAccountId) {
  const { rows } = await pool.query(
    `SELECT p.* FROM postings p JOIN videos v ON v.id = p.video_id
      WHERE v.clip_id = $1 AND p.tiktok_account_id = $2`,
    [clipId, tiktokAccountId]
  );
  return rows[0] || null;
}

module.exports = { listarCortes, contarGostei, marcarGostei, postagemDoCorte };

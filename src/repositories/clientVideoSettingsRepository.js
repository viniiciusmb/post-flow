// Preferencias de edicao de video por cliente (proporcao, qualidade,
// legenda, estilo de corte). Sem linha no banco = usa DEFAULTS.
'use strict';

const pool = require('../db/pool');

const DEFAULTS = {
  aspect_ratio: '9:16',
  framing: 'crop',
  quality: 'high',
  caption_style: 'classic',
  clip_length: 'balanced',
  max_clips: 4,
};

async function findByClientId(clientUserId) {
  const { rows } = await pool.query('SELECT * FROM client_video_settings WHERE client_user_id = $1', [clientUserId]);
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : { client_user_id: clientUserId, ...DEFAULTS };
}

async function upsert(clientUserId, { aspectRatio, framing, quality, captionStyle, clipLength, maxClips }) {
  const { rows } = await pool.query(
    `INSERT INTO client_video_settings (client_user_id, aspect_ratio, framing, quality, caption_style, clip_length, max_clips)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_user_id) DO UPDATE SET
       aspect_ratio = $2, framing = $3, quality = $4, caption_style = $5, clip_length = $6, max_clips = $7, updated_at = now()
     RETURNING *`,
    [clientUserId, aspectRatio, framing, quality, captionStyle, clipLength, maxClips]
  );
  return rows[0];
}

module.exports = { DEFAULTS, findByClientId, upsert };

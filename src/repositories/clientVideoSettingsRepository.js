// Preferencias de edicao de video por cliente (proporcao, qualidade,
// legenda, estilo/modo de corte, titulo, descricao). Sem linha no banco =
// usa DEFAULTS.
'use strict';

const pool = require('../db/pool');

const DEFAULTS = {
  aspect_ratio: '9:16',
  framing: 'crop',
  quality: 'high',
  caption_style: 'classic',
  clip_length: 'balanced',
  clip_mode: 'ai_choice',
  max_clips: 4,
  show_title: true,
  title_seconds: 3,
  description_mode: 'auto',
  description_template: null,
  crop_style_mode: 'auto',
  crop_zoom_percent: 100,
  show_part_label: false,
  part_label_position: 'top_right',
  title_style: 'classic',
};

async function findByClientId(clientUserId) {
  const { rows } = await pool.query('SELECT * FROM client_video_settings WHERE client_user_id = $1', [clientUserId]);
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : { client_user_id: clientUserId, ...DEFAULTS };
}

async function upsert(
  clientUserId,
  {
    aspectRatio,
    framing,
    quality,
    captionStyle,
    clipLength,
    clipMode,
    maxClips,
    showTitle,
    titleSeconds,
    descriptionMode,
    descriptionTemplate,
    cropStyleMode,
    cropZoomPercent,
    showPartLabel,
    partLabelPosition,
    titleStyle,
  }
) {
  const { rows } = await pool.query(
    `INSERT INTO client_video_settings (
       client_user_id, aspect_ratio, framing, quality, caption_style, clip_length, clip_mode, max_clips,
       show_title, title_seconds, description_mode, description_template,
       crop_style_mode, crop_zoom_percent, show_part_label, part_label_position, title_style
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (client_user_id) DO UPDATE SET
       aspect_ratio = $2, framing = $3, quality = $4, caption_style = $5, clip_length = $6, clip_mode = $7, max_clips = $8,
       show_title = $9, title_seconds = $10, description_mode = $11, description_template = $12,
       crop_style_mode = $13, crop_zoom_percent = $14, show_part_label = $15, part_label_position = $16,
       title_style = $17,
       updated_at = now()
     RETURNING *`,
    [
      clientUserId,
      aspectRatio,
      framing,
      quality,
      captionStyle,
      clipLength,
      clipMode,
      maxClips,
      showTitle,
      titleSeconds,
      descriptionMode,
      descriptionTemplate || null,
      cropStyleMode,
      cropZoomPercent,
      showPartLabel,
      partLabelPosition,
      titleStyle,
    ]
  );
  return rows[0];
}

module.exports = { DEFAULTS, findByClientId, upsert };

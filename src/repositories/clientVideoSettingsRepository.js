// Preferencias de edicao de video (legenda, estilo/modo de corte, titulo,
// descricao, template de fundo).
//
// Proporcao, enquadramento e qualidade sairam na migration 070: o corte e
// sempre 9:16 e o enquadramento quem decide e o "estilo do corte".
//
// Duas camadas na MESMA tabela:
//   youtube_channel_id IS NULL  -> configuracao padrao do cliente
//                                  ("aplicar em todos os canais")
//   youtube_channel_id = <id>   -> excecao daquele canal
//
// Resolucao: canal -> padrao do cliente -> DEFAULTS do codigo. Sem linha
// nenhuma no banco, tudo cai nos DEFAULTS.
'use strict';

const pool = require('../db/pool');

const DEFAULTS = {
  caption_style: 'classic',
  caption_font: 'Anton',
  title_box_color: '#D92323',
  caption_box_color: '#D92323',
  title_font: 'Anton',
  caption_height_percent: 14,
  title_height_percent: 8,
  clip_length: 'balanced',
  clip_mode: 'ai_choice',
  full_parts_minutes: 3,
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
  background_style: 'blur',
  background_template_path: null,
  background_video_height_percent: 100,
  background_video_offset_percent: 50,
  thumbnail_position: 'top',
};

const COLUNAS = [
  'caption_style',
  'caption_font',
  'title_box_color',
  'caption_box_color',
  'title_font',
  'caption_height_percent',
  'title_height_percent',
  'clip_length',
  'clip_mode',
  'full_parts_minutes',
  'max_clips',
  'show_title',
  'title_seconds',
  'description_mode',
  'description_template',
  'crop_style_mode',
  'crop_zoom_percent',
  'show_part_label',
  'part_label_position',
  'title_style',
  'background_style',
  'background_template_path',
  'background_video_height_percent',
  'background_video_offset_percent',
  'thumbnail_position',
];

function doCamelParaColuna(entrada) {
  return {
    caption_style: entrada.captionStyle,
    // Campos NOT NULL: quem chamar sem eles (um cartao da tela que so salva
    // qualidade, por exemplo) receberia null e derrubaria a gravacao inteira.
    // O padrao vem de DEFAULTS, uma fonte so - repetir o valor aqui criaria
    // duas verdades que sairiam de sincronia na primeira mudanca.
    caption_font: entrada.captionFont ?? DEFAULTS.caption_font,
    title_box_color: entrada.titleBoxColor ?? DEFAULTS.title_box_color,
    caption_box_color: entrada.captionBoxColor ?? DEFAULTS.caption_box_color,
    title_font: entrada.titleFont ?? DEFAULTS.title_font,
    caption_height_percent: entrada.captionHeightPercent ?? DEFAULTS.caption_height_percent,
    title_height_percent: entrada.titleHeightPercent ?? DEFAULTS.title_height_percent,
    clip_length: entrada.clipLength,
    clip_mode: entrada.clipMode,
    full_parts_minutes: entrada.fullPartsMinutes ?? DEFAULTS.full_parts_minutes,
    max_clips: entrada.maxClips,
    show_title: entrada.showTitle,
    title_seconds: entrada.titleSeconds,
    description_mode: entrada.descriptionMode,
    description_template: entrada.descriptionTemplate || null,
    crop_style_mode: entrada.cropStyleMode,
    crop_zoom_percent: entrada.cropZoomPercent,
    show_part_label: entrada.showPartLabel,
    part_label_position: entrada.partLabelPosition,
    title_style: entrada.titleStyle,
    background_style: entrada.backgroundStyle || 'blur',
    background_template_path: entrada.backgroundTemplatePath ?? null,
    background_video_height_percent: entrada.backgroundVideoHeightPercent ?? 100,
    background_video_offset_percent: entrada.backgroundVideoOffsetPercent ?? 50,
    thumbnail_position: entrada.thumbnailPosition || 'top',
  };
}

// Configuracao "de todos os canais" (a linha com youtube_channel_id NULL).
async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id IS NULL',
    [clientUserId]
  );
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : { client_user_id: clientUserId, youtube_channel_id: null, ...DEFAULTS };
}

// Configuracao de UM canal, sem herdar nada. Devolve null quando aquele canal
// nao tem excecao propria - e assim que a tela sabe mostrar "usando o padrao".
async function findChannelOverride(clientUserId, youtubeChannelId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id = $2',
    [clientUserId, youtubeChannelId]
  );
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : null;
}

// O que o pipeline usa de verdade na hora de cortar: excecao do canal se
// existir, senao o padrao do cliente, senao DEFAULTS. Video avulso (upload ou
// link colado) nao tem canal, entao cai direto no padrao.
async function resolveForVideo(clientUserId, youtubeChannelId = null) {
  if (youtubeChannelId) {
    const doCanal = await findChannelOverride(clientUserId, youtubeChannelId);
    if (doCanal) return doCanal;
  }
  return findByClientId(clientUserId);
}

async function listChannelOverrides(clientUserId) {
  const { rows } = await pool.query(
    'SELECT youtube_channel_id FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id IS NOT NULL',
    [clientUserId]
  );
  return rows.map((r) => Number(r.youtube_channel_id));
}

// youtubeChannelId null grava o padrao; com id, grava a excecao do canal.
//
// ATENCAO: a tabela nao tem mais UNIQUE simples, e sim dois indices unicos
// PARCIAIS (ver migration 047). Por isso cada ON CONFLICT abaixo repete o
// predicado do indice correspondente. Sem o predicado, o Postgres nao encontra
// o indice e o INSERT falha ("no unique or exclusion constraint matching").
async function upsert(clientUserId, entrada, youtubeChannelId = null) {
  const valores = doCamelParaColuna(entrada);
  const listaColunas = COLUNAS.join(', ');
  // $1 = cliente, $2 = canal, e as colunas comecam em $3.
  const placeholders = COLUNAS.map((_, i) => `$${i + 3}`).join(', ');
  const atualizacoes = COLUNAS.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const parametros = [clientUserId, youtubeChannelId, ...COLUNAS.map((c) => valores[c])];

  const alvoDoConflito =
    youtubeChannelId === null
      ? '(client_user_id) WHERE youtube_channel_id IS NULL'
      : '(client_user_id, youtube_channel_id) WHERE youtube_channel_id IS NOT NULL';

  const { rows } = await pool.query(
    `INSERT INTO client_video_settings (client_user_id, youtube_channel_id, ${listaColunas})
     VALUES ($1, $2, ${placeholders})
     ON CONFLICT ${alvoDoConflito} DO UPDATE SET ${atualizacoes}, updated_at = now()
     RETURNING *`,
    parametros
  );
  return rows[0];
}

// Apaga a excecao de um canal: ele volta a seguir o padrao do cliente.
async function removeChannelOverride(clientUserId, youtubeChannelId) {
  const { rowCount } = await pool.query(
    'DELETE FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id = $2',
    [clientUserId, youtubeChannelId]
  );
  return rowCount > 0;
}

module.exports = {
  DEFAULTS,
  findByClientId,
  findChannelOverride,
  resolveForVideo,
  listChannelOverrides,
  upsert,
  removeChannelOverride,
};

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
  full_parts_mode: 'duration',
  full_parts_minutes: 3,
  full_parts_count: 8,
  max_clips: 4,
  show_title: true,
  title_seconds: 3,
  description_mode: 'auto',
  description_template: null,
  crop_style_mode: 'auto',
  crop_zoom_percent: 100,
  show_part_label: false,
  part_label_position: 'top_right',
  part_label_size_percent: 100,
  title_style: 'classic',
  background_style: 'blur',
  background_template_path: null,
  background_video_height_percent: 100,
  background_video_offset_percent: 50,
  thumbnail_position: 'top',
  audio_language: 'original',
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
  'full_parts_mode',
  'full_parts_minutes',
  'full_parts_count',
  'max_clips',
  'show_title',
  'title_seconds',
  'description_mode',
  'description_template',
  'crop_style_mode',
  'crop_zoom_percent',
  'show_part_label',
  'part_label_position',
  'part_label_size_percent',
  'title_style',
  'background_style',
  'background_template_path',
  'background_video_height_percent',
  'background_video_offset_percent',
  'thumbnail_position',
  'audio_language',
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
    full_parts_mode: entrada.fullPartsMode ?? DEFAULTS.full_parts_mode,
    full_parts_minutes: entrada.fullPartsMinutes ?? DEFAULTS.full_parts_minutes,
    full_parts_count: entrada.fullPartsCount ?? DEFAULTS.full_parts_count,
    max_clips: entrada.maxClips,
    show_title: entrada.showTitle,
    title_seconds: entrada.titleSeconds,
    description_mode: entrada.descriptionMode,
    description_template: entrada.descriptionTemplate || null,
    crop_style_mode: entrada.cropStyleMode,
    crop_zoom_percent: entrada.cropZoomPercent,
    show_part_label: entrada.showPartLabel,
    part_label_position: entrada.partLabelPosition,
    part_label_size_percent: entrada.partLabelSizePercent ?? DEFAULTS.part_label_size_percent,
    title_style: entrada.titleStyle,
    background_style: entrada.backgroundStyle || 'blur',
    background_template_path: entrada.backgroundTemplatePath ?? null,
    background_video_height_percent: entrada.backgroundVideoHeightPercent ?? 100,
    background_video_offset_percent: entrada.backgroundVideoOffsetPercent ?? 50,
    thumbnail_position: entrada.thumbnailPosition || 'top',
    audio_language: entrada.audioLanguage || DEFAULTS.audio_language,
  };
}

// Configuracao "de todos os canais" (a linha com youtube_channel_id NULL).
async function findByClientId(clientUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM client_video_settings
      WHERE client_user_id = $1 AND youtube_channel_id IS NULL AND source_video_id IS NULL`,
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

// Estilo escolhido para UM video avulso, sem herdar nada. Null quando aquele
// video nao tem estilo proprio.
async function findVideoOverride(clientUserId, sourceVideoId) {
  const { rows } = await pool.query(
    'SELECT * FROM client_video_settings WHERE client_user_id = $1 AND source_video_id = $2',
    [clientUserId, sourceVideoId]
  );
  return rows[0] ? { ...DEFAULTS, ...rows[0] } : null;
}

// O que o pipeline usa de verdade na hora de cortar, do mais especifico para o
// mais geral: estilo daquele VIDEO, senao do CANAL, senao o padrao do cliente,
// senao DEFAULTS.
//
// O video vem primeiro porque e a escolha mais recente e mais explicita que
// existe: alguem enviou aquele video e disse como queria o corte DELE.
async function resolveForVideo(clientUserId, youtubeChannelId = null, sourceVideoId = null) {
  if (sourceVideoId) {
    const doVideo = await findVideoOverride(clientUserId, sourceVideoId);
    if (doVideo) return doVideo;
  }
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

// Grava o padrao do cliente, a excecao de um canal, ou a excecao de um video
// avulso - o alvo decide. Aceita a forma antiga (um numero = canal) para nao
// quebrar quem ja chamava assim.
//
// ATENCAO: a tabela nao tem mais UNIQUE simples, e sim dois indices unicos
// PARCIAIS (ver migration 047). Por isso cada ON CONFLICT abaixo repete o
// predicado do indice correspondente. Sem o predicado, o Postgres nao encontra
// o indice e o INSERT falha ("no unique or exclusion constraint matching").
async function upsert(clientUserId, entrada, alvo = null) {
  const { youtubeChannelId, sourceVideoId } =
    alvo && typeof alvo === 'object' ? alvo : { youtubeChannelId: alvo, sourceVideoId: null };

  const valores = doCamelParaColuna(entrada);
  const listaColunas = COLUNAS.join(', ');
  // $1 = cliente, $2 = canal, $3 = video, e as colunas comecam em $4.
  const placeholders = COLUNAS.map((_, i) => `$${i + 4}`).join(', ');
  const atualizacoes = COLUNAS.map((c, i) => `${c} = $${i + 4}`).join(', ');
  const parametros = [
    clientUserId,
    youtubeChannelId || null,
    sourceVideoId || null,
    ...COLUNAS.map((c) => valores[c]),
  ];

  // Cada ON CONFLICT repete o predicado do indice parcial correspondente. Sem
  // isso o Postgres nao encontra o indice e o INSERT falha - ver o comentario
  // das migrations 047 e 081.
  let alvoDoConflito;
  if (sourceVideoId) {
    alvoDoConflito = '(client_user_id, source_video_id) WHERE source_video_id IS NOT NULL';
  } else if (youtubeChannelId) {
    alvoDoConflito = '(client_user_id, youtube_channel_id) WHERE youtube_channel_id IS NOT NULL';
  } else {
    alvoDoConflito = '(client_user_id) WHERE youtube_channel_id IS NULL AND source_video_id IS NULL';
  }

  const { rows } = await pool.query(
    `INSERT INTO client_video_settings (client_user_id, youtube_channel_id, source_video_id, ${listaColunas})
     VALUES ($1, $2, $3, ${placeholders})
     ON CONFLICT ${alvoDoConflito} DO UPDATE SET ${atualizacoes}, updated_at = now()
     RETURNING *`,
    parametros
  );
  return rows[0];
}

// Dá a um vídeo avulso um estilo próprio, copiado de onde o cliente escolheu:
// de um canal que ele já configurou, ou do padrão dele.
//
// COPIA os valores em vez de apontar para a linha de origem, e isso é
// deliberado: se o cliente mudar depois o estilo daquele canal, o vídeo que
// ele já mandou cortar não pode mudar junto - ele já viu como ia ficar.
async function copiarEstiloParaVideo(clientUserId, sourceVideoId, { deCanalId = null } = {}) {
  const origem = deCanalId
    ? (await findChannelOverride(clientUserId, deCanalId)) || (await findByClientId(clientUserId))
    : await findByClientId(clientUserId);

  return upsert(clientUserId, doColunaParaCamel(origem), { sourceVideoId });
}

// Muda só o idioma do áudio de um vídeo avulso, preservando o resto - mesmo
// motivo do setChannelAudioLanguage: quem chama (a tela de envio) não tem o
// estilo em mãos e gravaria a linha inteira em branco.
async function setVideoAudioLanguage(clientUserId, sourceVideoId, audioLanguage) {
  const existente = await findVideoOverride(clientUserId, sourceVideoId);
  const base = existente || (await findByClientId(clientUserId));
  return upsert(clientUserId, { ...doColunaParaCamel(base), audioLanguage }, { sourceVideoId });
}

// Apaga a excecao de um canal: ele volta a seguir o padrao do cliente.
async function removeChannelOverride(clientUserId, youtubeChannelId) {
  const { rowCount } = await pool.query(
    'DELETE FROM client_video_settings WHERE client_user_id = $1 AND youtube_channel_id = $2',
    [clientUserId, youtubeChannelId]
  );
  return rowCount > 0;
}

// Muda SÓ o idioma do áudio de um canal, preservando todo o resto.
//
// Existe separado do upsert por um motivo concreto: o upsert grava a linha
// inteira, e quem chama precisa ter em mãos todas as outras configurações. A
// tela de Canais não tem — ela nunca carregou o estilo de corte do cliente.
// Mandá-la gravar a linha toda faria o pop-up de idioma apagar em silêncio o
// estilo que o cliente já tinha configurado.
//
// Quando o canal ainda não tem exceção própria, ela NASCE a partir do padrão
// atual do cliente (e não dos DEFAULTS do código) — senão escolher um idioma
// jogaria fora o estilo que o cliente configurou para todos os canais.
async function setChannelAudioLanguage(clientUserId, youtubeChannelId, audioLanguage) {
  const existente = await findChannelOverride(clientUserId, youtubeChannelId);
  if (existente) {
    const { rows } = await pool.query(
      `UPDATE client_video_settings SET audio_language = $3, updated_at = now()
        WHERE client_user_id = $1 AND youtube_channel_id = $2
        RETURNING *`,
      [clientUserId, youtubeChannelId, audioLanguage]
    );
    return rows[0];
  }

  const padrao = await findByClientId(clientUserId);
  return upsert(clientUserId, { ...doColunaParaCamel(padrao), audioLanguage }, { youtubeChannelId });
}

// Volta de coluna pra camelCase, que é o formato que o upsert espera. Escrito
// a partir de COLUNAS para não haver duas listas de campos que precisem ser
// mantidas iguais: um campo novo entra numa lista só.
function doColunaParaCamel(linha) {
  const saida = {};
  for (const coluna of COLUNAS) {
    const camel = coluna.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    saida[camel] = linha[coluna];
  }
  return saida;
}

module.exports = {
  findVideoOverride,
  copiarEstiloParaVideo,
  setVideoAudioLanguage,
  setChannelAudioLanguage,
  DEFAULTS,
  findByClientId,
  findChannelOverride,
  resolveForVideo,
  listChannelOverrides,
  upsert,
  removeChannelOverride,
};

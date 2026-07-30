// Preferencias de edicao de video do cliente: proporcao (9:16 por padrao),
// enquadramento, qualidade, estilo de legenda, "estilo do corte" (duracao),
// modo de corte (IA decide / video inteiro / quantidade fixa), titulo
// queimado no video e descricao (auto/fixa).
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../../../services/videoEditingService');

const ASPECT_RATIOS = Object.keys(videoEditingService.ASPECT_RATIOS);
const QUALITIES = Object.keys(videoEditingService.QUALITY_PRESETS);
const CAPTION_STYLES = [...Object.keys(videoEditingService.CAPTION_STYLES), 'none'];
const TITLE_STYLES = Object.keys(videoEditingService.TITLE_STYLES);
const FRAMINGS = ['crop', 'blur_pad'];
const CLIP_LENGTHS = ['short', 'balanced', 'long'];
const CLIP_MODES = ['ai_choice', 'full_video', 'fixed_count'];
const DESCRIPTION_MODES = ['auto', 'fixed', 'none'];
const CROP_STYLE_MODES = ['auto', 'manual'];
const PART_LABEL_POSITIONS = ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'];

function toApi(settings) {
  return {
    aspectRatio: settings.aspect_ratio,
    framing: settings.framing,
    quality: settings.quality,
    captionStyle: settings.caption_style,
    clipLength: settings.clip_length,
    clipMode: settings.clip_mode,
    maxClips: settings.max_clips,
    showTitle: settings.show_title,
    titleSeconds: settings.title_seconds,
    descriptionMode: settings.description_mode,
    descriptionTemplate: settings.description_template,
    cropStyleMode: settings.crop_style_mode,
    cropZoomPercent: settings.crop_zoom_percent,
    showPartLabel: settings.show_part_label,
    partLabelPosition: settings.part_label_position,
    titleStyle: settings.title_style,
  };
}

const OPTIONS_PAYLOAD = {
  aspectRatios: ASPECT_RATIOS,
  framings: FRAMINGS,
  qualities: QUALITIES,
  captionStyles: CAPTION_STYLES,
  clipLengths: CLIP_LENGTHS,
  clipModes: CLIP_MODES,
  descriptionModes: DESCRIPTION_MODES,
  cropStyleModes: CROP_STYLE_MODES,
  partLabelPositions: PART_LABEL_POSITIONS,
  titleStyles: TITLE_STYLES,
};

// toApi() nunca inclui "options" (sao constantes fixas, nao vem do banco) -
// tanto GET quanto PUT devolvem pro front, senao qualquer tela que salva e
// atualiza o estado com a resposta do PUT perde settings.options e quebra
// (era exatamente isso que acontecia antes dessa correcao).
function toApiWithOptions(settings) {
  return { ...toApi(settings), options: OPTIONS_PAYLOAD };
}

async function get(req, res) {
  const settings = await clientVideoSettingsRepository.findByClientId(req.session.user.id);
  res.json(toApiWithOptions(settings));
}

async function update(req, res) {
  const {
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
  } = req.body;

  if (!ASPECT_RATIOS.includes(aspectRatio)) return res.status(400).json({ error: 'Proporcao invalida.' });
  if (!FRAMINGS.includes(framing)) return res.status(400).json({ error: 'Enquadramento invalido.' });
  if (!QUALITIES.includes(quality)) return res.status(400).json({ error: 'Qualidade invalida.' });
  if (!CAPTION_STYLES.includes(captionStyle)) return res.status(400).json({ error: 'Estilo de legenda invalido.' });
  if (!TITLE_STYLES.includes(titleStyle)) return res.status(400).json({ error: 'Estilo de titulo invalido.' });
  if (!CLIP_LENGTHS.includes(clipLength)) return res.status(400).json({ error: 'Estilo de corte invalido.' });
  if (!CLIP_MODES.includes(clipMode)) return res.status(400).json({ error: 'Modo de corte invalido.' });
  if (!DESCRIPTION_MODES.includes(descriptionMode)) return res.status(400).json({ error: 'Modo de descricao invalido.' });
  if (!CROP_STYLE_MODES.includes(cropStyleMode)) return res.status(400).json({ error: 'Modo de estilo de corte invalido.' });
  if (!PART_LABEL_POSITIONS.includes(partLabelPosition)) {
    return res.status(400).json({ error: 'Posicao da numeracao de parte invalida.' });
  }
  const maxClipsNum = Number(maxClips);
  if (!Number.isInteger(maxClipsNum) || maxClipsNum < 1 || maxClipsNum > 30) {
    return res.status(400).json({ error: 'Numero de cortes invalido (1 a 30).' });
  }
  const titleSecondsNum = Number(titleSeconds);
  if (!Number.isInteger(titleSecondsNum) || titleSecondsNum < 1 || titleSecondsNum > 15) {
    return res.status(400).json({ error: 'Duracao do titulo invalida (1 a 15s).' });
  }
  const cropZoomPercentNum = Number(cropZoomPercent);
  if (!Number.isInteger(cropZoomPercentNum) || cropZoomPercentNum < 0 || cropZoomPercentNum > 100) {
    return res.status(400).json({ error: 'Zoom de enquadramento invalido (0 a 100).' });
  }
  if (descriptionMode === 'fixed' && !String(descriptionTemplate || '').trim()) {
    return res.status(400).json({ error: 'Escreva a descricao fixa que sera usada.' });
  }

  const saved = await clientVideoSettingsRepository.upsert(req.session.user.id, {
    aspectRatio,
    framing,
    quality,
    captionStyle,
    clipLength,
    clipMode,
    maxClips: maxClipsNum,
    showTitle: Boolean(showTitle),
    titleSeconds: titleSecondsNum,
    descriptionMode,
    descriptionTemplate: descriptionMode === 'fixed' ? String(descriptionTemplate).trim() : null,
    cropStyleMode,
    cropZoomPercent: cropZoomPercentNum,
    showPartLabel: Boolean(showPartLabel),
    partLabelPosition,
    titleStyle,
  });
  res.json(toApiWithOptions(saved));
}

module.exports = { get, update };

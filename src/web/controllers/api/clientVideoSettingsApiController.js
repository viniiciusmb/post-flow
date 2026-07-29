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
const FRAMINGS = ['crop', 'blur_pad'];
const CLIP_LENGTHS = ['short', 'balanced', 'long'];
const CLIP_MODES = ['ai_choice', 'full_video', 'fixed_count'];
const DESCRIPTION_MODES = ['auto', 'fixed', 'none'];

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
  };
}

async function get(req, res) {
  const settings = await clientVideoSettingsRepository.findByClientId(req.session.user.id);
  res.json({
    ...toApi(settings),
    options: {
      aspectRatios: ASPECT_RATIOS,
      framings: FRAMINGS,
      qualities: QUALITIES,
      captionStyles: CAPTION_STYLES,
      clipLengths: CLIP_LENGTHS,
      clipModes: CLIP_MODES,
      descriptionModes: DESCRIPTION_MODES,
    },
  });
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
  } = req.body;

  if (!ASPECT_RATIOS.includes(aspectRatio)) return res.status(400).json({ error: 'Proporcao invalida.' });
  if (!FRAMINGS.includes(framing)) return res.status(400).json({ error: 'Enquadramento invalido.' });
  if (!QUALITIES.includes(quality)) return res.status(400).json({ error: 'Qualidade invalida.' });
  if (!CAPTION_STYLES.includes(captionStyle)) return res.status(400).json({ error: 'Estilo de legenda invalido.' });
  if (!CLIP_LENGTHS.includes(clipLength)) return res.status(400).json({ error: 'Estilo de corte invalido.' });
  if (!CLIP_MODES.includes(clipMode)) return res.status(400).json({ error: 'Modo de corte invalido.' });
  if (!DESCRIPTION_MODES.includes(descriptionMode)) return res.status(400).json({ error: 'Modo de descricao invalido.' });
  const maxClipsNum = Number(maxClips);
  if (!Number.isInteger(maxClipsNum) || maxClipsNum < 1 || maxClipsNum > 30) {
    return res.status(400).json({ error: 'Numero de cortes invalido (1 a 30).' });
  }
  const titleSecondsNum = Number(titleSeconds);
  if (!Number.isInteger(titleSecondsNum) || titleSecondsNum < 1 || titleSecondsNum > 15) {
    return res.status(400).json({ error: 'Duracao do titulo invalida (1 a 15s).' });
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
  });
  res.json(toApi(saved));
}

module.exports = { get, update };

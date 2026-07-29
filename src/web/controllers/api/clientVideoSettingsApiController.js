// Preferencias de edicao de video do cliente: proporcao (9:16 por padrao),
// enquadramento, qualidade, estilo de legenda, "estilo do corte" (duracao) e
// modo de corte (melhores partes / video inteiro / sem limite de cortes).
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../../../services/videoEditingService');

const ASPECT_RATIOS = Object.keys(videoEditingService.ASPECT_RATIOS);
const QUALITIES = Object.keys(videoEditingService.QUALITY_PRESETS);
const CAPTION_STYLES = [...Object.keys(videoEditingService.CAPTION_STYLES), 'none'];
const FRAMINGS = ['crop', 'blur_pad'];
const CLIP_LENGTHS = ['short', 'balanced', 'long'];
const CLIP_MODES = ['best_parts', 'full_video', 'unlimited'];

function toApi(settings) {
  return {
    aspectRatio: settings.aspect_ratio,
    framing: settings.framing,
    quality: settings.quality,
    captionStyle: settings.caption_style,
    clipLength: settings.clip_length,
    clipMode: settings.clip_mode,
    maxClips: settings.max_clips,
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
    },
  });
}

async function update(req, res) {
  const { aspectRatio, framing, quality, captionStyle, clipLength, clipMode, maxClips } = req.body;

  if (!ASPECT_RATIOS.includes(aspectRatio)) return res.status(400).json({ error: 'Proporcao invalida.' });
  if (!FRAMINGS.includes(framing)) return res.status(400).json({ error: 'Enquadramento invalido.' });
  if (!QUALITIES.includes(quality)) return res.status(400).json({ error: 'Qualidade invalida.' });
  if (!CAPTION_STYLES.includes(captionStyle)) return res.status(400).json({ error: 'Estilo de legenda invalido.' });
  if (!CLIP_LENGTHS.includes(clipLength)) return res.status(400).json({ error: 'Estilo de corte invalido.' });
  if (!CLIP_MODES.includes(clipMode)) return res.status(400).json({ error: 'Modo de corte invalido.' });
  const maxClipsNum = Number(maxClips);
  if (!Number.isInteger(maxClipsNum) || maxClipsNum < 1 || maxClipsNum > 30) {
    return res.status(400).json({ error: 'Numero de cortes invalido (1 a 30).' });
  }

  const saved = await clientVideoSettingsRepository.upsert(req.session.user.id, {
    aspectRatio,
    framing,
    quality,
    captionStyle,
    clipLength,
    clipMode,
    maxClips: maxClipsNum,
  });
  res.json(toApi(saved));
}

module.exports = { get, update };

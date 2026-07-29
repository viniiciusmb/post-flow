// Preferencias de edicao de video do cliente: proporcao (9:16 por padrao),
// enquadramento, qualidade, estilo de legenda e "estilo do corte" (duracao).
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../../../services/videoEditingService');

const ASPECT_RATIOS = Object.keys(videoEditingService.ASPECT_RATIOS);
const QUALITIES = Object.keys(videoEditingService.QUALITY_PRESETS);
const CAPTION_STYLES = [...Object.keys(videoEditingService.CAPTION_STYLES), 'none'];
const FRAMINGS = ['crop', 'blur_pad'];
const CLIP_LENGTHS = ['short', 'balanced', 'long'];

function toApi(settings) {
  return {
    aspectRatio: settings.aspect_ratio,
    framing: settings.framing,
    quality: settings.quality,
    captionStyle: settings.caption_style,
    clipLength: settings.clip_length,
    maxClips: settings.max_clips,
  };
}

async function get(req, res) {
  const settings = await clientVideoSettingsRepository.findByClientId(req.session.user.id);
  res.json({
    ...toApi(settings),
    options: { aspectRatios: ASPECT_RATIOS, framings: FRAMINGS, qualities: QUALITIES, captionStyles: CAPTION_STYLES, clipLengths: CLIP_LENGTHS },
  });
}

async function update(req, res) {
  const { aspectRatio, framing, quality, captionStyle, clipLength, maxClips } = req.body;

  if (!ASPECT_RATIOS.includes(aspectRatio)) return res.status(400).json({ error: 'Proporcao invalida.' });
  if (!FRAMINGS.includes(framing)) return res.status(400).json({ error: 'Enquadramento invalido.' });
  if (!QUALITIES.includes(quality)) return res.status(400).json({ error: 'Qualidade invalida.' });
  if (!CAPTION_STYLES.includes(captionStyle)) return res.status(400).json({ error: 'Estilo de legenda invalido.' });
  if (!CLIP_LENGTHS.includes(clipLength)) return res.status(400).json({ error: 'Estilo de corte invalido.' });
  const maxClipsNum = Number(maxClips);
  if (!Number.isInteger(maxClipsNum) || maxClipsNum < 1 || maxClipsNum > 8) {
    return res.status(400).json({ error: 'Numero de cortes invalido (1 a 8).' });
  }

  const saved = await clientVideoSettingsRepository.upsert(req.session.user.id, {
    aspectRatio,
    framing,
    quality,
    captionStyle,
    clipLength,
    maxClips: maxClipsNum,
  });
  res.json(toApi(saved));
}

module.exports = { get, update };

// Preferencias de edicao de video do cliente: proporcao (9:16 por padrao),
// enquadramento, qualidade, estilo de legenda, "estilo do corte" (duracao),
// modo de corte (IA decide / video inteiro / quantidade fixa), titulo
// queimado no video e descricao (auto/fixa).
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../../../services/videoEditingService');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');

const ASPECT_RATIOS = Object.keys(videoEditingService.ASPECT_RATIOS);
const QUALITIES = Object.keys(videoEditingService.QUALITY_PRESETS);
const CAPTION_STYLES = [...Object.keys(videoEditingService.CAPTION_STYLES), 'none'];
const TITLE_STYLES = Object.keys(videoEditingService.TITLE_STYLES);
const FRAMINGS = ['crop', 'blur_pad'];
const CLIP_LENGTHS = ['short', 'balanced', 'long', 'extra_long'];
const FONTS = Object.keys(videoEditingService.FONTES);
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
    captionFont: settings.caption_font,
    titleFont: settings.title_font,
    captionHeightPercent: settings.caption_height_percent,
    titleHeightPercent: settings.title_height_percent,
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
    // Só o fato de existir um template interessa ao front (o arquivo em si é
    // servido por rota própria, nunca por caminho de disco).
    backgroundStyle: settings.background_style || 'blur',
    hasBackgroundTemplate: Boolean(settings.background_template_path),
    backgroundVideoHeightPercent: settings.background_video_height_percent ?? 100,
    backgroundVideoOffsetPercent: settings.background_video_offset_percent ?? 50,
    thumbnailPosition: settings.thumbnail_position || 'top',
  };
}

const OPTIONS_PAYLOAD = {
  aspectRatios: ASPECT_RATIOS,
  framings: FRAMINGS,
  qualities: QUALITIES,
  captionStyles: CAPTION_STYLES,
  fonts: FONTS,
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

// Resolve pra qual "alvo" a requisição se refere: o padrão do cliente
// (?channelId ausente) ou um canal específico. Devolve erro pronto quando o
// canal não é do cliente - é o mesmo cuidado de posse do resto do sistema:
// nunca confiar no id que veio da URL.
async function resolverAlvo(req) {
  const bruto = req.query.channelId ?? req.body?.channelId;
  if (bruto === undefined || bruto === null || bruto === '' || bruto === 'all') {
    return { channelId: null };
  }
  const id = Number(bruto);
  if (!Number.isInteger(id)) return { erro: 'Canal inválido.' };
  const canal = await youtubeChannelsRepository.findById(id);
  if (!canal || String(canal.client_user_id) !== String(req.session.user.id)) {
    return { erro: 'Canal não encontrado.' };
  }
  return { channelId: id };
}

async function get(req, res) {
  const alvo = await resolverAlvo(req);
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const [padrao, canais, comEstiloProprio] = await Promise.all([
    clientVideoSettingsRepository.findByClientId(req.session.user.id),
    youtubeChannelsRepository.listByClientId(req.session.user.id),
    clientVideoSettingsRepository.listChannelOverrides(req.session.user.id),
  ]);

  // Quando pedem um canal que ainda não tem estilo próprio, devolvemos o padrão
  // (é o que ele usa de verdade) marcando usesDefault, pra tela poder dizer
  // "esse canal segue a configuração de todos".
  let settings = padrao;
  let usesDefault = true;
  if (alvo.channelId) {
    const doCanal = await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId);
    if (doCanal) {
      settings = doCanal;
      usesDefault = false;
    }
  }

  res.json({
    ...toApiWithOptions(settings),
    channelId: alvo.channelId,
    usesDefault,
    channels: canais.map((c) => ({
      id: Number(c.id),
      name: c.channel_name || c.youtube_channel_id,
      hasOwnStyle: comEstiloProprio.includes(Number(c.id)),
    })),
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
    cropStyleMode,
    cropZoomPercent,
    showPartLabel,
    partLabelPosition,
    titleStyle,
    captionFont,
    titleFont,
    captionHeightPercent,
    titleHeightPercent,
  } = req.body;

  if (!ASPECT_RATIOS.includes(aspectRatio)) return res.status(400).json({ error: res.locals.t('erros.proporcaoInvalida') });
  if (!FRAMINGS.includes(framing)) return res.status(400).json({ error: res.locals.t('erros.enquadramentoInvalido') });
  if (!QUALITIES.includes(quality)) return res.status(400).json({ error: res.locals.t('erros.qualidadeInvalida') });
  if (!CAPTION_STYLES.includes(captionStyle)) return res.status(400).json({ error: res.locals.t('erros.estiloLegendaInvalido') });
  if (!TITLE_STYLES.includes(titleStyle)) return res.status(400).json({ error: res.locals.t('erros.estiloTituloInvalido') });
  if (!CLIP_LENGTHS.includes(clipLength)) return res.status(400).json({ error: res.locals.t('erros.estiloCorteInvalido') });
  if (!CLIP_MODES.includes(clipMode)) return res.status(400).json({ error: res.locals.t('erros.modoCorteInvalido') });
  if (!DESCRIPTION_MODES.includes(descriptionMode)) return res.status(400).json({ error: res.locals.t('erros.modoDescricaoInvalido') });
  if (!CROP_STYLE_MODES.includes(cropStyleMode)) return res.status(400).json({ error: res.locals.t('erros.modoEstiloInvalido') });
  if (!PART_LABEL_POSITIONS.includes(partLabelPosition)) {
    return res.status(400).json({ error: res.locals.t('erros.posicaoNumeracaoInvalida') });
  }
  const maxClipsNum = Number(maxClips);
  if (!Number.isInteger(maxClipsNum) || maxClipsNum < 1 || maxClipsNum > 30) {
    return res.status(400).json({ error: res.locals.t('erros.numeroCortesInvalido') });
  }
  const titleSecondsNum = Number(titleSeconds);
  if (!Number.isInteger(titleSecondsNum) || titleSecondsNum < 1 || titleSecondsNum > 15) {
    return res.status(400).json({ error: res.locals.t('erros.duracaoTituloInvalida') });
  }
  const cropZoomPercentNum = Number(cropZoomPercent);
  if (!Number.isInteger(cropZoomPercentNum) || cropZoomPercentNum < 0 || cropZoomPercentNum > 100) {
    return res.status(400).json({ error: res.locals.t('erros.zoomInvalido') });
  }
  if (descriptionMode === 'fixed' && !String(descriptionTemplate || '').trim()) {
    return res.status(400).json({ error: res.locals.t('erros.escrevaDescricao') });
  }

  const alvo = await resolverAlvo(req);
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  const backgroundHeight = Number(req.body.backgroundVideoHeightPercent ?? 100);
  const backgroundOffset = Number(req.body.backgroundVideoOffsetPercent ?? 50);
  if (!Number.isInteger(backgroundHeight) || backgroundHeight < 10 || backgroundHeight > 100) {
    return res.status(400).json({ error: res.locals.t('erros.alturaInvalida') });
  }
  if (!Number.isInteger(backgroundOffset) || backgroundOffset < 0 || backgroundOffset > 100) {
    return res.status(400).json({ error: res.locals.t('erros.posicaoVideoInvalida') });
  }

  // O caminho do template não vem do cliente: é preservado do que já está
  // gravado, e só muda pelas rotas de upload/remoção. Aceitar caminho de
  // arquivo vindo do navegador seria deixar o cliente apontar pra qualquer
  // arquivo do servidor.
  const atual = alvo.channelId
    ? (await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId)) ||
      (await clientVideoSettingsRepository.findByClientId(req.session.user.id))
    : await clientVideoSettingsRepository.findByClientId(req.session.user.id);

  // Campo ausente PRESERVA o que ja estava salvo, em vez de cair num padrao.
  // Esta tela e salva por dois cartoes diferentes (qualidade e estilo visual);
  // se um deles nao mandar o campo, um padrao aqui apagaria em silencio a
  // escolha feita no outro. E exatamente o bug que ja aconteceu com os
  // horarios de postagem.
  const ESTILOS_DE_FUNDO = ['blur', 'black', 'white', 'template', 'thumbnail', 'frame'];
  const backgroundStyle = ESTILOS_DE_FUNDO.includes(req.body.backgroundStyle)
    ? req.body.backgroundStyle
    : atual.background_style || 'blur';

  // Escolher "template" sem ter enviado imagem nenhuma renderizaria com o
  // fundo desfocado sem explicar por que - melhor recusar aqui e dizer.
  //
  // O estilo "thumbnail" nao precisa dessa checagem: a imagem e a capa do
  // proprio video, baixada na hora de renderizar - nao ha nada pra enviar.
  if (backgroundStyle === 'template' && !atual.background_template_path) {
    return res.status(400).json({ error: res.locals.t('erros.envieImagemAntes') });
  }

  // Fonte e altura seguem a MESMA regra do estilo de fundo: campo ausente
  // preserva o que ja estava salvo. Esta tela e gravada por dois cartoes
  // diferentes (qualidade e estilo visual), e recusar por campo ausente fazia
  // o cartao de qualidade quebrar ao salvar - ele nao manda fonte nenhuma.
  //
  // Valor PRESENTE e invalido continua sendo recusado: fonte que nao existe no
  // servidor faz o libass trocar por outra em silencio, e o video sai com um
  // visual que ninguem escolheu.
  function resolverFonte(recebida, salva) {
    if (recebida === undefined || recebida === null) return salva || 'Anton';
    return FONTS.includes(recebida) ? recebida : null;
  }
  const fonteLegenda = resolverFonte(captionFont, atual.caption_font);
  const fonteTitulo = resolverFonte(titleFont, atual.title_font);
  if (fonteLegenda === null || fonteTitulo === null) {
    return res.status(400).json({ error: res.locals.t('erros.fonteInvalida') });
  }

  // Altura em % da altura do video. O teto de 80 impede que o texto suba tanto
  // que saia do quadro pelo outro lado.
  function resolverAltura(recebida, salva, padrao) {
    if (recebida === undefined || recebida === null) return salva ?? padrao;
    const n = Number(recebida);
    return Number.isInteger(n) && n >= 0 && n <= 80 ? n : null;
  }
  const captionHeightNum = resolverAltura(captionHeightPercent, atual.caption_height_percent, 14);
  const titleHeightNum = resolverAltura(titleHeightPercent, atual.title_height_percent, 8);
  if (captionHeightNum === null || titleHeightNum === null) {
    return res.status(400).json({ error: res.locals.t('erros.alturaInvalida') });
  }

  // De que lado fica a faixa da capa. Campo ausente preserva o salvo, pelo
  // mesmo motivo do estilo de fundo (dois cartoes salvam esta mesma tela).
  const thumbnailPosition = ['top', 'bottom'].includes(req.body.thumbnailPosition)
    ? req.body.thumbnailPosition
    : atual.thumbnail_position || 'top';

  const saved = await clientVideoSettingsRepository.upsert(req.session.user.id, {
    backgroundStyle,
    backgroundTemplatePath: atual.background_template_path,
    backgroundVideoHeightPercent: backgroundHeight,
    backgroundVideoOffsetPercent: backgroundOffset,
    thumbnailPosition,
    aspectRatio,
    framing,
    quality,
    captionStyle,
    captionFont: fonteLegenda,
    titleFont: fonteTitulo,
    captionHeightPercent: captionHeightNum,
    titleHeightPercent: titleHeightNum,
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
  }, alvo.channelId);
  res.json(toApiWithOptions(saved));
}

// Faz o canal voltar a seguir a configuração de todos os canais.
async function removeChannelStyle(req, res) {
  const id = Number(req.params.channelId);
  const canal = await youtubeChannelsRepository.findById(id);
  if (!canal || String(canal.client_user_id) !== String(req.session.user.id)) {
    return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  }
  await clientVideoSettingsRepository.removeChannelOverride(req.session.user.id, id);
  res.json({ ok: true });
}

module.exports = { get, update, removeChannelStyle, resolverAlvo, toApiWithOptions };

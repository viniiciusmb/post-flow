// Preferencias de edicao de video do cliente: estilo de legenda, "estilo do
// corte" (duracao), modo de corte (IA decide / video inteiro em partes /
// quantidade fixa), titulo queimado no video e descricao (auto/fixa).
//
// Proporcao, enquadramento e qualidade sairam na migration 070 - o corte e
// sempre 9:16 e quem decide o enquadramento e o estilo do corte.
'use strict';

const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const videoEditingService = require('../../../services/videoEditingService');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');

const CAPTION_STYLES = [...Object.keys(videoEditingService.CAPTION_STYLES), 'none'];
const TITLE_STYLES = Object.keys(videoEditingService.TITLE_STYLES);
const CLIP_LENGTHS = ['short', 'balanced', 'long', 'extra_long'];
const FONTS = Object.keys(videoEditingService.FONTES);
const CLIP_MODES = ['ai_choice', 'full_parts', 'fixed_count'];
// Duracao media de cada parte, em minutos, no modo 'full_parts'. O teto de 10
// nao e estetico: e o limite de duracao de video do TikTok.
const FULL_PARTS_MIN_MINUTES = 1;
const FULL_PARTS_MAX_MINUTES = 10;
// Duas formas de dividir o video inteiro: pela duracao media de cada parte
// ('duration', o comportamento original) ou pelo numero de partes ('count').
// Uma decide a outra - o cliente escolhe qual das duas ele quer fixar.
const FULL_PARTS_MODES = ['duration', 'count'];
const FULL_PARTS_MIN_COUNT = 1;
const FULL_PARTS_MAX_COUNT = 30;
const DESCRIPTION_MODES = ['auto', 'fixed', 'none'];
const CROP_STYLE_MODES = ['auto', 'manual'];
const PART_LABEL_POSITIONS = ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right'];

function toApi(settings) {
  return {
    captionStyle: settings.caption_style,
    captionFont: settings.caption_font,
    titleBoxColor: settings.title_box_color,
    captionBoxColor: settings.caption_box_color,
    titleFont: settings.title_font,
    captionHeightPercent: settings.caption_height_percent,
    titleHeightPercent: settings.title_height_percent,
    clipLength: settings.clip_length,
    clipMode: settings.clip_mode,
    fullPartsMode: settings.full_parts_mode || 'duration',
    fullPartsMinutes: settings.full_parts_minutes ?? 3,
    fullPartsCount: settings.full_parts_count ?? 8,
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
  captionStyles: CAPTION_STYLES,
  fonts: FONTS,
  clipLengths: CLIP_LENGTHS,
  clipModes: CLIP_MODES,
  descriptionModes: DESCRIPTION_MODES,
  cropStyleModes: CROP_STYLE_MODES,
  partLabelPositions: PART_LABEL_POSITIONS,
  titleStyles: TITLE_STYLES,
  fullPartsModes: FULL_PARTS_MODES,
  fullPartsMinMinutes: FULL_PARTS_MIN_MINUTES,
  fullPartsMaxMinutes: FULL_PARTS_MAX_MINUTES,
  fullPartsMinCount: FULL_PARTS_MIN_COUNT,
  fullPartsMaxCount: FULL_PARTS_MAX_COUNT,
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
    captionStyle,
    clipLength,
    clipMode,
    fullPartsMode,
    fullPartsMinutes,
    fullPartsCount,
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
    titleBoxColor,
    captionBoxColor,
  } = req.body;

  const alvo = await resolverAlvo(req);
  if (alvo.erro) return res.status(404).json({ error: alvo.erro });

  // O que ja esta gravado precisa ser lido ANTES de validar qualquer coisa:
  // a regra desta rota e "campo ausente preserva o salvo", e sem o salvo em
  // maos nao da pra decidir nada.
  //
  // O caminho do template nao vem do cliente: e preservado daqui e so muda
  // pelas rotas de upload/remocao. Aceitar caminho de arquivo vindo do
  // navegador seria deixar o cliente apontar pra qualquer arquivo do servidor.
  const atual = alvo.channelId
    ? (await clientVideoSettingsRepository.findChannelOverride(req.session.user.id, alvo.channelId)) ||
      (await clientVideoSettingsRepository.findByClientId(req.session.user.id))
    : await clientVideoSettingsRepository.findByClientId(req.session.user.id);

  // ---------------------------------------------------------------------
  // Campo AUSENTE preserva o que ja estava salvo; campo PRESENTE e invalido
  // e recusado.
  //
  // Esta tela e gravada por DOIS cartoes (qualidade/quantidade e estilo
  // visual), cada um mandando so o que edita. Exigir o campo inteiro de todo
  // mundo obrigava cada cartao a reenviar os campos do outro - e o que ele
  // reenviava era a copia carregada quando a pagina abriu, apagando o que o
  // cliente tinha acabado de escolher no outro cartao. Foi o bug de
  // "configuracao que nao salva" relatado em 22/08/2026.
  // ---------------------------------------------------------------------
  const invalidos = [];

  function daLista(recebido, salvo, lista, erro, padrao) {
    if (recebido === undefined || recebido === null) return salvo ?? padrao;
    if (!lista.includes(recebido)) {
      invalidos.push(erro);
      return null;
    }
    return recebido;
  }

  function inteiro(recebido, salvo, min, max, erro, padrao) {
    if (recebido === undefined || recebido === null) return salvo ?? padrao;
    const n = Number(recebido);
    if (!Number.isInteger(n) || n < min || n > max) {
      invalidos.push(erro);
      return null;
    }
    return n;
  }

  const estiloLegenda = daLista(captionStyle, atual.caption_style, CAPTION_STYLES, 'erros.estiloLegendaInvalido', 'classic');
  const estiloTitulo = daLista(titleStyle, atual.title_style, TITLE_STYLES, 'erros.estiloTituloInvalido', 'classic');
  const duracaoCorte = daLista(clipLength, atual.clip_length, CLIP_LENGTHS, 'erros.estiloCorteInvalido', 'balanced');
  const modoCorte = daLista(clipMode, atual.clip_mode, CLIP_MODES, 'erros.modoCorteInvalido', 'ai_choice');
  const modoDescricao = daLista(descriptionMode, atual.description_mode, DESCRIPTION_MODES, 'erros.modoDescricaoInvalido', 'auto');
  const modoEstilo = daLista(cropStyleMode, atual.crop_style_mode, CROP_STYLE_MODES, 'erros.modoEstiloInvalido', 'auto');
  const posicaoNumeracao = daLista(
    partLabelPosition, atual.part_label_position, PART_LABEL_POSITIONS, 'erros.posicaoNumeracaoInvalida', 'top_right'
  );

  const maxClipsNum = inteiro(maxClips, atual.max_clips, 1, 30, 'erros.numeroCortesInvalido', 4);
  const minutosPorParte = inteiro(
    fullPartsMinutes, atual.full_parts_minutes,
    FULL_PARTS_MIN_MINUTES, FULL_PARTS_MAX_MINUTES, 'erros.duracaoParteInvalida', 3
  );
  const modoDasPartes = daLista(
    fullPartsMode, atual.full_parts_mode, FULL_PARTS_MODES, 'erros.modoPartesInvalido', 'duration'
  );
  const quantidadeDePartes = inteiro(
    fullPartsCount, atual.full_parts_count,
    FULL_PARTS_MIN_COUNT, FULL_PARTS_MAX_COUNT, 'erros.quantidadePartesInvalida', 8
  );
  const titleSecondsNum = inteiro(titleSeconds, atual.title_seconds, 1, 15, 'erros.duracaoTituloInvalida', 3);
  const cropZoomPercentNum = inteiro(cropZoomPercent, atual.crop_zoom_percent, 0, 100, 'erros.zoomInvalido', 100);
  const backgroundHeight = inteiro(
    req.body.backgroundVideoHeightPercent, atual.background_video_height_percent, 10, 100, 'erros.alturaInvalida', 100
  );
  const backgroundOffset = inteiro(
    req.body.backgroundVideoOffsetPercent, atual.background_video_offset_percent, 0, 100, 'erros.posicaoVideoInvalida', 50
  );

  if (invalidos.length) return res.status(400).json({ error: res.locals.t(invalidos[0]) });

  // Descricao fixa sem texto nenhum renderizaria legenda vazia no TikTok.
  // So checa quando a descricao veio nesta chamada: o cartao de estilo nao
  // manda descricao, e nao pode ser barrado por causa dela.
  const descricaoVeio = descriptionTemplate !== undefined;
  const descricaoFinal = descricaoVeio ? descriptionTemplate : atual.description_template;
  if (modoDescricao === 'fixed' && !String(descricaoFinal || '').trim()) {
    return res.status(400).json({ error: res.locals.t('erros.escrevaDescricao') });
  }

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

  // Cor da caixa / do papel rasgado. Mesma regra de campo ausente preservar o
  // salvo; valor presente tem que ser um hexadecimal de 6 digitos, senao a
  // conversao pro formato do ffmpeg produz uma cor plausivel mas trocada.
  const HEX = /^#[0-9a-fA-F]{6}$/;
  function resolverCor(recebida, salva) {
    if (recebida === undefined || recebida === null) return salva || '#D92323';
    return HEX.test(String(recebida)) ? String(recebida).toUpperCase() : null;
  }
  const corTitulo = resolverCor(titleBoxColor, atual.title_box_color);
  const corLegenda = resolverCor(captionBoxColor, atual.caption_box_color);
  if (corTitulo === null || corLegenda === null) {
    return res.status(400).json({ error: res.locals.t('erros.corInvalida') });
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
    captionStyle: estiloLegenda,
    captionFont: fonteLegenda,
    titleBoxColor: corTitulo,
    captionBoxColor: corLegenda,
    titleFont: fonteTitulo,
    captionHeightPercent: captionHeightNum,
    titleHeightPercent: titleHeightNum,
    clipLength: duracaoCorte,
    clipMode: modoCorte,
    fullPartsMode: modoDasPartes,
    fullPartsMinutes: minutosPorParte,
    fullPartsCount: quantidadeDePartes,
    maxClips: maxClipsNum,
    // Booleano ausente tambem preserva: Boolean(undefined) daria false, e o
    // cartao de qualidade (que nao manda nenhum dos dois) desligaria o titulo
    // e a numeracao do cliente sem ele pedir.
    showTitle: showTitle === undefined ? atual.show_title : Boolean(showTitle),
    titleSeconds: titleSecondsNum,
    descriptionMode: modoDescricao,
    descriptionTemplate: modoDescricao === 'fixed' ? String(descricaoFinal).trim() : null,
    cropStyleMode: modoEstilo,
    cropZoomPercent: cropZoomPercentNum,
    // No modo de partes a numeracao nao e opcional: sem "Parte 1 / Parte 2"
    // as fatias chegam no TikTok sem ordem nenhuma e quem assiste nao sabe
    // por onde comecar. Forcado no SERVIDOR, nao so na tela - a tela marca e
    // desabilita o campo, mas um PUT direto passaria por cima.
    showPartLabel:
      modoCorte === 'full_parts'
        ? true
        : showPartLabel === undefined
          ? atual.show_part_label
          : Boolean(showPartLabel),
    partLabelPosition: posicaoNumeracao,
    titleStyle: estiloTitulo,
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

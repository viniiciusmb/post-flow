'use strict';

const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const youtubeChannelService = require('../../../services/youtubeChannelService');
const driveConnectionsRepository = require('../../../repositories/driveConnectionsRepository');
const driveFoldersRepository = require('../../../repositories/driveFoldersRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const planLimitsService = require('../../../services/planLimitsService');
const ytDlpService = require('../../../services/ytDlpService');
const queueService = require('../../../services/queueService');
const queuePriorityService = require('../../../services/queuePriorityService');
const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const idiomaDoAudio = require('../../../lib/idiomaDoAudio');
const locales = require('../../../config/locales');
const driveExportFolderService = require('../../../services/driveExportFolderService');
const logger = require('../../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function list(req, res) {
  const [channels, tiktokAccounts] = await Promise.all([
    youtubeChannelsRepository.listByClientId(req.session.user.id),
    tiktokAccountsRepository.listActiveByClientId(req.session.user.id),
  ]);
  const exportFolders = await driveFoldersRepository.findExportFoldersByChannelIds(channels.map((c) => c.id));
  const exportFolderByChannel = new Map(exportFolders.map((f) => [f.youtube_channel_id, f]));
  const tiktokAccountById = new Map(tiktokAccounts.map((a) => [a.id, a]));
  // Videos deste canal parados por serem exclusivos de membros. A tela avisa
  // aqui tambem (e nao so em "Videos & Cortes") porque e o canal que explica
  // por que ele parou de trazer video novo - quem esta olhando o canal e quem
  // esta com essa duvida.
  const somenteMembrosPorCanal = await sourceVideosRepository.countMembersOnlyByChannelIds(channels.map((c) => c.id));

  res.json({
    channels: channels.map((c) => {
      const exportFolder = exportFolderByChannel.get(c.id);
      const tiktokAccount = c.tiktok_account_id ? tiktokAccountById.get(c.tiktok_account_id) : null;
      return {
        id: c.id,
        channelName: c.channel_name,
        channelUrl: c.channel_url,
        avatarUrl: c.avatar_url,
        isActive: c.is_active,
        lastPolledAt: c.last_polled_at,
        lastCheckAt: c.last_check_at,
        lastCheckOk: c.last_check_ok,
        lastCheckError: c.last_check_error,
        checkFailCount: c.check_fail_count,
        exportFolder: exportFolder ? { id: exportFolder.drive_folder_id, name: exportFolder.folder_name } : null,
        driveExportMode: c.drive_export_mode,
        processOnlyWhenQueueClear: c.process_only_when_queue_clear,
        tiktokAccountId: c.tiktok_account_id,
        tiktokAccountName: tiktokAccount ? tiktokAccount.display_name || tiktokAccount.tiktok_open_id : null,
        membersOnlyCount: somenteMembrosPorCanal.get(Number(c.id)) || 0,
      };
    }),
  });
}

// Quais idiomas de audio o video mais recente do canal oferece.
//
// Canal grande publica o mesmo video dublado em varias linguas (verificado no
// MrBeast Gaming: 13 trilhas). Perguntar isso AGORA, na hora de conectar o
// canal, e o unico momento em que a pergunta e barata pro cliente: depois ele
// teria que descobrir sozinho que existe uma tela de estilo com um seletor de
// idioma la dentro.
//
// MELHOR ESFORCO, igual a busca do video mais recente. Ler as trilhas exige
// extracao completa do video, que o YouTube BLOQUEIA quando sai direto do IP da
// VPS (confirmado ao vivo: "Sign in to confirm you're not a bot") - entao ela
// depende do tunel ou do proxy estar de pe. Falhar aqui nao pode impedir
// ninguem de cadastrar um canal: a tela so deixa de oferecer a escolha, e o
// canal segue o padrao do cliente, que e o que acontecia antes de tudo isso
// existir.
async function trilhasDoVideo(videoId, req) {
  try {
    const meta = await ytDlpService.getVideoMetadata(`https://www.youtube.com/watch?v=${videoId}`);
    const trilhas = meta.audioLanguages || [];
    // Uma trilha so (ou nenhuma declarada) nao e escolha nenhuma - um seletor
    // com uma opcao e ruido numa tela que ja tem uma decisao pra tomar.
    if (trilhas.length < 2) return {};
    return {
      audioLanguages: trilhas,
      // O idioma do painel e o melhor palpite sobre em que lingua a pessoa quer
      // publicar: ela esta lendo a tela nele.
      audioLanguageSuggestion: idiomaDoAudio.sugestaoPara(locales.resolverDaRequisicao(req), trilhas),
    };
  } catch (err) {
    logger.warn(`Nao consegui ler as trilhas de audio do video ${videoId} (seguindo sem oferecer a escolha): ${err.message}`);
    return {};
  }
}

async function create(req, res) {
  const { channelUrl } = req.body;
  if (!channelUrl) {
    return res.status(400).json({ error: res.locals.t('erros.informeCanal') });
  }

  const currentCount = await youtubeChannelsRepository.countByClientId(req.session.user.id);
  const limitCheck = await planLimitsService.checkChannelLimit(req.session.user.id, currentCount);
  if (!limitCheck.allowed) {
    return res.status(403).json({ error: limitCheck.reason });
  }

  let resolved;
  try {
    resolved = await youtubeChannelService.resolveChannel(channelUrl);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let channel = await youtubeChannelsRepository.create({
    clientUserId: req.session.user.id,
    youtubeChannelId: resolved.channelId,
    channelName: resolved.channelName,
    channelUrl: resolved.channelUrl,
    avatarUrl: resolved.avatarUrl,
  });

  if (!channel) {
    return res.status(409).json({ error: res.locals.t('erros.canalJaCadastrado') });
  }

  // Cliente com uma unica conta TikTok: ja vincula sozinho (sem isso ele
  // teria que ir na tela Cortes so pra escolher a unica opcao possivel).
  const tiktokAccounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  if (tiktokAccounts.length === 1) {
    channel = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, tiktokAccounts[0].id);
  }

  // Melhor esforco: busca so o video mais recente do canal (sem baixar,
  // rapido) pra oferecer "quer processar esse ja?" na hora - se falhar (canal
  // sem video, yt-dlp indisponivel etc), nao atrapalha o cadastro do canal
  // em si, so fica sem essa sugestao.
  let latestVideo = null;
  try {
    const [video] = await ytDlpService.listChannelVideos(resolved.channelUrl, { limit: 1 });
    if (video) {
      latestVideo = {
        videoId: video.videoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds,
        publishedAt: video.publishedAt,
        // Preenchidos logo abaixo, se der. Ausentes = a tela nao pergunta
        // idioma nenhum, e o canal segue o padrao do cliente.
        audioLanguages: [],
        audioLanguageSuggestion: idiomaDoAudio.ORIGINAL,
      };
      Object.assign(latestVideo, await trilhasDoVideo(video.videoId, req));
    }
  } catch (err) {
    logger.error(`Falha ao buscar o video mais recente do canal recem-cadastrado ${channel.id}:`, err);
  }

  res.status(201).json({
    channel: {
      id: channel.id,
      channelName: channel.channel_name,
      channelUrl: channel.channel_url,
      avatarUrl: channel.avatar_url,
      isActive: channel.is_active,
      lastPolledAt: channel.last_polled_at,
      lastCheckAt: channel.last_check_at,
      lastCheckOk: channel.last_check_ok,
      lastCheckError: channel.last_check_error,
      checkFailCount: channel.check_fail_count ?? 0,
      exportFolder: null,
      driveExportMode: channel.drive_export_mode,
      processOnlyWhenQueueClear: channel.process_only_when_queue_clear,
      tiktokAccountId: channel.tiktok_account_id,
      tiktokAccountName: tiktokAccounts.length === 1 ? tiktokAccounts[0].display_name || tiktokAccounts[0].tiktok_open_id : null,
      // Canal recem-cadastrado nunca tem video com selo ainda.
      membersOnlyCount: 0,
    },
    latestVideo,
  });
}

// Cliente aceitou o popup "quer processar o video mais recente agora?" -
// busca o video de novo (nao confia em metadado vindo do cliente) e entra
// na fila igual um video de canal normal (mesma funcao createIfNotExists
// que o channelCheckJob usa) - nao mexe no watermark (last_video_id), que
// so e definido pela primeira checagem periodica do canal.
async function processLatestVideo(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  }

  let video;
  try {
    [video] = await ytDlpService.listChannelVideos(channel.channel_url, { limit: 1 });
  } catch (err) {
    logger.error(`Falha ao buscar o video mais recente do canal ${channel.id} pra processar agora:`, err);
    return res.status(502).json({ error: `Nao foi possivel ler os dados do canal: ${err.message}` });
  }
  if (!video) {
    return res.status(404).json({ error: res.locals.t('erros.canalSemVideo') });
  }

  const sourceVideo = await sourceVideosRepository.createIfNotExists({
    youtubeChannelId: channel.id,
    ownerClientUserId: req.session.user.id,
    youtubeVideoId: video.videoId,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
  });
  if (!sourceVideo) {
    return res.status(409).json({ error: res.locals.t('erros.videoJaProcessado') });
  }

  const boss = await queueService.getBoss();
  const priority = await queuePriorityService.resolveQueuePriorityForClient(req.session.user.id);
  await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });

  res.status(201).json({ id: sourceVideo.id, title: sourceVideo.title, status: sourceVideo.status });
}

async function setTiktokAccount(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  }

  const rawId = req.body.tiktokAccountId;
  if (rawId === null || rawId === undefined || rawId === '') {
    const updated = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, null);
    return res.json({ tiktokAccountId: updated.tiktok_account_id });
  }

  const tiktokAccountId = Number(rawId);
  const account = await tiktokAccountsRepository.findActiveByIdAndClient(tiktokAccountId, req.session.user.id);
  if (!account) {
    return res.status(400).json({ error: res.locals.t('erros.contaTiktokInvalida') });
  }

  const updated = await youtubeChannelsRepository.setTiktokAccount(channel.id, req.session.user.id, account.id);
  res.json({ tiktokAccountId: updated.tiktok_account_id, tiktokAccountName: account.display_name || account.tiktok_open_id });
}

async function setActive(req, res) {
  const channel = await youtubeChannelsRepository.setActive(
    Number(req.params.id),
    req.session.user.id,
    req.body.isActive === true
  );
  if (!channel) return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  res.json({ channel: { id: channel.id, isActive: channel.is_active } });
}

// Freio de engarrafamento: so pega video novo quando a fila de postagem
// daquele canal esta quase vazia (ver channelCheckJob).
async function setQueueGate(req, res) {
  const channel = await youtubeChannelsRepository.setProcessOnlyWhenQueueClear(
    Number(req.params.id),
    req.session.user.id,
    req.body.ativo === true
  );
  if (!channel) return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  res.json({ channel: { id: channel.id, processOnlyWhenQueueClear: channel.process_only_when_queue_clear } });
}

async function remove(req, res) {
  await youtubeChannelsRepository.remove(Number(req.params.id), req.session.user.id);
  res.status(204).end();
}

// Pasta de destino no Drive - pra onde os cortes gerados a partir desse
// canal sao enviados automaticamente (copia de seguranca). Precisa da
// conexao Google do proprio cliente ja existente (ver clientDriveApiController).
async function setExportFolder(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || channel.client_user_id !== req.session.user.id) {
    return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  }

  const connection = await driveConnectionsRepository.findByOwnerId(req.session.user.id);
  if (!connection) {
    return res.status(400).json({ error: res.locals.t('erros.conecteDriveConfig') });
  }

  // NOS criamos a pasta, o cliente nao cola link nenhum.
  //
  // Com o escopo `drive.file` (o unico que temos desde 02/08/2026) o Post Flow
  // so enxerga o que ele mesmo criou: uma pasta que o cliente fez a mao responde
  // 404 "File not found". A tela aceitava o link, gravava, e os cortes nunca
  // chegavam la - era esse o "adicionei a pasta e nao vai" (01/09/2026).
  let folder;
  try {
    folder = await driveExportFolderService.garantirPasta(channel, connection);
  } catch (err) {
    logger.error(`Falha ao preparar a pasta de destino do canal ${channel.id}:`, err);
    // 502: o problema esta do lado do Google, nao no que o cliente mandou. Um
    // 400 aqui faria a tela dizer "voce errou alguma coisa", que nao e verdade.
    return res.status(502).json({ error: err.message });
  }

  // Ao cadastrar a pasta, o cliente ja pode marcar "salvar automaticamente"
  // de uma vez (checkbox no mesmo formulario) - sem isso o modo continua
  // 'manual' (padrao) e o cliente escolhe corte a corte.
  const updatedChannel =
    req.body.autoMode === true
      ? await youtubeChannelsRepository.setDriveExportMode(channel.id, req.session.user.id, 'auto')
      : channel;

  res.json({
    exportFolder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink, criada: folder.criada },
    driveExportMode: updatedChannel.drive_export_mode,
  });
}

// Liga/desliga o envio automatico sem mexer na pasta ja configurada.
async function setDriveExportMode(req, res) {
  const mode = req.body.mode === 'auto' ? 'auto' : 'manual';
  const channel = await youtubeChannelsRepository.setDriveExportMode(Number(req.params.id), req.session.user.id, mode);
  if (!channel) return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  res.json({ driveExportMode: channel.drive_export_mode });
}

// Grava o idioma de audio escolhido no pop-up de cadastro do canal.
//
// Rota propria, e nao a de "configuracoes de video" que ja existe, porque a
// tela de Canais nunca carregou as configuracoes de corte do cliente - mandar
// ela gravar a linha inteira faria o pop-up apagar em silencio o estilo que o
// cliente ja tinha escolhido (ver setChannelAudioLanguage).
//
// Vale nos DOIS caminhos do pop-up: aceitar processar o video mais recente e
// recusar. Recusar so quer dizer "nao processe ESTE video"; a escolha de idioma
// e sobre o canal, e continua valendo pros proximos.
async function setAudioLanguage(req, res) {
  const channel = await youtubeChannelsRepository.findById(Number(req.params.id));
  if (!channel || String(channel.client_user_id) !== String(req.session.user.id)) {
    return res.status(404).json({ error: res.locals.t('erros.canalNaoEncontrado') });
  }

  const { audioLanguage } = req.body;
  // Um canal pode dublar numa lingua que nao esta na nossa lista de nomes, e o
  // seletor da tela oferece o que o VIDEO tem. Por isso a checagem aqui e de
  // FORMATO (codigo ISO, com ou sem regiao), nao de pertencer a lista - recusar
  // 'sv' porque ele nao esta no menu barraria uma escolha legitima que a
  // propria tela ofereceu.
  //
  // A checagem e feita no valor CRU, antes de normalizar. Normalizar primeiro
  // corta tudo depois do hifen, entao "nao-e-idioma-nenhum" viraria "nao" e
  // passaria por um codigo de 3 letras valido - o filtro deixaria entrar
  // justamente o lixo que ele existe pra barrar.
  const bruto = String(audioLanguage ?? '').trim();
  if (!/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/.test(bruto) && bruto.toLowerCase() !== idiomaDoAudio.ORIGINAL) {
    return res.status(400).json({ error: res.locals.t('erros.idiomaAudioInvalido') });
  }
  const codigo = idiomaDoAudio.normalizar(bruto);

  const salvo = await clientVideoSettingsRepository.setChannelAudioLanguage(
    req.session.user.id,
    channel.id,
    codigo
  );
  res.json({ audioLanguage: salvo.audio_language });
}

module.exports = {
  list,
  create,
  setActive,
  setQueueGate,
  remove,
  setExportFolder,
  setDriveExportMode,
  setTiktokAccount,
  processLatestVideo,
  setAudioLanguage,
};

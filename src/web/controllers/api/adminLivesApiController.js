// Tela "Lives" (cortes de lives da Twitch) - MODO DE VALIDACAO, so admin.
// Tudo aqui opera sobre o usuario logado: os canais que ELE acompanha e os
// cortes feitos pra ELE. Quando o modulo for aberto a clientes, a mesma API
// serve, trocando so a rota/permissao.
'use strict';

const fs = require('fs');
const livesRepository = require('../../../repositories/livesRepository');
const livesSettings = require('../../../services/lives/livesSettings');
const twitchApi = require('../../../services/lives/twitchApi');
const liveCleanupService = require('../../../services/lives/liveCleanupService');
const config = require('../../../config');
const { resolveRange } = require('../../../lib/dateRanges');
const livesUserSettings = require('../../../services/lives/livesUserSettings');
const clientVideoSettingsRepository = require('../../../repositories/clientVideoSettingsRepository');
const { toApiWithOptions, validarEstilo } = require('./clientVideoSettingsApiController');

// "Clipar agora" pega os ultimos ~150s: tempo de a pessoa ver o momento,
// reagir e clicar, com a preparacao do momento inclusa.
const JANELA_CLIPAR_AGORA_S = 150;

function numero(v) {
  return v === null || v === undefined ? null : Number(v);
}

function canalParaApi(c) {
  return {
    id: Number(c.id),
    login: c.login,
    nome: c.display_name || c.login,
    imagem: c.profile_image_url,
    aoVivo: c.is_live,
    tituloDaLive: c.stream_title,
    jogo: c.game_name,
    espectadores: numero(c.viewer_count),
    ultimaChecagem: c.last_checked_at,
    ultimaVezAoVivo: c.last_live_at,
    ultimaGravacao: c.ultima_gravacao,
    gravacao: c.session_id
      ? {
          sessaoId: Number(c.session_id),
          desde: c.session_started_at,
          segundosGravados: Number(c.session_recorded_seconds),
          bytes: Number(c.session_bytes),
        }
      : null,
    cortesProntos: Number(c.clips_prontos || 0),
    cortesEmAndamento: Number(c.clips_em_andamento || 0),
  };
}

function corteParaApi(k) {
  const temArquivo = Boolean(k.local_clip_path) && fs.existsSync(k.local_clip_path);
  return {
    id: Number(k.id),
    canal: { id: Number(k.live_channel_id), login: k.login, nome: k.display_name || k.login },
    origem: k.source,
    inicio: Number(k.start_offset),
    fim: Number(k.end_offset),
    duracao: Number(k.end_offset) - Number(k.start_offset),
    titulo: k.title,
    gancho: k.hook,
    nota: numero(k.score),
    status: k.status,
    progresso: k.render_progress,
    erro: k.error_message,
    criadoEm: k.created_at,
    prontoEm: k.ready_at,
    temArquivo,
    temCapa: Boolean(k.thumbnail_path) && fs.existsSync(k.thumbnail_path),
  };
}

function opcoesParaApi(c) {
  return {
    usarEstiloDosVideos: c.usar_estilo_dos_videos,
    qualidade: c.qualidade,
    cameraModo: c.camera_modo,
    cameraPosicao: c.camera_posicao,
    cameraAlturaPercent: c.camera_altura_percent,
  };
}

async function estado(req, res) {
  const userId = req.session.user.id;
  const [ligadoNoPainel, cfg, canais, custoHoje, custo7d, opcoes] = await Promise.all([
    require('../../../repositories/settingsRepository').getValue('lives_enabled', false),
    livesSettings.obterConfig(),
    livesRepository.listChannelsForUser(userId),
    livesRepository.costSummary(resolveRange('today').since),
    livesRepository.costSummary(resolveRange('last7days').since),
    livesUserSettings.obter(userId),
  ]);
  let discoPercent = null;
  try {
    discoPercent = liveCleanupService.usoDoDiscoPercent();
  } catch {
    // Pasta de trabalho ainda nao existe (ambiente novo) - so nao mostra.
  }
  res.json({
    ligado: ligadoNoPainel === true,
    // Motivos pelos quais o modulo NAO roda mesmo ligado no painel - a tela
    // mostra em vez de o botao parecer ligado e nada acontecer.
    bloqueios: [
      ...(config.lives.forcarDesligado ? ['O servidor esta com LIVES_ENABLED=false.'] : []),
      ...(twitchApi.configurado() ? [] : ['TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET nao configurados no servidor.']),
    ],
    config: cfg,
    limites: { faixas: livesSettings.FAIXAS, qualidades: livesSettings.QUALIDADES },
    discoPercent,
    canais: canais.map(canalParaApi),
    custos: { hoje: custoHoje, seteDias: custo7d },
    opcoes: opcoesParaApi(opcoes),
    niveis: livesUserSettings.NIVEIS,
  });
}

// Opcoes dos cortes de live do usuario: qualidade, camera e se o estilo
// visual e o mesmo dos cortes de video. Campo ausente preserva o salvo.
async function salvarOpcoes(req, res) {
  const userId = req.session.user.id;
  const atual = await livesUserSettings.obter(userId);
  const b = req.body || {};
  const nova = { ...atual };
  if (b.qualidade !== undefined) {
    const q = Number(b.qualidade);
    if (!Number.isInteger(q) || q < 1 || q > 5) return res.status(400).json({ error: 'Qualidade vai de 1 a 5.' });
    nova.qualidade = q;
  }
  if (b.cameraModo !== undefined) {
    if (!['auto', 'desligado'].includes(b.cameraModo)) return res.status(400).json({ error: 'Opcao de camera invalida.' });
    nova.camera_modo = b.cameraModo;
  }
  if (b.cameraPosicao !== undefined) {
    if (!['top', 'bottom'].includes(b.cameraPosicao)) return res.status(400).json({ error: 'Posicao da camera invalida.' });
    nova.camera_posicao = b.cameraPosicao;
  }
  if (b.cameraAlturaPercent !== undefined) {
    const a = Number(b.cameraAlturaPercent);
    if (!Number.isInteger(a) || a < 20 || a > 60) return res.status(400).json({ error: 'Altura da camera vai de 20% a 60%.' });
    nova.camera_altura_percent = a;
  }
  if (b.usarEstiloDosVideos !== undefined) {
    nova.usar_estilo_dos_videos = Boolean(b.usarEstiloDosVideos);
    // Primeira vez com estilo proprio: nasce IGUAL ao dos videos, pra pessoa
    // ajustar a partir do que ja conhece em vez de comecar do zero.
    if (!nova.usar_estilo_dos_videos && !Object.keys(atual.estilo || {}).length) {
      nova.estilo = estiloSoVisual(await clientVideoSettingsRepository.resolveForVideo(userId));
    }
  }
  await livesRepository.upsertClipSettings(userId, nova);
  return estado(req, res);
}

// Do registro do estilo, so o que e visual. Quantidade/modo/idioma dos cortes
// de video nao tem sentido numa live, e a imagem enviada (template) mora no
// estilo de video - nao e copiada.
function estiloSoVisual(linha) {
  const { id, client_user_id, youtube_channel_id, source_video_id, created_at, updated_at, background_template_path, ...resto } = linha || {};
  return { ...resto, background_style: ['template', 'thumbnail'].includes(resto.background_style) ? 'blur' : resto.background_style };
}

// Estilo visual dos cortes de live - mesmo formato de resposta do estilo de
// video, pra o MESMO editor da tela servir aos dois (ClipStyleEditorCard em
// modoLive).
async function obterEstilo(req, res) {
  const userId = req.session.user.id;
  const cfg = await livesUserSettings.obter(userId);
  const base = cfg.usar_estilo_dos_videos
    ? estiloSoVisual(await clientVideoSettingsRepository.resolveForVideo(userId))
    : { ...clientVideoSettingsRepository.DEFAULTS, ...cfg.estilo };
  res.json({ ...toApiWithOptions(base), channels: [], channelId: null, usesDefault: false });
}

// Salvar pelo editor liga o estilo proprio (quem editou quer que valha).
async function salvarEstilo(req, res) {
  const userId = req.session.user.id;
  const cfg = await livesUserSettings.obter(userId);
  const atual = cfg.usar_estilo_dos_videos && !Object.keys(cfg.estilo || {}).length
    ? estiloSoVisual(await clientVideoSettingsRepository.resolveForVideo(userId))
    : { ...clientVideoSettingsRepository.DEFAULTS, ...cfg.estilo };
  const corpo = { ...(req.body || {}) };
  if (['template', 'thumbnail'].includes(corpo.backgroundStyle)) {
    return res.status(400).json({ error: 'Nos cortes de live o fundo nao pode ser imagem enviada nem capa do video.' });
  }
  const validado = validarEstilo(corpo, { ...atual, background_template_path: null });
  if (validado.erro) return res.status(400).json({ error: res.locals.t(validado.erro) });
  const linha = estiloSoVisual(clientVideoSettingsRepository.doCamelParaColuna(validado.entrada));
  await livesRepository.upsertClipSettings(userId, { ...cfg, usar_estilo_dos_videos: false, estilo: linha });
  res.json({ ...toApiWithOptions({ ...clientVideoSettingsRepository.DEFAULTS, ...linha }), channels: [], channelId: null, usesDefault: false });
}

async function salvarConfig(req, res) {
  const { ligado, config: nova } = req.body || {};
  if (typeof ligado === 'boolean') await livesSettings.ligar(ligado);
  if (nova && typeof nova === 'object') await livesSettings.salvarConfig(nova);
  return estado(req, res);
}

async function adicionarCanal(req, res) {
  const login = twitchApi.normalizarLogin(req.body?.canal);
  if (!login) return res.status(400).json({ error: 'Nome de canal da Twitch invalido. Use o nome que aparece em twitch.tv/nome.' });
  if (!twitchApi.configurado()) return res.status(503).json({ error: 'A Twitch nao esta configurada no servidor.' });
  let usuario;
  try {
    usuario = await twitchApi.buscarUsuario(login);
  } catch (err) {
    return res.status(502).json({ error: `Nao consegui consultar a Twitch agora: ${err.message}` });
  }
  if (!usuario) return res.status(404).json({ error: `Nao existe canal twitch.tv/${login}.` });
  const canal = await livesRepository.upsertChannel({
    login: usuario.login,
    displayName: usuario.nome,
    platformUserId: usuario.id,
    profileImageUrl: usuario.imagem,
  });
  await livesRepository.follow(req.session.user.id, canal.id);
  return estado(req, res);
}

async function removerCanal(req, res) {
  const id = Number(req.params.id);
  const removeu = await livesRepository.unfollow(req.session.user.id, id);
  if (!removeu) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  // A gravacao (se houver) para na proxima volta do supervisor, quando ele
  // ver que ninguem mais acompanha o canal - nada e apagado aqui.
  return estado(req, res);
}

async function cliparAgora(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  if (!(await livesRepository.isFollowing(userId, id))) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  const sessao = await livesRepository.recordingSessionForChannel(id);
  if (!sessao) return res.status(409).json({ error: 'Esse canal nao esta sendo gravado agora - so da pra clipar durante a gravacao.' });
  const fim = Number(sessao.recorded_seconds);
  if (fim < 20) return res.status(409).json({ error: 'A gravacao acabou de comecar - espere alguns segundos.' });
  const inicio = Math.max(0, fim - JANELA_CLIPAR_AGORA_S);
  const candidato = await livesRepository.insertCandidate({
    sessionId: sessao.id,
    source: 'clipar_agora',
    inicio,
    fim,
    requestedBy: userId,
    status: 'escolhido',
  });
  const corte = await livesRepository.insertClip({
    sessionId: sessao.id,
    channelId: id,
    userId,
    candidateId: candidato.id,
    source: 'clipar_agora',
    inicio,
    fim,
  });
  res.status(201).json({ id: Number(corte.id) });
}

async function listarCortes(req, res) {
  const canal = req.query.canal ? Number(req.query.canal) : null;
  const ordem = req.query.ordem === 'nota' ? 'nota' : 'recentes';
  const cortes = await livesRepository.listClipsForUser(req.session.user.id, { channelId: canal, ordem });
  res.json({ cortes: cortes.map(corteParaApi) });
}

async function arquivoDoCorte(req, res) {
  const corte = await livesRepository.findClipForUser(Number(req.params.id), req.session.user.id);
  const caminho = req.query.capa ? corte?.thumbnail_path : corte?.local_clip_path;
  if (!caminho || !fs.existsSync(caminho)) return res.status(404).json({ error: 'Arquivo nao encontrado.' });
  if (req.query.download) {
    const nome = `${(corte.title || `corte-${corte.id}`).replace(/[^\w\- ]+/g, '').trim() || `corte-${corte.id}`}.mp4`;
    return res.download(caminho, nome);
  }
  // sendFile atende pedido parcial (Range), que o <video> do navegador usa
  // pra avancar no meio do corte sem baixar tudo.
  return res.sendFile(caminho);
}

async function apagarCorte(req, res) {
  const corte = await livesRepository.deleteClip(Number(req.params.id), req.session.user.id);
  if (!corte) return res.status(404).json({ error: 'Corte nao encontrado.' });
  for (const f of [corte.local_clip_path, corte.thumbnail_path]) if (f) fs.rm(f, { force: true }, () => {});
  res.json({ ok: true });
}

module.exports = { estado, salvarConfig, salvarOpcoes, obterEstilo, salvarEstilo, adicionarCanal, removerCanal, cliparAgora, listarCortes, arquivoDoCorte, apagarCorte, JANELA_CLIPAR_AGORA_S };

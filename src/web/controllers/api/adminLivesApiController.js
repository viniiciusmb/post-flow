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

async function estado(req, res) {
  const userId = req.session.user.id;
  const [ligadoNoPainel, cfg, canais, custoHoje, custo7d] = await Promise.all([
    require('../../../repositories/settingsRepository').getValue('lives_enabled', false),
    livesSettings.obterConfig(),
    livesRepository.listChannelsForUser(userId),
    livesRepository.costSummary(resolveRange('today').since),
    livesRepository.costSummary(resolveRange('last7days').since),
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
  });
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

module.exports = { estado, salvarConfig, adicionarCanal, removerCanal, cliparAgora, listarCortes, arquivoDoCorte, apagarCorte, JANELA_CLIPAR_AGORA_S };

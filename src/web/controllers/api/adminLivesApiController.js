// Tela "Lives" (cortes de lives da Twitch e da Kick) - MODO DE VALIDACAO, so admin.
// Tudo aqui opera sobre o usuario logado: os canais que ELE acompanha e os
// cortes feitos pra ELE. Quando o modulo for aberto a clientes, a mesma API
// serve, trocando so a rota/permissao.
'use strict';

const fs = require('fs');
const livesRepository = require('../../../repositories/livesRepository');
const livesSettings = require('../../../services/lives/livesSettings');
const twitchApi = require('../../../services/lives/twitchApi');
const plataformas = require('../../../services/lives/plataformas');
const liveCleanupService = require('../../../services/lives/liveCleanupService');
const config = require('../../../config');
const { RETENCAO_CORTE_LIVE_HORAS } = require('../../../config/constants');
const { resolveRange } = require('../../../lib/dateRanges');
const livesUserSettings = require('../../../services/lives/livesUserSettings');
const liveCreditosService = require('../../../services/lives/liveCreditosService');
const tiposDeMomento = require('../../../services/lives/tiposDeMomento');
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
    plataforma: c.platform || 'twitch',
    login: c.login,
    url: plataformas.urlDaLive(c),
    nome: c.display_name || c.login,
    imagem: c.profile_image_url,
    aoVivo: c.is_live,
    // Quando a live comecou na plataforma (relogio da live, nao da gravacao).
    aoVivoDesde: c.is_live && c.live_started_at ? new Date(c.live_started_at).toISOString() : null,
    pausado: Boolean(c.paused_at),
    pausadoDesde: c.paused_at || null,
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
    canal: {
      id: Number(k.live_channel_id),
      login: k.login,
      nome: k.display_name || k.login,
      imagem: k.profile_image_url || null,
      plataforma: k.platform || 'twitch',
    },
    origem: k.source,
    inicio: Number(k.start_offset),
    fim: Number(k.end_offset),
    duracao: Number(k.end_offset) - Number(k.start_offset),
    titulo: k.title,
    gancho: k.hook,
    nota: numero(k.score),
    tipo: k.moment_type || null,
    categoria: k.source === 'clipar_agora' ? null : tiposDeMomento.categoriaDoTipo(k.moment_type),
    // O que a revisao final achou (null em corte anterior a ela).
    revisao: k.review
      ? { veredito: k.review.veredito, notaHistoria: numero(k.review.notaHistoria), problemas: k.review.problemas || '' }
      : null,
    status: k.status,
    progresso: k.render_progress,
    erro: k.error_message,
    criadoEm: k.created_at,
    prontoEm: k.ready_at,
    // Quando o corte some sozinho (RETENCAO_CORTE_LIVE_HORAS) - a tela avisa.
    apagaEm: new Date(new Date(k.ready_at || k.created_at).getTime() + RETENCAO_CORTE_LIVE_HORAS * 3600 * 1000).toISOString(),
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
    categorias: Array.isArray(c.categorias) && c.categorias.length ? c.categorias : null,
  };
}

// Status ao vivo/offline dos canais direto da Twitch/Kick. Com o modulo DESLIGADO
// o monitor nao roda, e a tela mostrava "Offline" pra canal que estava ao vivo
// (visto em 29/09/2026 com o thimagroo: nunca tinha sido consultado). A
// consulta e gratuita; so e refeita se a ultima tiver mais de 60s.
async function atualizarStatus(canais, { forcar = false } = {}) {
  const velhos = canais.filter((c) => forcar || !c.last_checked_at || Date.now() - new Date(c.last_checked_at).getTime() > 60_000);
  if (!velhos.length) return;
  try {
    // Canal fora do mapa = plataforma fora do ar: a tela mostra o ultimo
    // status conhecido dele.
    const status = await plataformas.statusDosCanais(velhos);
    for (const c of velhos) {
      if (!status.has(Number(c.id))) continue;
      const st = status.get(Number(c.id));
      await livesRepository.updateChannelStatus(c.id, { isLive: Boolean(st), titulo: st?.titulo, jogo: st?.jogo, espectadores: st?.espectadores, iniciouEm: st?.iniciouEm });
    }
  } catch {
    // Consulta falhou por inteiro: idem.
  }
}

async function estado(req, res) {
  const userId = req.session.user.id;
  const canaisAntes = await livesRepository.listChannelsForUser(userId);
  await atualizarStatus(canaisAntes);
  const temTwitch = canaisAntes.some((c) => (c.platform || 'twitch') === 'twitch');
  const [ligadoNoPainel, cfg, canais, custoHoje, custo7d, opcoes, monitor] = await Promise.all([
    require('../../../repositories/settingsRepository').getValue('lives_enabled', false),
    livesSettings.obterConfig(),
    livesRepository.listChannelsForUser(userId),
    livesRepository.costSummary(resolveRange('today').since),
    livesRepository.costSummary(resolveRange('last7days').since),
    livesUserSettings.obter(userId),
    livesRepository.qualityMonitor(resolveRange('last7days').since),
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
    ],
    // Nao impedem o modulo de rodar, so uma parte dele: sem o app da Twitch,
    // os canais da Kick seguem normais e os da Twitch ficam sem vigia.
    avisos: [
      ...(temTwitch && !twitchApi.configurado()
        ? ['TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET nao configurados no servidor: os canais da Twitch nao sao vigiados.']
        : []),
    ],
    plataformas: plataformas.PLATAFORMAS.map((p) => ({ id: p, nome: plataformas.NOMES[p], disponivel: plataformas.disponivel(p) })),
    config: cfg,
    limites: { faixas: livesSettings.FAIXAS, qualidades: livesSettings.QUALIDADES },
    discoPercent,
    canais: canais.map(canalParaApi),
    custos: { hoje: custoHoje, seteDias: custo7d },
    // Vigia das economias (transcricao acelerada e flex), ultimos 7 dias.
    monitor,
    opcoes: opcoesParaApi(opcoes),
    niveis: livesUserSettings.NIVEIS,
    categorias: tiposDeMomento.CATEGORIAS.map(({ id, nome, descricao }) => ({ id, nome, descricao })),
  });
}

// Opcoes dos cortes de live do usuario: qualidade, camera e se o estilo
// visual e o mesmo dos cortes de video. Campo ausente preserva o salvo.
// Devolve { error } (400) ou grava e devolve {}. Compartilhado com a tela
// "Lives" dos clientes.
async function validarOpcoes(userId, b = {}) {
  const atual = await livesUserSettings.obter(userId);
  const nova = { ...atual };
  if (b.qualidade !== undefined) {
    const q = Number(b.qualidade);
    if (!Number.isInteger(q) || q < 1 || q > 5) return { error: 'Qualidade vai de 1 a 5.' };
    nova.qualidade = q;
  }
  if (b.cameraModo !== undefined) {
    if (!['ia', 'auto', 'desligado'].includes(b.cameraModo)) return { error: 'Opcao de enquadramento invalida.' };
    nova.camera_modo = b.cameraModo;
  }
  if (b.cameraPosicao !== undefined) {
    if (!['top', 'bottom'].includes(b.cameraPosicao)) return { error: 'Posicao da camera invalida.' };
    nova.camera_posicao = b.cameraPosicao;
  }
  if (b.cameraAlturaPercent !== undefined) {
    const a = Number(b.cameraAlturaPercent);
    if (!Number.isInteger(a) || a < 20 || a > 60) return { error: 'Altura da camera vai de 20% a 60%.' };
    nova.camera_altura_percent = a;
  }
  if (b.categorias !== undefined) {
    // null ou lista vazia = todos os tipos. Id desconhecido e recusado, nao
    // ignorado: gravar lixo faria o filtro barrar tudo sem ninguem entender.
    if (b.categorias === null) nova.categorias = null;
    else if (!Array.isArray(b.categorias) || b.categorias.some((x) => !tiposDeMomento.IDS_CATEGORIAS.includes(x))) {
      return { error: 'Tipo de corte invalido.' };
    } else nova.categorias = b.categorias.length ? [...new Set(b.categorias)] : null;
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
  return {};
}

async function salvarOpcoes(req, res) {
  const r = await validarOpcoes(req.session.user.id, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
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

// O link colado decide a plataforma; nome solto usa a escolhida na tela
// (corpo.plataforma), com Twitch como padrao (era a unica antes). Compartilhado
// pela tela do admin e pela tela "Lives" dos clientes: devolve o canal salvo
// (ja seguido por quem pediu) ou { status, error } pra rota responder.
async function seguirCanal(userId, corpo) {
  const alvo = plataformas.identificar(corpo?.canal, corpo?.plataforma);
  const escolhida = alvo?.plataforma || (corpo?.plataforma === 'kick' ? 'kick' : 'twitch');
  const nome = plataformas.NOMES[escolhida];
  const dominio = escolhida === 'kick' ? 'kick.com' : 'twitch.tv';
  if (!alvo) return { status: 400, error: `Nome de canal da ${nome} invalido. Use o nome que aparece em ${dominio}/nome.` };
  if (!plataformas.disponivel(alvo.plataforma)) return { status: 503, error: `A ${nome} nao esta configurada no servidor.` };
  let usuario;
  try {
    usuario = await plataformas.buscarUsuario(alvo.plataforma, alvo.login);
  } catch (err) {
    return { status: 502, error: `Nao consegui consultar a ${nome} agora: ${err.message}` };
  }
  if (!usuario) return { status: 404, error: `Nao existe canal ${dominio}/${alvo.login}.` };
  const canal = await livesRepository.upsertChannel({
    platform: alvo.plataforma,
    login: usuario.login,
    displayName: usuario.nome,
    platformUserId: usuario.id,
    profileImageUrl: usuario.imagem,
  });
  await livesRepository.follow(userId, canal.id);
  await atualizarStatus([canal], { forcar: true });
  return { canal };
}

async function adicionarCanal(req, res) {
  const r = await seguirCanal(req.session.user.id, req.body);
  if (r.error) return res.status(r.status).json({ error: r.error });
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

// Pausar/retomar: o canal continua salvo (e com o status ao vivo/offline na
// tela), so nao e gravado pra essa pessoa enquanto pausado. A gravacao em
// andamento para na proxima volta do supervisor se ninguem mais acompanha.
async function pausarCanal(req, res) {
  const ok = await livesRepository.setPaused(req.session.user.id, Number(req.params.id), true);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
  return estado(req, res);
}

async function retomarCanal(req, res) {
  const ok = await livesRepository.setPaused(req.session.user.id, Number(req.params.id), false);
  if (!ok) return res.status(404).json({ error: 'Voce nao acompanha esse canal.' });
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
  // 1 credito por clique, cobrado ANTES de criar o corte (admin isento). Se
  // criar o corte falhar, devolve.
  const cobranca = await liveCreditosService.cobrarCliparAgora(userId);
  if (!cobranca.ok) return res.status(402).json({ error: 'Seus creditos acabaram. Compre mais em Plano e uso pra clipar este momento.' });
  let corte;
  try {
    corte = await criarCorteClipado({ sessao, id, userId, inicio, fim });
  } catch (err) {
    await cobranca.desfazer();
    throw err;
  }
  if (cobranca.creditos) await livesRepository.setClipCredits(corte.id, cobranca.creditos);
  res.status(201).json({ id: Number(corte.id), creditos: cobranca.creditos });
}

async function criarCorteClipado({ sessao, id, userId, inicio, fim }) {
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
  return corte;
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

module.exports = {
  // Compartilhados com a tela "Lives" dos clientes (livesApiController).
  atualizarStatus, canalParaApi, corteParaApi, opcoesParaApi, estiloSoVisual, seguirCanal, validarOpcoes,
  estado, salvarConfig, salvarOpcoes, obterEstilo, salvarEstilo, adicionarCanal, removerCanal, pausarCanal, retomarCanal, cliparAgora, listarCortes, arquivoDoCorte, apagarCorte, JANELA_CLIPAR_AGORA_S };

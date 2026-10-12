// Fila de publicação das contas de Instagram, Facebook, Threads, LinkedIn,
// Pinterest, Bluesky e YouTube (11/10/2026): horários, publicar sozinho,
// pausa, opções da rede, fila/publicados/erros e o "usar esta configuração em
// todas as contas" (que vale também pras contas do TikTok).
//
// Toda rota confere o DONO da conta pela sessão: o id vem da URL e qualquer um
// pode trocá-lo.
'use strict';

const socialAccountsRepository = require('../../../repositories/socialAccountsRepository');
const socialPostingsRepository = require('../../../repositories/socialPostingsRepository');
const socialPostingSettingsRepository = require('../../../repositories/socialPostingSettingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const youtubeChannelSocialTargetsRepository = require('../../../repositories/youtubeChannelSocialTargetsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const outstandService = require('../../../services/outstandService');
const filaSocialService = require('../../../services/filaSocialService');
const queueService = require('../../../services/queueService');
const redesSociais = require('../../../lib/redesSociais');
const { horariosPadrao } = require('../../../lib/postingSchedule');
const { RETENCAO_CORTE_POSTADO_HORAS } = require('../../../config/constants');
const logger = require('../../../lib/logger');

const MAX_POR_DIA = 10;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

async function contaDoCliente(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return null;
  return socialAccountsRepository.findOwned(id, req.session.user.id);
}

function configParaApi(conta, s) {
  const r = redesSociais.info(conta.network) || {};
  return {
    mode: s.mode,
    videosPerDay: s.videos_per_day,
    manualTimes: s.manual_times,
    defaultTimes: horariosPadrao(s.videos_per_day),
    timezone: s.timezone,
    paused: s.paused,
    autoPostEnabled: s.auto_post_enabled,
    opcoes: {
      youtubePrivacidade: s.options.youtubePrivacidade || 'public',
      youtubeInfantil: s.options.youtubeInfantil === true,
      pinterestPasta: s.options.pinterestPasta || null,
      pinterestPastaNome: s.options.pinterestPastaNome || null,
    },
    limites: {
      duracaoMinS: r.duracaoMin,
      duracaoMaxS: r.duracaoMax,
      legendaMax: r.legendaMax,
      maxPorDia: MAX_POR_DIA,
      retencaoHoras: RETENCAO_CORTE_POSTADO_HORAS,
    },
  };
}

function itemParaApi(r) {
  const tipo = r.live_clip_id ? 'live' : 'youtube';
  const id = Number(r.live_clip_id || r.clip_id);
  const base = tipo === 'live' ? `/api/client/lives/cortes/${id}/arquivo` : `/api/client/source-videos/clips/${id}`;
  return {
    id: Number(r.id),
    status: r.status,
    legenda: r.caption,
    titulo: r.clip_title || r.title,
    duracaoS: r.duracao !== null ? Math.round(Number(r.duracao)) : null,
    horario: r.scheduled_for,
    publicadoEm: r.posted_at,
    url: r.platform_post_url,
    erro: r.error_message,
    erroDeDuracao: r.erro_tipo === 'duracao',
    esperandoVaga: r.status === 'pending' && Number(r.esperas_de_cota) > 0,
    postarAgora: r.ignora_limite_diario,
    origem: r.origem_nome,
    corte: { tipo, id },
    capaUrl: r.tem_capa ? (tipo === 'live' ? `${base}?capa=1` : `${base}/thumbnail`) : null,
    videoUrl: r.tem_arquivo ? (tipo === 'live' ? base : `${base}/download`) : null,
  };
}

function dispararFila() {
  queueService
    .getBoss()
    .then((boss) => boss.send('social-posting', {}))
    .catch((err) => logger.error('Nao deu pra disparar a fila das redes sociais:', err));
}

// GET /:id/publicacao
async function obterConfig(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const s = await socialPostingSettingsRepository.findOrCreate(conta.id);
  res.json(configParaApi(conta, s));
}

function validarHorarios(body) {
  const mode = body.mode;
  if (!['auto', 'manual'].includes(mode)) return { erro: 'Escolha como os horários são definidos.' };
  const videosPerDay = Number(body.videosPerDay);
  if (!Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > MAX_POR_DIA) {
    return { erro: `Escolha de 1 a ${MAX_POR_DIA} publicações por dia.` };
  }
  const manualTimes = Array.isArray(body.manualTimes) ? body.manualTimes.map(String) : [];
  if (!manualTimes.every((t) => HORA.test(t))) return { erro: 'Algum horário está em formato inválido.' };
  if (manualTimes.length > MAX_POR_DIA) return { erro: `No máximo ${MAX_POR_DIA} horários por dia.` };
  if (mode === 'manual' && manualTimes.length === 0) return { erro: 'Adicione pelo menos um horário.' };
  // Horário repetido são duas publicações disputando o mesmo minuto.
  const unicos = [...new Set(manualTimes)].sort();
  return { mode, videosPerDay, manualTimes: unicos };
}

// PUT /:id/horarios { mode, videosPerDay, manualTimes }
async function salvarHorarios(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const v = validarHorarios(req.body || {});
  if (v.erro) return res.status(400).json({ error: v.erro });
  const s = await socialPostingSettingsRepository.salvarHorarios(conta.id, v);
  // A fila acompanha os horários novos: sem isso, mudar de 3 pra 1 por dia
  // deixaria os cortes já marcados nos horários antigos.
  await socialPostingsRepository.recalcularHorarios(conta.id);
  res.json(configParaApi(conta, s));
}

// PUT /:id/pausa { paused }
async function pausar(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const s = await socialPostingSettingsRepository.setPaused(conta.id, req.body?.paused === true);
  res.json(configParaApi(conta, s));
}

// PUT /:id/auto-post { enabled }
async function publicarSozinho(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const s = await socialPostingSettingsRepository.setAutoPost(conta.id, req.body?.enabled === true);
  res.json(configParaApi(conta, s));
}

// PUT /:id/opcoes { youtubePrivacidade?, youtubeInfantil?, pinterestPasta? }
async function salvarOpcoes(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const b = req.body || {};
  const opcoes = {};
  if (conta.network === 'youtube') {
    if (b.youtubePrivacidade !== undefined) {
      if (!['public', 'unlisted', 'private'].includes(b.youtubePrivacidade)) return res.status(400).json({ error: 'Privacidade inválida.' });
      opcoes.youtubePrivacidade = b.youtubePrivacidade;
    }
    if (b.youtubeInfantil !== undefined) opcoes.youtubeInfantil = b.youtubeInfantil === true;
  }
  if (conta.network === 'pinterest' && b.pinterestPasta !== undefined) {
    // A pasta tem que ser uma das que a conta tem de verdade: o id vem da tela.
    let pastas;
    try {
      pastas = await outstandService.pastasDoPinterest(conta.outstand_account_id);
    } catch (err) {
      logger.error(`Outstand (pastas do pinterest): ${err.message}`);
      return res.status(502).json({ error: 'Não foi possível consultar as pastas do Pinterest agora.' });
    }
    const pasta = pastas.find((p) => p.id === String(b.pinterestPasta));
    if (!pasta) return res.status(400).json({ error: 'Pasta não encontrada nesta conta do Pinterest.' });
    opcoes.pinterestPasta = pasta.id;
    opcoes.pinterestPastaNome = pasta.nome;
  }
  const s = await socialPostingSettingsRepository.mesclarOpcoes(conta.id, opcoes);
  res.json(configParaApi(conta, s));
}

// GET /:id/pinterest/pastas
async function pastasDoPinterest(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta || conta.network !== 'pinterest') return res.status(404).json({ error: 'Conta não encontrada.' });
  try {
    res.json({ pastas: await outstandService.pastasDoPinterest(conta.outstand_account_id) });
  } catch (err) {
    logger.error(`Outstand (pastas do pinterest): ${err.message}`);
    res.status(502).json({ error: 'Não foi possível consultar as pastas do Pinterest agora.' });
  }
}

// GET /:id/fila | /:id/publicados | /:id/erros
function lista(qual) {
  const fn = { fila: 'listarFila', publicados: 'listarPublicados', erros: 'listarErros' }[qual];
  return async (req, res) => {
    const conta = await contaDoCliente(req);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
    const rows = await socialPostingsRepository[fn](req.session.user.id, conta.id);
    res.json({ itens: rows.map(itemParaApi) });
  };
}

// PUT /:id/ordem { ids: [...] }
async function ordenar(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  await socialPostingsRepository.ordenar(conta.id, ids);
  res.json({ ok: true });
}

// POST /:id/corrigir-horarios
async function corrigirHorarios(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ atualizados: await socialPostingsRepository.recalcularHorarios(conta.id) });
}

// Ações numa postagem: /api/client/social-postings/:id/...
function idDaPostagem(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) ? id : null;
}

async function editarLegenda(req, res) {
  const id = idDaPostagem(req);
  const legenda = typeof req.body?.legenda === 'string' ? req.body.legenda.slice(0, 5000) : null;
  if (!id || legenda === null) return res.status(400).json({ error: 'Legenda inválida.' });
  const r = await socialPostingsRepository.editarLegenda(id, req.session.user.id, legenda);
  if (!r) return res.status(404).json({ error: 'Esse corte não está mais na fila.' });
  res.json({ ok: true });
}

async function cancelar(req, res) {
  const id = idDaPostagem(req);
  const r = id && (await socialPostingsRepository.cancelar(id, req.session.user.id));
  if (!r) return res.status(404).json({ error: 'Esse corte não está mais na fila.' });
  res.json({ ok: true });
}

// Mensagem única pra conta que passou do limite do plano (ver
// socialAccountsRepository.dentroDoPlanoSql): a fila dela fica parada.
const FORA_DO_PLANO =
  'Esta conta passou do limite de contas por rede do seu plano, então a fila dela está parada. Desconecte outra conta desta rede ou troque de plano em "Plano e uso".';

async function postarAgora(req, res) {
  const id = idDaPostagem(req);
  const pedido = id && (await socialPostingsRepository.contaDaPostagem(id, req.session.user.id));
  if (pedido) {
    const conta = await socialAccountsRepository.findOwned(pedido.social_account_id, req.session.user.id);
    if (conta && !conta.dentro_do_plano) return res.status(403).json({ error: FORA_DO_PLANO });
  }
  const r = id && (await socialPostingsRepository.postarAgora(id, req.session.user.id));
  if (!r) return res.status(404).json({ error: 'Esse corte não está mais na fila.' });
  dispararFila();
  res.json({ ok: true });
}

async function tentarDeNovo(req, res) {
  const id = idDaPostagem(req);
  const r = id && (await socialPostingsRepository.tentarDeNovo(id, req.session.user.id));
  if (!r) return res.status(409).json({ error: 'Esse corte não pode voltar pra fila.' });
  res.json({ ok: true, horario: r.scheduled_for });
}

// POST /aplicar-em-todas { origem: { rede: 'tiktok'|'social', id } }
//
// Copia horários, "quantos por dia" e "publicar sozinho" da conta de origem pra
// TODAS as contas do cliente, de todas as redes (TikTok incluído). Não copia a
// pausa (pausar todas de uma vez seria um susto) nem as opções próprias de cada
// rede (privacidade do YouTube não existe no Instagram). Recalcula a fila de
// cada conta pra os cortes já marcados seguirem os horários novos.
async function aplicarEmTodas(req, res) {
  const clientUserId = req.session.user.id;
  const origem = req.body?.origem || {};
  const id = Number(origem.id);
  let modelo;
  if (origem.rede === 'tiktok') {
    const conta = await tiktokAccountsRepository.findActiveByIdAndClient(id, clientUserId);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
    const s = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(conta.id);
    modelo = { mode: s.mode, videosPerDay: s.videos_per_day, manualTimes: s.manual_times, autoPost: conta.auto_post_enabled };
  } else {
    const conta = await socialAccountsRepository.findOwned(id, clientUserId);
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada.' });
    const s = await socialPostingSettingsRepository.findOrCreate(conta.id);
    modelo = { mode: s.mode, videosPerDay: s.videos_per_day, manualTimes: s.manual_times, autoPost: s.auto_post_enabled };
  }

  let contas = 0;
  for (const t of await tiktokAccountsRepository.listActiveByClientId(clientUserId)) {
    const atual = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(t.id);
    await postingScheduleSettingsRepository.upsert(t.id, { ...modelo, timezone: atual.timezone });
    await tiktokAccountsRepository.setAutoPostEnabled(t.id, modelo.autoPost);
    await postingsRepository.reflowScheduledFor(t.id);
    contas += 1;
  }
  for (const s of await socialAccountsRepository.listActive(clientUserId)) {
    await socialPostingSettingsRepository.salvarHorarios(s.id, modelo);
    await socialPostingSettingsRepository.setAutoPost(s.id, modelo.autoPost);
    await socialPostingsRepository.recalcularHorarios(s.id);
    contas += 1;
  }
  res.json({ contas });
}

// GET /canais - em quais contas cada canal do YouTube publica.
async function canais(req, res) {
  const clientUserId = req.session.user.id;
  const [lista, mapa] = await Promise.all([
    youtubeChannelsRepository.listByClientId(clientUserId),
    youtubeChannelSocialTargetsRepository.mapaDoCliente(clientUserId),
  ]);
  res.json({
    canais: lista.map((c) => ({
      id: Number(c.id),
      nome: c.channel_name || c.channel_url,
      avatar: c.avatar_url || null,
      tiktokAccountId: c.tiktok_account_id ? Number(c.tiktok_account_id) : null,
      socialAccountIds: mapa.get(Number(c.id)) || [],
    })),
  });
}

// PUT /canais/:canalId { socialAccountIds: [...] }
async function definirCanal(req, res) {
  const clientUserId = req.session.user.id;
  const canal = await youtubeChannelsRepository.findById(Number(req.params.canalId));
  if (!canal || String(canal.client_user_id) !== String(clientUserId)) return res.status(404).json({ error: 'Canal não encontrado.' });
  const pedidas = Array.isArray(req.body?.socialAccountIds) ? [...new Set(req.body.socialAccountIds.map(Number))] : [];
  const minhas = await socialAccountsRepository.listActive(clientUserId);
  const contas = pedidas.map((id) => minhas.find((m) => Number(m.id) === id));
  // Conta de outro cliente recusa o pedido inteiro.
  if (contas.some((c) => !c)) return res.status(404).json({ error: 'Conta não encontrada.' });

  const novas = await youtubeChannelSocialTargetsRepository.definir(canal.id, contas.map((c) => Number(c.id)));
  // Os cortes do canal que já estavam prontos entram na fila das contas que
  // acabaram de ser ligadas (igual o TikTok faz ao vincular).
  let enfileirados = 0;
  let longos = 0;
  for (const id of novas) {
    const conta = contas.find((c) => Number(c.id) === Number(id));
    const r = await filaSocialService.canalLigadoAConta({ clientUserId, youtubeChannelId: canal.id, conta });
    enfileirados += r.enfileirados;
    longos += r.longos;
  }
  res.json({ socialAccountIds: contas.map((c) => Number(c.id)), enfileirados, longos });
}

module.exports = {
  obterConfig,
  salvarHorarios,
  pausar,
  publicarSozinho,
  salvarOpcoes,
  pastasDoPinterest,
  fila: lista('fila'),
  publicados: lista('publicados'),
  erros: lista('erros'),
  ordenar,
  corrigirHorarios,
  editarLegenda,
  cancelar,
  postarAgora,
  tentarDeNovo,
  aplicarEmTodas,
  canais,
  definirCanal,
  validarHorarios,
};

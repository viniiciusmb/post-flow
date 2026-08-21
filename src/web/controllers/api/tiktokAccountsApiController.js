'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokService = require('../../../services/tiktokService');
const publishOptions = require('../../../lib/publishOptions');
const { RETENCAO_CORTE_POSTADO_HORAS } = require('../../../config/constants');
const logger = require('../../../lib/logger');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Teto de publicacoes por dia, por conta. Vale pros DOIS modos: no automatico
// limita videos_per_day, no manual limita quantos horarios podem ser
// cadastrados - sem isso, o modo manual furava o limite com 30 horarios.
const MAX_POSTS_POR_DIA = 10;

// Busca seguidores/curtidas na API do TikTok so se os dados estiverem
// ausentes ou velhos (30min) - evita bater na API do TikTok a cada refresh.
async function refreshStatsIfStale(account) {
  const isStale = !account.stats_updated_at || Date.now() - new Date(account.stats_updated_at).getTime() > 30 * 60 * 1000;
  if (!isStale) return account;

  try {
    const accessToken = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
    const stats = await tiktokService.getUserStats(accessToken);
    return await tiktokAccountsRepository.saveStats(account.id, {
      followerCount: stats.follower_count ?? null,
      followingCount: stats.following_count ?? null,
      likesCount: stats.likes_count ?? null,
      videoCount: stats.video_count ?? null,
    });
  } catch {
    return account;
  }
}

// Horario previsto e so exibicao: um horario que ja passou (fila atrasada)
// vira "agora" em vez de mostrar hora no passado. Mesma regra da fila
// completa, em clientPostingsApiController.
function displayScheduledFor(scheduledFor) {
  if (!scheduledFor) return null;
  const date = new Date(scheduledFor);
  const now = new Date();
  return (date < now ? now : date).toISOString();
}

function nextInQueueToApi(row) {
  if (!row) return null;
  return {
    postingId: Number(row.id),
    clipId: Number(row.clip_id),
    clipTitle: row.clip_title,
    thumbnailUrl: row.thumbnail_path ? `/api/client/source-videos/clips/${row.clip_id}/thumbnail` : null,
    channelName: row.channel_name,
    startSeconds: Number(row.start_seconds),
    endSeconds: Number(row.end_seconds),
    scheduledFor: displayScheduledFor(row.scheduled_for),
  };
}

function accountToApi(account, counts, nextInQueue) {
  return {
    id: account.id,
    displayName: account.display_name || account.tiktok_open_id,
    avatarUrl: account.avatar_url,
    connectedAt: account.connected_at,
    followerCount: account.follower_count,
    followingCount: account.following_count,
    likesCount: account.likes_count,
    videoCount: account.video_count,
    statsUpdatedAt: account.stats_updated_at,
    autoPostEnabled: account.auto_post_enabled,
    publishMode: account.publish_mode,
    pendingCount: counts.pending,
    postedCount: counts.posted,
    errorCount: counts.error,
    // A fila dentro da caixa precisa saber disso pra liberar "postar agora":
    // sem padrao definido, publicacao direta nao sai (ver publishOptions).
    hasPublishDefaults: publishOptions.contaTemPadrao(account),
    // null = fila vazia. A tela mostra a caixa do mesmo jeito, dizendo que
    // nao ha nada na fila - some-la faria o cartao "pular de tamanho"
    // conforme a fila esvazia.
    nextInQueue: nextInQueueToApi(nextInQueue),
  };
}

// Contagens (fila/postados/erro) e o proximo da fila pra caixa fechada de
// cada conta - da pra ver de relance sem precisar selecionar/abrir nada.
async function list(req, res) {
  const accounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  const refreshed = await Promise.all(accounts.map(refreshStatsIfStale));

  // Uma consulta so pro proximo de todas as contas, em vez de uma por conta.
  const proximos = await postingsRepository.findNextPendingForAccounts(refreshed.map((a) => a.id));
  const proximoPorConta = new Map(proximos.map((p) => [String(p.tiktok_account_id), p]));

  const withCounts = await Promise.all(
    refreshed.map(async (account) =>
      accountToApi(
        account,
        await postingsRepository.countByStatusForAccount(account.id),
        proximoPorConta.get(String(account.id)) || null
      )
    )
  );
  res.json({ accounts: withCounts });
}

async function findOwned(req) {
  return tiktokAccountsRepository.findActiveByIdAndClient(Number(req.params.id), req.session.user.id);
}

async function deactivate(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  // Avisa a TikTok pra esquecer a autorizacao ANTES de apagar o token daqui -
  // depois de apagar nao teria mais como revogar.
  //
  // Falhar aqui nao impede a desconexao: se a TikTok estiver fora do ar, o
  // cliente ainda tem o direito de nos tirar o acesso agora. O token some do
  // nosso lado de qualquer jeito, entao o pior caso e uma autorizacao orfa la,
  // que ele pode remover nas configuracoes do proprio TikTok.
  try {
    const token = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
    if (token) await tiktokService.revokeAccess(token);
  } catch (err) {
    logger.error(`Nao consegui revogar o acesso da conta TikTok ${account.id} (desconectando mesmo assim):`, err.message);
  }

  await tiktokAccountsRepository.deactivate(account.id, req.session.user.id);
  res.status(204).end();
}

async function setAutoPost(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const updated = await tiktokAccountsRepository.setAutoPostEnabled(account.id, Boolean(req.body.enabled));
  res.json({ autoPostEnabled: updated.auto_post_enabled });
}

// Rascunho no aplicativo do TikTok x publicacao direta no perfil. Quem escolhe
// e o dono da conta, nao nos: as diretrizes da TikTok tratam isso como decisao
// do criador, e sao dois fluxos com exigencias diferentes (o direto so sai
// depois que ele preenche privacidade, interacoes e divulgacao corte a corte).
async function setPublishMode(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const mode = req.body.mode === 'direct' ? 'direct' : 'inbox';
  const updated = await tiktokAccountsRepository.setPublishMode(account.id, account.client_user_id, mode);
  if (!updated) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });
  res.json({ publishMode: updated.publish_mode });
}

// Padrao de publicacao direta da conta. Vale pra todos os cortes, e e o que
// permite o sistema seguir automatico: o criador escolhe uma vez, nao corte a
// corte. Enquanto "definido" for false, nada e publicado direto.
function publishDefaultsToApi(account) {
  return {
    definido: Boolean(account.publish_options_set_at && account.default_privacy_level),
    definidoEm: account.publish_options_set_at,
    privacyLevel: account.default_privacy_level,
    disableComment: account.default_disable_comment,
    disableDuet: account.default_disable_duet,
    disableStitch: account.default_disable_stitch,
    brandOrganicToggle: account.default_brand_organic_toggle,
    brandContentToggle: account.default_brand_content_toggle,
  };
}

async function getPublishDefaults(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });
  res.json(publishDefaultsToApi(account));
}

async function setPublishDefaults(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const opcoes = {
    privacyLevel: req.body.privacyLevel,
    disableComment: Boolean(req.body.disableComment),
    disableDuet: Boolean(req.body.disableDuet),
    disableStitch: Boolean(req.body.disableStitch),
    brandOrganicToggle: Boolean(req.body.brandOrganicToggle),
    brandContentToggle: Boolean(req.body.brandContentToggle),
  };

  const problema = publishOptions.validar(opcoes);
  if (problema) return res.status(400).json({ error: problema });

  const salvo = await tiktokAccountsRepository.savePublishDefaults(
    account.id,
    account.client_user_id,
    opcoes
  );
  if (!salvo) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });
  res.json(publishDefaultsToApi(salvo));
}

function scheduleToApi(settings) {
  return {
    mode: settings.mode,
    videosPerDay: settings.videos_per_day,
    manualTimes: settings.manual_times,
    timezone: settings.timezone,
    paused: settings.paused,
    // A retencao deixou de ser configuravel (ver constants.js e migration
    // 062), mas continua vindo na resposta: a tela mostra o prazo pro cliente
    // saber quanto tempo o corte fica guardado - so nao deixa escolher.
    options: { retentionHours: RETENCAO_CORTE_POSTADO_HORAS, maxPostsPerDay: MAX_POSTS_POR_DIA },
  };
}

async function getSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  res.json(scheduleToApi(settings));
}

async function setSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const mode = req.body.mode;
  if (!['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ error: res.locals.t('erros.modoAgendamentoInvalido') });
  }

  const videosPerDay = Number(req.body.videosPerDay);
  if (!Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > MAX_POSTS_POR_DIA) {
    return res.status(400).json({ error: res.locals.t('erros.videosPorDiaInvalido') });
  }

  const manualTimes = Array.isArray(req.body.manualTimes) ? req.body.manualTimes : [];
  if (mode === 'manual') {
    if (manualTimes.length === 0 || !manualTimes.every((t) => TIME_RE.test(t))) {
      return res.status(400).json({ error: res.locals.t('erros.informeHorario') });
    }
    // Cada horario e uma publicacao: mais horarios que o teto seria o mesmo que
    // furar o limite por outro caminho.
    if (manualTimes.length > MAX_POSTS_POR_DIA) {
      return res.status(400).json({ error: res.locals.t('erros.horariosDemais') });
    }
  }

  const timezone = String(req.body.timezone || '').trim() || 'America/Sao_Paulo';

  // Guarda manualTimes como veio, mesmo em modo 'auto' - forcar pra [] aqui
  // era o bug real: cliente configurava os horarios, clicava em
  // "Automatico" (de proposito ou sem querer) e ao voltar pra "Manual" os
  // horarios tinham sumido, precisando redigitar tudo. Em modo 'auto' esse
  // array so fica guardado sem uso, pronto pra quando o cliente voltar a
  // usar o modo manual.
  const updated = await postingScheduleSettingsRepository.upsert(account.id, {
    mode,
    videosPerDay,
    manualTimes,
    timezone,
  });
  res.json(scheduleToApi(updated));
}

// Botao de emergencia: pausa so a fila dessa conta (o job para de disparar
// novos posts, mas nao mexe no que ja esta em processamento).
async function setQueuePaused(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const updated = await postingScheduleSettingsRepository.setPaused(account.id, Boolean(req.body.paused));
  res.json(scheduleToApi(updated));
}

// Botao "Corrigir horarios de posts": recalcula scheduled_for de toda a
// fila pendente dessa conta do zero, preenchendo os buracos deixados por
// cortes pulados/com erro. So roda quando pedido de proposito.
async function fixSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const count = await postingsRepository.reflowScheduledFor(account.id);
  res.json({ updated: count });
}

// Arrastar-e-soltar na tela: o cliente manda a lista completa de ids na
// nova ordem. Reaplica os horarios em seguida (reflowScheduledFor) pra que
// "postar em 1o" tambem valha pro horario mostrado, nao so pra ordem visual.
async function setQueueOrder(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(Number).filter(Number.isFinite) : [];
  if (orderedIds.length === 0) {
    return res.status(400).json({ error: res.locals.t('erros.ordemInvalida') });
  }

  await postingsRepository.setQueueOrder(account.id, orderedIds);
  const count = await postingsRepository.reflowScheduledFor(account.id);
  res.json({ updated: count });
}

module.exports = {
  setPublishMode,
  getPublishDefaults,
  setPublishDefaults,
  list,
  deactivate,
  setAutoPost,
  getSchedule,
  setSchedule,
  setQueuePaused,
  fixSchedule,
  setQueueOrder,
};

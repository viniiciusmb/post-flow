'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokService = require('../../../services/tiktokService');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RETENTION_PRESETS = [24, 72, 168, 720]; // 1d, 3d, 7d, 30d

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

function accountToApi(account, counts) {
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
  };
}

// Contagens (fila/postados/erro) pra caixa fechada de cada conta na tela -
// da pra ver de relance sem precisar selecionar/abrir nada.
async function list(req, res) {
  const accounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  const refreshed = await Promise.all(accounts.map(refreshStatsIfStale));
  const withCounts = await Promise.all(
    refreshed.map(async (account) => accountToApi(account, await postingsRepository.countByStatusForAccount(account.id)))
  );
  res.json({ accounts: withCounts });
}

async function findOwned(req) {
  return tiktokAccountsRepository.findActiveByIdAndClient(Number(req.params.id), req.session.user.id);
}

async function deactivate(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  await tiktokAccountsRepository.deactivate(account.id, req.session.user.id);
  res.status(204).end();
}

async function setAutoPost(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const updated = await tiktokAccountsRepository.setAutoPostEnabled(account.id, Boolean(req.body.enabled));
  res.json({ autoPostEnabled: updated.auto_post_enabled });
}

// Rascunho no aplicativo do TikTok x publicacao direta no perfil. Quem escolhe
// e o dono da conta, nao nos: as diretrizes da TikTok tratam isso como decisao
// do criador, e sao dois fluxos com exigencias diferentes (o direto so sai
// depois que ele preenche privacidade, interacoes e divulgacao corte a corte).
async function setPublishMode(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const mode = req.body.mode === 'direct' ? 'direct' : 'inbox';
  const updated = await tiktokAccountsRepository.setPublishMode(account.id, account.client_user_id, mode);
  if (!updated) return res.status(404).json({ error: 'Conta não encontrada.' });
  res.json({ publishMode: updated.publish_mode });
}

function scheduleToApi(settings) {
  return {
    mode: settings.mode,
    videosPerDay: settings.videos_per_day,
    manualTimes: settings.manual_times,
    timezone: settings.timezone,
    autoDeleteAfterHours: settings.auto_delete_after_hours,
    paused: settings.paused,
    options: { retentionPresetsHours: RETENTION_PRESETS },
  };
}

async function getSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  res.json(scheduleToApi(settings));
}

async function setSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const mode = req.body.mode;
  if (!['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'Modo de agendamento inválido.' });
  }

  const videosPerDay = Number(req.body.videosPerDay);
  if (!Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > 20) {
    return res.status(400).json({ error: 'Vídeos por dia precisa ser um número entre 1 e 20.' });
  }

  const manualTimes = Array.isArray(req.body.manualTimes) ? req.body.manualTimes : [];
  if (mode === 'manual') {
    if (manualTimes.length === 0 || !manualTimes.every((t) => TIME_RE.test(t))) {
      return res.status(400).json({ error: 'Informe pelo menos um horario válido (formato HH:MM).' });
    }
  }

  const timezone = String(req.body.timezone || '').trim() || 'America/Sao_Paulo';

  let autoDeleteAfterHours = req.body.autoDeleteAfterHours;
  if (autoDeleteAfterHours !== null && autoDeleteAfterHours !== undefined) {
    autoDeleteAfterHours = Number(autoDeleteAfterHours);
    if (!Number.isInteger(autoDeleteAfterHours) || autoDeleteAfterHours < 1) {
      return res.status(400).json({ error: 'Retencao inválida.' });
    }
  } else {
    autoDeleteAfterHours = null;
  }

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
    autoDeleteAfterHours,
  });
  res.json(scheduleToApi(updated));
}

// Botao de emergencia: pausa so a fila dessa conta (o job para de disparar
// novos posts, mas nao mexe no que ja esta em processamento).
async function setQueuePaused(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const updated = await postingScheduleSettingsRepository.setPaused(account.id, Boolean(req.body.paused));
  res.json(scheduleToApi(updated));
}

// Botao "Corrigir horarios de posts": recalcula scheduled_for de toda a
// fila pendente dessa conta do zero, preenchendo os buracos deixados por
// cortes pulados/com erro. So roda quando pedido de proposito.
async function fixSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const count = await postingsRepository.reflowScheduledFor(account.id);
  res.json({ updated: count });
}

// Arrastar-e-soltar na tela: o cliente manda a lista completa de ids na
// nova ordem. Reaplica os horarios em seguida (reflowScheduledFor) pra que
// "postar em 1o" tambem valha pro horario mostrado, nao so pra ordem visual.
async function setQueueOrder(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada.' });

  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(Number).filter(Number.isFinite) : [];
  if (orderedIds.length === 0) {
    return res.status(400).json({ error: 'Lista de ordem inválida.' });
  }

  await postingsRepository.setQueueOrder(account.id, orderedIds);
  const count = await postingsRepository.reflowScheduledFor(account.id);
  res.json({ updated: count });
}

module.exports = {
  setPublishMode,
  list,
  deactivate,
  setAutoPost,
  getSchedule,
  setSchedule,
  setQueuePaused,
  fixSchedule,
  setQueueOrder,
};

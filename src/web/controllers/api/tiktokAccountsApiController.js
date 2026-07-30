'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
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

function accountToApi(account) {
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
  };
}

async function list(req, res) {
  const accounts = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  const refreshed = await Promise.all(accounts.map(refreshStatsIfStale));
  res.json({ accounts: refreshed.map(accountToApi) });
}

async function findOwned(req) {
  return tiktokAccountsRepository.findActiveByIdAndClient(Number(req.params.id), req.session.user.id);
}

async function deactivate(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada.' });

  await tiktokAccountsRepository.deactivate(account.id, req.session.user.id);
  res.status(204).end();
}

async function setAutoPost(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada.' });

  const updated = await tiktokAccountsRepository.setAutoPostEnabled(account.id, Boolean(req.body.enabled));
  res.json({ autoPostEnabled: updated.auto_post_enabled });
}

function scheduleToApi(settings) {
  return {
    mode: settings.mode,
    videosPerDay: settings.videos_per_day,
    manualTimes: settings.manual_times,
    timezone: settings.timezone,
    autoDeleteAfterHours: settings.auto_delete_after_hours,
    options: { retentionPresetsHours: RETENTION_PRESETS },
  };
}

async function getSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada.' });

  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  res.json(scheduleToApi(settings));
}

async function setSchedule(req, res) {
  const account = await findOwned(req);
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada.' });

  const mode = req.body.mode;
  if (!['auto', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'Modo de agendamento invalido.' });
  }

  const videosPerDay = Number(req.body.videosPerDay);
  if (!Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > 20) {
    return res.status(400).json({ error: 'Videos por dia precisa ser um numero entre 1 e 20.' });
  }

  const manualTimes = Array.isArray(req.body.manualTimes) ? req.body.manualTimes : [];
  if (mode === 'manual') {
    if (manualTimes.length === 0 || !manualTimes.every((t) => TIME_RE.test(t))) {
      return res.status(400).json({ error: 'Informe pelo menos um horario valido (formato HH:MM).' });
    }
  }

  const timezone = String(req.body.timezone || '').trim() || 'America/Sao_Paulo';

  let autoDeleteAfterHours = req.body.autoDeleteAfterHours;
  if (autoDeleteAfterHours !== null && autoDeleteAfterHours !== undefined) {
    autoDeleteAfterHours = Number(autoDeleteAfterHours);
    if (!Number.isInteger(autoDeleteAfterHours) || autoDeleteAfterHours < 1) {
      return res.status(400).json({ error: 'Retencao invalida.' });
    }
  } else {
    autoDeleteAfterHours = null;
  }

  const updated = await postingScheduleSettingsRepository.upsert(account.id, {
    mode,
    videosPerDay,
    manualTimes: mode === 'manual' ? manualTimes : [],
    timezone,
    autoDeleteAfterHours,
  });
  res.json(scheduleToApi(updated));
}

module.exports = { list, deactivate, setAutoPost, getSchedule, setSchedule };

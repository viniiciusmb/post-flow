'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const tiktokService = require('../../../services/tiktokService');
const { resolveRange } = require('../../../lib/dateRanges');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RETENTION_PRESETS = [24, 72, 168, 720]; // 1d, 3d, 7d, 30d

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Busca seguidores/curtidas na API do TikTok so se os dados estiverem
// ausentes ou velhos (30min) - evita bater na API do TikTok a cada refresh
// do dashboard. Silenciosa em caso de erro (ex: token sem o escopo novo
// ainda, porque o cliente nao reconectou) - o dashboard so mostra "-".
async function refreshTiktokStatsIfStale(account) {
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

async function dashboard(req, res) {
  const clientUserId = req.session.user.id;
  const { range, since, until } = resolveRange(req.query.range);
  const sinceMonth = startOfMonth();

  const [tiktokAccountRow, postings, channels, videosThisMonth, videosInRange, clipsInRange, clipsPostedInRange] =
    await Promise.all([
      tiktokAccountsRepository.findActiveByClientId(clientUserId),
      postingsRepository.listForClient(clientUserId),
      youtubeChannelsRepository.listByClientId(clientUserId),
      sourceVideosRepository.countByClientSince(clientUserId, sinceMonth),
      sourceVideosRepository.countByClientSince(clientUserId, since, until),
      clipsRepository.countByClientSince(clientUserId, since, until),
      clipsRepository.countPostedByClientSince(clientUserId, since, until),
    ]);

  const tiktokAccount = tiktokAccountRow ? await refreshTiktokStatsIfStale(tiktokAccountRow) : null;

  // Postagens do periodo escolhido, pra tabela do dashboard nao mostrar tudo
  // desde sempre quando o filtro e "Hoje".
  const postingsInRange = postings.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= since.getTime() && t <= until.getTime();
  });

  res.json({
    range: { key: range, since, until },
    tiktokAccount: tiktokAccount
      ? {
          connected: true,
          displayName: tiktokAccount.display_name || tiktokAccount.tiktok_open_id,
          avatarUrl: tiktokAccount.avatar_url,
          followerCount: tiktokAccount.follower_count,
          followingCount: tiktokAccount.following_count,
          likesCount: tiktokAccount.likes_count,
          videoCount: tiktokAccount.video_count,
          statsUpdatedAt: tiktokAccount.stats_updated_at,
        }
      : { connected: false },
    counts: {
      youtubeChannels: channels.length,
      videosThisMonth,
      videosInRange,
      clipsInRange,
      clipsPostedInRange,
    },
    postings: postingsInRange.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      origin: p.origin,
      channelName: p.channel_name,
      updatedAt: p.updated_at,
    })),
  });
}

async function tiktokAccount(req, res) {
  const accountRow = await tiktokAccountsRepository.findActiveByClientId(req.session.user.id);
  if (!accountRow) return res.json({ connected: false });

  const account = await refreshTiktokStatsIfStale(accountRow);
  res.json({
    connected: true,
    displayName: account.display_name || account.tiktok_open_id,
    avatarUrl: account.avatar_url,
    connectedAt: account.connected_at,
    followerCount: account.follower_count,
    followingCount: account.following_count,
    likesCount: account.likes_count,
    videoCount: account.video_count,
    statsUpdatedAt: account.stats_updated_at,
    autoPostEnabled: account.auto_post_enabled,
  });
}

// Desligado por padrao (ver migration 017) - o cliente precisa ligar de
// proposito pra cortes prontos comecarem a entrar na fila de postagem.
async function setAutoPost(req, res) {
  const account = await tiktokAccountsRepository.findActiveByClientId(req.session.user.id);
  if (!account) return res.status(404).json({ error: 'Nenhuma conta TikTok conectada.' });

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
  const account = await tiktokAccountsRepository.findActiveByClientId(req.session.user.id);
  if (!account) return res.status(404).json({ error: 'Nenhuma conta TikTok conectada.' });

  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  res.json(scheduleToApi(settings));
}

async function setSchedule(req, res) {
  const account = await tiktokAccountsRepository.findActiveByClientId(req.session.user.id);
  if (!account) return res.status(404).json({ error: 'Nenhuma conta TikTok conectada.' });

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

async function usage(req, res) {
  const clientUserId = req.session.user.id;
  const { range, since, until } = resolveRange(req.query.range);
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [rangeUsage, history] = await Promise.all([
    metricsRepository.clientUsageSince(clientUserId, since, until),
    metricsRepository.clientUsageHistory(clientUserId, since30d),
  ]);

  res.json({
    range: { key: range, since, until },
    videosInRange: rangeUsage.videos_count,
    minutesInRange: Math.round(rangeUsage.total_duration_seconds / 60),
    history: history.map((h) => ({ date: h.day, videosCount: h.videos_count })),
  });
}

module.exports = { dashboard, tiktokAccount, setAutoPost, getSchedule, setSchedule, usage };

'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const tiktokService = require('../../../services/tiktokService');
const { resolveRange } = require('../../../lib/dateRanges');

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
  });
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

module.exports = { dashboard, tiktokAccount, usage };

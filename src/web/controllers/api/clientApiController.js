'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function dashboard(req, res) {
  const clientUserId = req.session.user.id;
  const since = startOfMonth();

  const [tiktokAccount, postings, channels, videosThisMonth, clipsThisMonth, clipsPostedThisMonth] =
    await Promise.all([
      tiktokAccountsRepository.findActiveByClientId(clientUserId),
      postingsRepository.listForClient(clientUserId),
      youtubeChannelsRepository.listByClientId(clientUserId),
      sourceVideosRepository.countByClientSince(clientUserId, since),
      clipsRepository.countByClientSince(clientUserId, since),
      clipsRepository.countPostedByClientSince(clientUserId, since),
    ]);

  res.json({
    tiktokAccount: tiktokAccount
      ? { connected: true, displayName: tiktokAccount.display_name || tiktokAccount.tiktok_open_id }
      : { connected: false },
    counts: {
      youtubeChannels: channels.length,
      videosThisMonth,
      clipsThisMonth,
      clipsPostedThisMonth,
    },
    postings: postings.map((p) => ({
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
  const account = await tiktokAccountsRepository.findActiveByClientId(req.session.user.id);
  res.json(
    account
      ? {
          connected: true,
          displayName: account.display_name || account.tiktok_open_id,
          avatarUrl: account.avatar_url,
          connectedAt: account.connected_at,
        }
      : { connected: false }
  );
}

async function usage(req, res) {
  const clientUserId = req.session.user.id;
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [monthUsage, history] = await Promise.all([
    metricsRepository.clientUsageSince(clientUserId, startOfMonth()),
    metricsRepository.clientUsageHistory(clientUserId, since30d),
  ]);

  res.json({
    videosThisMonth: monthUsage.videos_count,
    minutesThisMonth: Math.round(monthUsage.total_duration_seconds / 60),
    history: history.map((h) => ({ date: h.day, videosCount: h.videos_count })),
  });
}

module.exports = { dashboard, tiktokAccount, usage };

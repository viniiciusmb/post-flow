'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');

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
      updatedAt: p.updated_at,
    })),
  });
}

module.exports = { dashboard };

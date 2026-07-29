'use strict';

const usersRepository = require('../../../repositories/usersRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const { ROLES } = require('../../../config/constants');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function dashboard(req, res) {
  const [clients, postings, channels, videosInProgress, clipsToday] = await Promise.all([
    usersRepository.listByRole(ROLES.CLIENT),
    postingsRepository.listAllWithDetails(),
    youtubeChannelsRepository.listActive(),
    sourceVideosRepository.countInProgress(),
    clipsRepository.countCreatedSince(startOfToday()),
  ]);

  res.json({
    counts: {
      clients: clients.length,
      postings: postings.length,
      youtubeChannels: channels.length,
      videosInProgress,
      clipsToday,
    },
    postings: postings.map((p) => ({
      id: p.id,
      clientName: p.client_business_name || p.client_email,
      filename: p.filename,
      status: p.status,
      origin: p.origin,
      createdAt: p.created_at,
    })),
  });
}

module.exports = { dashboard };

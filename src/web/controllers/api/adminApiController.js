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

async function postings(req, res) {
  const rows = await postingsRepository.listAllWithDetails();
  res.json({
    postings: rows.map((p) => ({
      id: p.id,
      clientName: p.client_business_name || p.client_email,
      filename: p.filename,
      status: p.status,
      origin: p.origin,
      channelName: p.channel_name,
      tiktokDisplayName: p.tiktok_display_name,
      errorMessage: p.error_message,
      createdAt: p.created_at,
    })),
  });
}

async function clients(req, res) {
  const rows = await usersRepository.listClientsWithStats();
  res.json({
    clients: rows.map((c) => ({
      id: c.id,
      businessName: c.business_name,
      email: c.email,
      isActive: c.is_active,
      createdAt: c.created_at,
      channelCount: c.channel_count,
      tiktokConnected: Boolean(c.tiktok_display_name),
      tiktokDisplayName: c.tiktok_display_name,
    })),
  });
}

module.exports = { dashboard, postings, clients };

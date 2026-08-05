'use strict';

const bcrypt = require('bcryptjs');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const youtubeChannelsRepository = require('../../../repositories/youtubeChannelsRepository');
const sourceVideosRepository = require('../../../repositories/sourceVideosRepository');
const clipsRepository = require('../../../repositories/clipsRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const usersRepository = require('../../../repositories/usersRepository');

const { resolveRange } = require('../../../lib/dateRanges');

const SALT_ROUNDS = 12;

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function dashboard(req, res) {
  const clientUserId = req.session.user.id;
  const { range, since, until } = resolveRange(req.query.range);
  const sinceMonth = startOfMonth();

  const [tiktokAccounts, postings, channels, videosThisMonth, videosInRange, clipsInRange, clipsPostedInRange, pendingInQueue] =
    await Promise.all([
      tiktokAccountsRepository.listActiveByClientId(clientUserId),
      postingsRepository.listForClient(clientUserId),
      youtubeChannelsRepository.listByClientId(clientUserId),
      sourceVideosRepository.countByClientSince(clientUserId, sinceMonth),
      sourceVideosRepository.countByClientSince(clientUserId, since, until),
      clipsRepository.countByClientSince(clientUserId, since, until),
      clipsRepository.countPostedByClientSince(clientUserId, since, until),
      postingsRepository.countPendingForClient(clientUserId),
    ]);

  // Postagens do periodo escolhido, pra tabela do dashboard nao mostrar tudo
  // desde sempre quando o filtro e "Hoje".
  const postingsInRange = postings.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= since.getTime() && t <= until.getTime();
  });

  res.json({
    range: { key: range, since, until },
    tiktokAccounts: tiktokAccounts.map((a) => ({
      id: a.id,
      displayName: a.display_name || a.tiktok_open_id,
      avatarUrl: a.avatar_url,
    })),
    counts: {
      youtubeChannels: channels.length,
      videosThisMonth,
      videosInRange,
      clipsInRange,
      clipsPostedInRange,
      pendingInQueue,
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

async function getProfile(req, res) {
  const user = await usersRepository.findById(req.session.user.id);
  res.json({ businessName: user.business_name, email: user.email });
}

async function updateProfile(req, res) {
  const businessName = String(req.body.businessName || '').trim() || null;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: res.locals.t('erros.emailInvalido') });
  }

  const existing = await usersRepository.findByEmail(email);
  if (existing && existing.id !== req.session.user.id) {
    return res.status(409).json({ error: res.locals.t('erros.emailJaExiste') });
  }

  const updated = await usersRepository.updateProfile(req.session.user.id, { businessName, email });
  req.session.user.email = updated.email;
  res.json({ businessName: updated.business_name, email: updated.email });
}

async function updatePassword(req, res) {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) {
    return res.status(400).json({ error: res.locals.t('erros.senhaCurta') });
  }

  const user = await usersRepository.findById(req.session.user.id);
  const matches = user.password_hash && (await bcrypt.compare(currentPassword, user.password_hash));
  if (!matches) {
    return res.status(400).json({ error: res.locals.t('erros.senhaAtualIncorreta') });
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await usersRepository.updatePasswordHash(req.session.user.id, passwordHash);
  res.status(204).end();
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

module.exports = { dashboard, getProfile, updateProfile, updatePassword, usage };

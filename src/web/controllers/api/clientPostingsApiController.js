'use strict';

const postingsRepository = require('../../../repositories/postingsRepository');
const postingScheduleSettingsRepository = require('../../../repositories/postingScheduleSettingsRepository');
const { projectQueueTimes } = require('../../../lib/postingSchedule');

function thumbnailUrl(row) {
  return row.thumbnail_path ? `/api/client/source-videos/clips/${row.clip_id}/thumbnail` : null;
}

async function listQueue(req, res) {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const rows = await postingsRepository.listQueueForClient(req.session.user.id, accountId);

  // So da pra prever "vai postar quando" olhando a agenda de UMA conta -
  // sem accountId (fila combinada de varias contas) a estimativa fica null.
  let scheduledTimes = [];
  if (accountId) {
    const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(accountId);
    const postedToday = await postingsRepository.countTodayForAccount(accountId, settings.timezone);
    scheduledTimes = projectQueueTimes({
      mode: settings.mode,
      manualTimes: settings.manual_times,
      videosPerDay: settings.videos_per_day,
      timezone: settings.timezone,
      postedToday: Number(postedToday),
      count: rows.length,
    });
  }

  res.json({
    postings: rows.map((p, i) => ({
      id: p.id,
      clipTitle: p.clip_title,
      caption: p.caption ?? p.clip_description,
      thumbnailUrl: thumbnailUrl(p),
      startSeconds: Number(p.start_seconds),
      endSeconds: Number(p.end_seconds),
      createdAt: p.created_at,
      scheduledFor: scheduledTimes[i] ? scheduledTimes[i].toISOString() : null,
    })),
  });
}

async function listPosted(req, res) {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const rows = await postingsRepository.listPostedForClient(req.session.user.id, accountId);
  res.json({
    postings: rows.map((p) => ({
      id: p.id,
      clipTitle: p.clip_title,
      thumbnailUrl: thumbnailUrl(p),
      postedAt: p.posted_at,
      tiktokPostId: p.tiktok_post_id,
    })),
  });
}

async function updateCaption(req, res) {
  const caption = String(req.body.caption || '').trim();
  const updated = await postingsRepository.updateCaptionOwnedByClient(Number(req.params.id), req.session.user.id, caption);
  if (!updated) {
    return res.status(404).json({ error: 'Postagem nao encontrada ou ja saiu da fila de espera.' });
  }
  res.json({ id: updated.id, caption: updated.caption });
}

async function skip(req, res) {
  const updated = await postingsRepository.skipOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!updated) {
    return res.status(404).json({ error: 'Postagem nao encontrada ou ja saiu da fila de espera.' });
  }
  res.status(204).end();
}

module.exports = { listQueue, listPosted, updateCaption, skip };

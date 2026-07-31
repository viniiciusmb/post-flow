'use strict';

const postingsRepository = require('../../../repositories/postingsRepository');

function thumbnailUrl(row) {
  return row.thumbnail_path ? `/api/client/source-videos/clips/${row.clip_id}/thumbnail` : null;
}

// scheduled_for e gravado uma unica vez quando a postagem entra na fila
// (ver postingsRepository.createIfNotExists) e so muda de novo se alguem
// pedir "Corrigir horarios" - aqui so ajusta a EXIBICAO: um horario que ja
// passou (fila atrasada) mostra "agora" em vez de uma hora no passado,
// sem mexer no valor gravado.
function displayScheduledFor(scheduledFor) {
  if (!scheduledFor) return null;
  const date = new Date(scheduledFor);
  const now = new Date();
  return (date < now ? now : date).toISOString();
}

async function listQueue(req, res) {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const rows = await postingsRepository.listQueueForClient(req.session.user.id, accountId);

  res.json({
    postings: rows.map((p) => ({
      id: p.id,
      clipTitle: p.clip_title,
      caption: p.caption ?? p.clip_description,
      thumbnailUrl: thumbnailUrl(p),
      startSeconds: Number(p.start_seconds),
      endSeconds: Number(p.end_seconds),
      createdAt: p.created_at,
      scheduledFor: displayScheduledFor(p.scheduled_for),
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

async function listErrors(req, res) {
  const accountId = req.query.accountId ? Number(req.query.accountId) : null;
  const rows = await postingsRepository.listErrorForClient(req.session.user.id, accountId);
  res.json({
    postings: rows.map((p) => ({
      id: p.id,
      clipTitle: p.clip_title,
      thumbnailUrl: thumbnailUrl(p),
      errorMessage: p.error_message,
      updatedAt: p.updated_at,
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

module.exports = { listQueue, listPosted, listErrors, updateCaption, skip };

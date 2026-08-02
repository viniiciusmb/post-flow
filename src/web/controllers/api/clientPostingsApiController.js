'use strict';

const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const tiktokPostingJob = require('../../../worker/jobs/tiktokPostingJob');

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
      clipId: p.clip_id,
      clipTitle: p.clip_title,
      caption: p.caption ?? p.clip_description,
      thumbnailUrl: thumbnailUrl(p),
      startSeconds: Number(p.start_seconds),
      endSeconds: Number(p.end_seconds),
      createdAt: p.created_at,
      scheduledFor: displayScheduledFor(p.scheduled_for),
      channelId: p.channel_id,
      channelName: p.channel_name,
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
      channelId: p.channel_id,
      channelName: p.channel_name,
    })),
  });
}

async function updateCaption(req, res) {
  const caption = String(req.body.caption || '').trim();
  const updated = await postingsRepository.updateCaptionOwnedByClient(Number(req.params.id), req.session.user.id, caption);
  if (!updated) {
    return res.status(404).json({ error: 'Postagem não encontrada ou já saiu da fila de espera.' });
  }
  res.json({ id: updated.id, caption: updated.caption });
}

async function skip(req, res) {
  const updated = await postingsRepository.skipOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!updated) {
    return res.status(404).json({ error: 'Postagem não encontrada ou já saiu da fila de espera.' });
  }
  res.status(204).end();
}

// Botao "Enviar pra fila novamente" na aba Erro: so funciona em postagem
// que realmente esta com erro, volta pra pendente com um horario novo no
// fim da fila. "Tentar postar agora" (frontend) chama isso primeiro e na
// sequencia chama postNow.
async function retry(req, res) {
  const updated = await postingsRepository.retryOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!updated) {
    return res.status(404).json({ error: 'Postagem não encontrada ou não está com erro.' });
  }
  res.status(204).end();
}

// Botao "Postar agora": publica esse corte na hora, sem esperar o
// agendamento nem respeitar a pausa da fila - o cliente pediu explicitamente
// pra sair ja. Usa a mesma logica de publicacao do job de fundo
// (tiktokPostingJob.publish), so que disparada na hora em vez de num ciclo.
async function postNow(req, res) {
  const posting = await postingsRepository.findPublishableByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!posting) {
    return res.status(404).json({ error: 'Postagem não encontrada ou já saiu da fila de espera.' });
  }

  const account = await tiktokAccountsRepository.findActiveByIdAndClient(posting.tiktok_account_id, req.session.user.id);
  if (!account) {
    return res.status(404).json({ error: 'Conta TikTok não encontrada.' });
  }

  await tiktokPostingJob.publish(account, posting);

  const updated = await postingsRepository.findByIdOwnedByClient(posting.id, req.session.user.id);
  res.json({ id: updated.id, status: updated.status, errorMessage: updated.error_message });
}

module.exports = { listQueue, listPosted, listErrors, updateCaption, skip, postNow, retry };

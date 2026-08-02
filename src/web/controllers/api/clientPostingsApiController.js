'use strict';

const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const tiktokPostingJob = require('../../../worker/jobs/tiktokPostingJob');
const tiktokService = require('../../../services/tiktokService');
const logger = require('../../../lib/logger');

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
      // Escolhas de publicacao direta. optionsConfirmed diz se o criador ja
      // definiu; enquanto for false, a publicacao direta nao sai.
      optionsConfirmed: Boolean(p.options_confirmed_at),
      privacyLevel: p.privacy_level,
      disableComment: p.disable_comment,
      disableDuet: p.disable_duet,
      disableStitch: p.disable_stitch,
      brandOrganicToggle: p.brand_organic_toggle,
      brandContentToggle: p.brand_content_toggle,
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

// Opcoes que a conta do criador permite, buscadas NA HORA no TikTok.
//
// A diretriz da Content Posting API exige dados frescos toda vez que a tela de
// publicacao abre: o criador pode ter desativado comentario ou mudado a
// privacidade da conta no aplicativo a qualquer momento, e oferecer uma opcao
// que ele desativou faz a publicacao falhar depois do video ja enviado.
async function creatorOptions(req, res) {
  const conta = await tiktokAccountsRepository.findActiveByIdAndClient(
    Number(req.params.id),
    req.session.user.id
  );
  if (!conta) return res.status(404).json({ error: 'Conta TikTok não encontrada.' });

  try {
    const token = await tiktokAccountsRepository.getValidAccessToken(tiktokService, conta);
    const info = await tiktokService.queryCreatorInfo(token);
    await tiktokAccountsRepository.saveCreatorInfo(conta.id, info);
    res.json({ ...info, publishMode: conta.publish_mode });
  } catch (err) {
    logger.error(`Falha ao consultar opcoes de publicacao da conta ${conta.id}:`, err.message);
    res.status(502).json({ error: 'Não foi possível falar com o TikTok agora. Tente de novo em instantes.' });
  }
}

const PRIVACIDADES = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

// Salva o que o criador escolheu pra UM corte da fila.
async function saveOptions(req, res) {
  const {
    privacyLevel,
    disableComment,
    disableDuet,
    disableStitch,
    brandOrganicToggle,
    brandContentToggle,
  } = req.body;

  // Sem privacidade escolhida nao ha o que salvar: e justamente a escolha que
  // a TikTok exige que seja manual.
  if (!PRIVACIDADES.includes(privacyLevel)) {
    return res.status(400).json({ error: 'Escolha quem pode ver esse vídeo.' });
  }
  // Conteudo de parceria paga nao pode ser privado - regra da TikTok. A tela ja
  // impede, mas quem chama a API direto tambem precisa esbarrar nisso.
  if (brandContentToggle && privacyLevel === 'SELF_ONLY') {
    return res.status(400).json({
      error: 'Conteúdo de parceria paga não pode ficar visível só pra você. Escolha outra privacidade.',
    });
  }

  const salvo = await postingsRepository.saveDirectPostOptionsOwnedByClient(
    Number(req.params.id),
    req.session.user.id,
    {
      privacyLevel,
      disableComment: Boolean(disableComment),
      disableDuet: Boolean(disableDuet),
      disableStitch: Boolean(disableStitch),
      brandOrganicToggle: Boolean(brandOrganicToggle),
      brandContentToggle: Boolean(brandContentToggle),
    }
  );
  if (!salvo) return res.status(404).json({ error: 'Corte não encontrado na fila.' });
  res.json({ ok: true });
}

module.exports = {
  creatorOptions,
  saveOptions, listQueue, listPosted, listErrors, updateCaption, skip, postNow, retry };

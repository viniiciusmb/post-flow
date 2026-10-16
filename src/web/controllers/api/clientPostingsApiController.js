'use strict';

const postingsRepository = require('../../../repositories/postingsRepository');
const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const tiktokPostingJob = require('../../../worker/jobs/tiktokPostingJob');
const tiktokService = require('../../../services/tiktokService');
const publishOptions = require('../../../lib/publishOptions');
const logger = require('../../../lib/logger');
const backfillPostingsService = require('../../../services/backfillPostingsService');

// Corte de live (desde 08/10/2026) vem com clip_id nulo e live_clip_id
// preenchido: o arquivo dele e servido pela rota das lives, que confere o dono.
function thumbnailUrl(row) {
  if (!row.thumbnail_path) return null;
  if (row.live_clip_id) return `/api/client/lives/cortes/${row.live_clip_id}/arquivo?capa=1`;
  return `/api/client/source-videos/clips/${row.clip_id}/thumbnail`;
}

function videoUrl(row) {
  if (row.live_clip_id) return `/api/client/lives/cortes/${row.live_clip_id}/arquivo`;
  return row.clip_id ? `/api/client/source-videos/clips/${row.clip_id}/download` : null;
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
      // Publicacao direta: o padrao vem da CONTA. optionsCustom diz se ESTE
      // corte foi tratado diferente do padrao - e o que a tela usa pra mostrar
      // "personalizado" e oferecer voltar ao padrao.
      optionsCustom: publishOptions.postagemTemOpcoesProprias(p),
      privacyLevel: p.privacy_level,
      disableComment: p.disable_comment,
      disableDuet: p.disable_duet,
      disableStitch: p.disable_stitch,
      brandOrganicToggle: p.brand_organic_toggle,
      brandContentToggle: p.brand_content_toggle,
      clipTitle: p.clip_title,
      caption: p.caption ?? p.clip_description,
      thumbnailUrl: thumbnailUrl(p),
      videoUrl: videoUrl(p),
      liveClipId: p.live_clip_id ? Number(p.live_clip_id) : null,
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
    return res.status(404).json({ error: res.locals.t('erros.postagemNaoNaFila') });
  }
  res.json({ id: updated.id, caption: updated.caption });
}

// Confere se a conta pertence a quem está pedindo. Devolve null quando não -
// as rotas abaixo respondem 404, nunca "não autorizado": dizer que a conta
// existe já é informação sobre a conta de outra pessoa.
async function contaDoCliente(req) {
  const id = Number(req.query.accountId ?? req.body?.accountId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const contas = await tiktokAccountsRepository.listActiveByClientId(req.session.user.id);
  return contas.find((c) => Number(c.id) === id) || null;
}

// Quantos cortes prontos estão FORA da fila desta conta, e por qual motivo.
//
// Existe porque o caso aconteceu de verdade: cortes ficaram prontos e nenhum
// apareceu na fila, sem nada em tela explicando nem nenhum jeito de corrigir
// sem mexer no banco.
async function pendencias(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const contagem = await backfillPostingsService.contarPendencias({
    clientUserId: req.session.user.id,
    tiktokAccountId: conta.id,
  });
  res.json(contagem);
}

// "Colocar cortes prontos na fila": pega o que nunca entrou em fila NENHUMA.
// Não mexe em postagem cancelada - isso é a outra rota, e de propósito.
async function enfileirarProntos(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const r = await backfillPostingsService.enfileirarCortesProntos({
    clientUserId: req.session.user.id,
    tiktokAccountId: conta.id,
  });
  res.json({ enfileirados: r.enfileirados || 0, ignorados: r.ignorados || 0 });
}

// "Voltar as canceladas para a fila". Ação separada porque cancelar foi uma
// decisão do cliente: juntá-la ao botão acima desfaria um cancelamento
// deliberado sem ele ter pedido.
async function reenfileirarCancelados(req, res) {
  const conta = await contaDoCliente(req);
  if (!conta) return res.status(404).json({ error: res.locals.t('erros.contaNaoEncontrada') });

  const r = await backfillPostingsService.reenfileirarCancelados({ tiktokAccountId: conta.id });
  res.json(r);
}

async function skip(req, res) {
  const updated = await postingsRepository.skipOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!updated) {
    return res.status(404).json({ error: res.locals.t('erros.postagemNaoNaFila') });
  }

  // Cancelar deixa um buraco no meio da fila: os cortes seguintes continuam
  // marcados pros horarios de depois do que saiu, e o horario vago fica sem
  // dono. Na pratica o cliente cancela o primeiro da fila e o proximo, que
  // podia sair as 8h, so sai as 12h - sem nada explicando.
  //
  // E exatamente a conta que o botao "Corrigir horarios de posts" ja fazia;
  // ela passa a rodar sozinha, porque ninguem descobre sozinho que precisa
  // clicar num botao depois de cancelar.
  //
  // Falhar aqui nao pode desfazer o cancelamento, que ja aconteceu e e o que o
  // cliente pediu - no pior caso a fila fica com o buraco, como antes.
  try {
    await postingsRepository.reflowScheduledFor(updated.tiktok_account_id);
  } catch (err) {
    logger.error(`Nao consegui recalcular os horarios da conta ${updated.tiktok_account_id} apos um cancelamento:`, err.message);
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
    return res.status(404).json({ error: res.locals.t('erros.postagemSemErro') });
  }
  res.status(204).end();
}

// Botao "Postar agora": publica esse corte na hora, sem esperar o
// agendamento nem respeitar a pausa da fila - o cliente pediu explicitamente
// pra sair ja. Usa a mesma logica de publicacao do job de fundo
// (tiktokPostingJob.publish), so que disparada na hora em vez de num ciclo.
// Teto de publicações por conta em 24 horas corridas, igual ao teto diário da
// tela (MAX_POSTS_POR_DIA). O TikTok começa a recusar como spam logo acima.
const LIMITE_TIKTOK_24H = 10;

async function postNow(req, res) {
  const posting = await postingsRepository.findPublishableByIdOwnedByClient(Number(req.params.id), req.session.user.id);
  if (!posting) {
    return res.status(404).json({ error: res.locals.t('erros.postagemNaoNaFila') });
  }

  const account = await tiktokAccountsRepository.findActiveByIdAndClient(posting.tiktok_account_id, req.session.user.id);
  if (!account) {
    return res.status(404).json({ error: res.locals.t('erros.contaTiktokNaoEncontrada') });
  }

  // "Postar agora" passa por cima do horário e do "por dia", mas não do limite
  // do próprio TikTok: acima disso ele recusa como spam e a conta fica marcada.
  // Foi o que aconteceu em 11/10/2026 (3 cortes reenviados à mão em 1 minuto,
  // numa conta que já tinha publicado o dia inteiro).
  const recentes = await postingsRepository.countRecentForAccount(account.id, 24);
  if (recentes >= LIMITE_TIKTOK_24H) {
    return res.status(429).json({ error: res.locals.t('erros.limiteDoTiktok24h', { n: recentes }) });
  }

  // Nem em rajada: o mesmo espaçamento que a fila automática respeita. Em
  // 15/10/2026 um cliente clicou "Postar agora" em 10 cortes em 2 minutos e
  // saíram 6 vídeos em 1 minuto numa conta só - o padrão que já tinha feito o
  // TikTok marcar outra conta como spam.
  const espaco = tiktokPostingJob.ESPACO_MINIMO_ENTRE_POSTS_MIN;
  const ultima = await postingsRepository.ultimaPublicacaoNosUltimosMinutos(account.id, espaco);
  if (ultima) {
    const faltam = Math.max(1, Math.ceil((new Date(ultima).getTime() + espaco * 60e3 - Date.now()) / 60e3));
    return res.status(429).json({ error: res.locals.t('erros.esperarEntrePosts', { espaco, faltam }) });
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
  if (!conta) return res.status(404).json({ error: res.locals.t('erros.contaTiktokNaoEncontrada') });

  try {
    const token = await tiktokAccountsRepository.getValidAccessToken(tiktokService, conta);
    const info = await tiktokService.queryCreatorInfo(token);
    await tiktokAccountsRepository.saveCreatorInfo(conta.id, info);
    res.json({ ...info, publishMode: conta.publish_mode });
  } catch (err) {
    logger.error(`Falha ao consultar opcoes de publicacao da conta ${conta.id}:`, err.message);
    res.status(502).json({ error: res.locals.t('erros.tiktokIndisponivel') });
  }
}

// Salva opcoes so pra UM corte, diferentes do padrao da conta.
async function saveOptions(req, res) {
  const {
    privacyLevel,
    disableComment,
    disableDuet,
    disableStitch,
    brandOrganicToggle,
    brandContentToggle,
  } = req.body;

  const problema = publishOptions.validar({ privacyLevel, brandContentToggle });
  if (problema) return res.status(400).json({ error: problema });

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
  if (!salvo) return res.status(404).json({ error: res.locals.t('erros.corteNaoNaFila') });
  res.json({ ok: true });
}

// Desfaz a personalizacao: o corte volta a seguir o padrao da conta.
async function clearOptions(req, res) {
  const limpo = await postingsRepository.clearDirectPostOptionsOwnedByClient(
    Number(req.params.id),
    req.session.user.id
  );
  if (!limpo) return res.status(404).json({ error: res.locals.t('erros.corteNaoNaFila') });
  res.json({ ok: true });
}

module.exports = {
  pendencias,
  enfileirarProntos,
  reenfileirarCancelados,
  creatorOptions,
  clearOptions,
  saveOptions, listQueue, listPosted, listErrors, updateCaption, skip, postNow, retry };

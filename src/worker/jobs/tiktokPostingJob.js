// Consome a fila de postagens pendentes (postings.status='pending') e publica
// no TikTok em modo rascunho/inbox - ate aqui nada fazia isso, a fila so
// crescia parada (ver migrations/006_create_postings.sql e a memoria do
// projeto). Roda a cada ~10 min (ver videoScheduler.js).
'use strict';

const fs = require('fs');
const postingsRepository = require('../../repositories/postingsRepository');
const postingScheduleSettingsRepository = require('../../repositories/postingScheduleSettingsRepository');
const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const tiktokService = require('../../services/tiktokService');
const errorReportService = require('../../services/errorReportService');
const logger = require('../../lib/logger');

const AUTO_WINDOW_START_HOUR = 8;
const AUTO_WINDOW_END_HOUR = 22;

async function run() {
  await checkStaleProcessing();

  const accounts = await tiktokAccountsRepository.listActive();
  for (const account of accounts) {
    if (!account.auto_post_enabled) continue;
    try {
      await maybePublishNext(account);
    } catch (err) {
      logger.error(`Falha ao processar fila de postagem da conta TikTok ${account.id}:`, err);
    }
  }
}

function nowInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === 'hour').value),
    minute: Number(parts.find((p) => p.type === 'minute').value),
  };
}

function toMinutesOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

async function maybePublishNext(account) {
  const settings = await postingScheduleSettingsRepository.findOrCreateByTiktokAccountId(account.id);
  if (settings.paused) return;

  const postedToday = await postingsRepository.countTodayForAccount(account.id, settings.timezone);
  if (postedToday >= settings.videos_per_day) return;

  const { hour, minute } = nowInTimezone(settings.timezone);
  const nowMinutes = hour * 60 + minute;

  if (settings.mode === 'manual') {
    const allowedSoFar = settings.manual_times.filter((t) => toMinutesOfDay(t) <= nowMinutes).length;
    if (postedToday >= allowedSoFar) return;
  } else {
    if (hour < AUTO_WINDOW_START_HOUR || hour >= AUTO_WINDOW_END_HOUR) return;
    const lastPostedAt = await postingsRepository.mostRecentPostedAt(account.id);
    if (lastPostedAt) {
      const minGapMinutes = Math.max(
        20,
        Math.floor(((AUTO_WINDOW_END_HOUR - AUTO_WINDOW_START_HOUR) * 60) / settings.videos_per_day)
      );
      const elapsedMinutes = (Date.now() - new Date(lastPostedAt).getTime()) / 60000;
      if (elapsedMinutes < minGapMinutes) return;
    }
  }

  const posting = await postingsRepository.findOldestPendingForAccount(account.id);
  if (!posting) return;
  await publish(account, posting);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publish(account, posting) {
  if (!posting.local_clip_path || !fs.existsSync(posting.local_clip_path)) {
    await postingsRepository.updateStatus(posting.id, {
      status: 'error',
      errorMessage: null,
    });
    return;
  }

  await postingsRepository.updateStatus(posting.id, { status: 'queued' });

  try {
    const accessToken = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
    const videoSizeBytes = posting.file_size_bytes || fs.statSync(posting.local_clip_path).size;

    // Dois caminhos, com exigencias bem diferentes:
    //
    //   inbox  - o corte chega como rascunho e o criador finaliza dentro do
    //            aplicativo do TikTok. Quem coleta privacidade, comentarios e
    //            duetos e o proprio TikTok, entao nao ha nada a perguntar aqui.
    //
    //   direct - vai direto pro perfil. A TikTok exige que privacidade,
    //            interacoes e divulgacao comercial tenham sido escolhidas
    //            MANUALMENTE pelo criador antes. Se ninguem escolheu, nao
    //            publicamos: pular e melhor que publicar com um padrao que a
    //            pessoa nunca viu.
    const modoDireto = account.publish_mode === 'direct';
    if (modoDireto && !posting.options_confirmed_at) {
      logger.info(
        `Corte "${posting.clip_title}" (postagem ${posting.id}) esta esperando o cliente escolher as opcoes de publicacao - pulando.`
      );
      return;
    }

    const { publishId, uploadUrl, chunkSize, totalChunkCount } = modoDireto
      ? await tiktokService.initDirectPost(accessToken, videoSizeBytes, {
          caption: posting.caption,
          privacyLevel: posting.privacy_level,
          disableComment: posting.disable_comment,
          disableDuet: posting.disable_duet,
          disableStitch: posting.disable_stitch,
          brandContentToggle: posting.brand_content_toggle,
          brandOrganicToggle: posting.brand_organic_toggle,
        })
      : await tiktokService.initInboxVideo(accessToken, videoSizeBytes);
    await tiktokService.uploadVideoFile(uploadUrl, posting.local_clip_path, videoSizeBytes, chunkSize, totalChunkCount);
    await postingsRepository.updateStatus(posting.id, { status: 'processing', tiktokPublishId: publishId });
    logger.info(`Corte "${posting.clip_title}" enviado pro TikTok (conta ${account.id}), aguardando confirmacao.`);

    // Tenta confirmar rapido (a TikTok as vezes processa em segundos); se nao
    // der tempo, checkStaleProcessing() fecha isso no proximo ciclo do job.
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(5000);
      const result = await tiktokService.fetchPublishStatus(accessToken, publishId);
      if (result.done) {
        await postingsRepository.updateStatus(posting.id, {
          status: 'posted',
          tiktokPostId: (result.postIds || [])[0] || null,
        });
        return;
      }
      if (result.failed) {
        await postingsRepository.updateStatus(posting.id, { status: 'error', errorMessage: null });
        await errorReportService.report({
          operation: errorReportService.OPERACOES.TIKTOK_POSTING,
          entityType: 'posting',
          entityId: posting.id,
          clientUserId: account.client_user_id || null,
          error: new Error(result.failReason || 'A TikTok recusou a publicacao.'),
        });
        return;
      }
    }
  } catch (err) {
    logger.error(`Falha ao publicar posting ${posting.id} no TikTok:`, err);
    // Sem mensagem tecnica na tela do cliente - ela vive no painel de erros.
    await postingsRepository.updateStatus(posting.id, { status: 'error', errorMessage: null });
    await errorReportService.report({
      operation: errorReportService.OPERACOES.TIKTOK_POSTING,
      entityType: 'posting',
      entityId: posting.id,
      clientUserId: account.client_user_id || null,
      error: err,
    });
  }
}

async function checkStaleProcessing() {
  const stale = await postingsRepository.listStaleProcessing();
  for (const posting of stale) {
    if (!posting.tiktok_publish_id) continue;
    try {
      const account = await tiktokAccountsRepository.findById(posting.tiktok_account_id);
      if (!account) continue;
      const accessToken = await tiktokAccountsRepository.getValidAccessToken(tiktokService, account);
      const result = await tiktokService.fetchPublishStatus(accessToken, posting.tiktok_publish_id);
      if (result.done) {
        await postingsRepository.updateStatus(posting.id, {
          status: 'posted',
          tiktokPostId: (result.postIds || [])[0] || null,
        });
      } else if (result.failed) {
        await postingsRepository.updateStatus(posting.id, { status: 'error', errorMessage: null });
        await errorReportService.report({
          operation: errorReportService.OPERACOES.TIKTOK_POSTING,
          entityType: 'posting',
          entityId: posting.id,
          clientUserId: account.client_user_id || null,
          error: new Error(result.failReason || 'A TikTok recusou a publicacao.'),
        });
      }
    } catch (err) {
      logger.error(`Falha ao checar status da postagem ${posting.id} no TikTok:`, err);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.TIKTOK_POSTING,
        entityType: 'posting',
        entityId: posting.id,
        error: err,
      });
    }
  }
}

// publish() tambem e chamado direto pelo botao "Postar agora" (ver
// clientPostingsApiController.postNow) - contorna fila/espacamento/pausa
// de proposito, e o cliente pedindo explicitamente pra sair na hora.
module.exports = { run, publish };

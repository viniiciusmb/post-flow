// Reprocessa sozinho videos que provavelmente falharam por causa de erro
// transitorio de rede/proxy (ex: proxy pago e rele Tailscale indisponiveis
// ao mesmo tempo por alguns minutos) e resgata videos que ficaram "detected"
// sem nunca comecar (protecao pro caso raro do enfileiramento falhar
// silenciosamente entre a deteccao e o processamento). Sem isso o cliente
// precisa notar o erro e clicar em "tentar novamente" manualmente.
'use strict';

const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const youtubeChannelsRepository = require('../../repositories/youtubeChannelsRepository');
const queueService = require('../../services/queueService');
const queuePriorityService = require('../../services/queuePriorityService');
const logger = require('../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

// Mesma logica de posse do processVideoJob.js - video de canal pertence ao
// cliente dono do canal, video avulso/upload ja guarda o cliente direto.
async function resolveClientId(sourceVideo) {
  if (!sourceVideo.youtube_channel_id) return sourceVideo.client_user_id;
  const channel = await youtubeChannelsRepository.findById(sourceVideo.youtube_channel_id);
  return channel.client_user_id;
}

async function run() {
  const boss = await queueService.getBoss();

  const transientErrors = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  for (const sourceVideo of transientErrors) {
    await clipsRepository.deleteBySourceVideoId(sourceVideo.id);
    const updated = await sourceVideosRepository.resetForAutoRetry(sourceVideo.id);
    if (!updated) continue;
    const priority = await queuePriorityService.resolveQueuePriorityForClient(await resolveClientId(sourceVideo));
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });
    logger.info(
      `Retry automatico do video-fonte ${sourceVideo.id} (tentativa ${updated.auto_retry_count}/3, erro parecia transitorio).`
    );
  }

  const stuckDetected = await sourceVideosRepository.findStuckDetected();
  for (const sourceVideo of stuckDetected) {
    const priority = await queuePriorityService.resolveQueuePriorityForClient(await resolveClientId(sourceVideo));
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id }, { priority });
    logger.info(`Video-fonte ${sourceVideo.id} estava preso em "detected" ha mais de 30min - reenfileirado.`);
  }
}

module.exports = { run };

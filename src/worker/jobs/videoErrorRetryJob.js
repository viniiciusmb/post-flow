// Reprocessa sozinho videos que provavelmente falharam por causa de erro
// transitorio de rede/proxy (ex: proxy pago e rele Tailscale indisponiveis
// ao mesmo tempo por alguns minutos) e resgata videos que ficaram "detected"
// sem nunca comecar (protecao pro caso raro do enfileiramento falhar
// silenciosamente entre a deteccao e o processamento). Sem isso o cliente
// precisa notar o erro e clicar em "tentar novamente" manualmente.
'use strict';

const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const queueService = require('../../services/queueService');
const logger = require('../../lib/logger');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function run() {
  const boss = await queueService.getBoss();

  const transientErrors = await sourceVideosRepository.findTransientErrorsForAutoRetry();
  for (const sourceVideo of transientErrors) {
    await clipsRepository.deleteBySourceVideoId(sourceVideo.id);
    const updated = await sourceVideosRepository.resetForAutoRetry(sourceVideo.id);
    if (!updated) continue;
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id });
    logger.info(
      `Retry automatico do video-fonte ${sourceVideo.id} (tentativa ${updated.auto_retry_count}/3, erro parecia transitorio).`
    );
  }

  const stuckDetected = await sourceVideosRepository.findStuckDetected();
  for (const sourceVideo of stuckDetected) {
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: sourceVideo.id });
    logger.info(`Video-fonte ${sourceVideo.id} estava preso em "detected" ha mais de 30min - reenfileirado.`);
  }
}

module.exports = { run };

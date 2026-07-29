'use strict';

const channelCheckJob = require('./videoJobs/channelCheckJob');
const processVideoJob = require('./videoJobs/processVideoJob');
const videoErrorRetryJob = require('./jobs/videoErrorRetryJob');
const tiktokPostingJob = require('./jobs/tiktokPostingJob');
const postingCleanupJob = require('./jobs/postingCleanupJob');
const driveExportJob = require('./jobs/driveExportJob');
const logger = require('../lib/logger');

const QUEUE_CHANNEL_CHECK = 'youtube-channel-check';
const QUEUE_VIDEO_PROCESSING = 'video-processing';
const QUEUE_VIDEO_ERROR_RETRY = 'video-error-retry';
const QUEUE_TIKTOK_POSTING = 'tiktok-posting';
const QUEUE_POSTING_CLEANUP = 'posting-cleanup';
const QUEUE_DRIVE_EXPORT = 'drive-export';

async function start(boss) {
  await boss.createQueue(QUEUE_CHANNEL_CHECK);
  await boss.createQueue(QUEUE_VIDEO_PROCESSING);
  await boss.createQueue(QUEUE_VIDEO_ERROR_RETRY);
  await boss.createQueue(QUEUE_TIKTOK_POSTING);
  await boss.createQueue(QUEUE_POSTING_CLEANUP);
  await boss.createQueue(QUEUE_DRIVE_EXPORT);

  await boss.schedule(QUEUE_CHANNEL_CHECK, '*/20 * * * *');
  logger.info('Checagem de canais do YouTube agendada a cada 20 minutos.');

  await boss.schedule(QUEUE_VIDEO_ERROR_RETRY, '*/15 * * * *');
  logger.info('Retry automatico de video com erro agendado a cada 15 minutos.');

  // Publicacao no TikTok e exportacao pro Drive precisam ler o arquivo do
  // corte em disco - por isso rodam aqui (video-worker ja tem acesso ao
  // volume compartilhado), nao no worker leve (Drive de origem/metricas).
  await boss.schedule(QUEUE_TIKTOK_POSTING, '*/10 * * * *');
  logger.info('Fila de postagem no TikTok agendada a cada 10 minutos.');

  await boss.schedule(QUEUE_POSTING_CLEANUP, '5 * * * *');
  logger.info('Limpeza de postagens antigas agendada de hora em hora.');

  await boss.schedule(QUEUE_DRIVE_EXPORT, '*/15 * * * *');
  logger.info('Exportacao de cortes prontos pro Drive do cliente agendada a cada 15 minutos.');

  await boss.work(QUEUE_CHANNEL_CHECK, async () => {
    logger.info('Checando canais do YouTube...');
    await channelCheckJob.run(boss);
    logger.info('Checagem de canais concluida.');
  });

  await boss.work(QUEUE_VIDEO_ERROR_RETRY, async () => {
    await videoErrorRetryJob.run();
  });

  await boss.work(QUEUE_TIKTOK_POSTING, async () => {
    await tiktokPostingJob.run();
  });

  await boss.work(QUEUE_POSTING_CLEANUP, async () => {
    await postingCleanupJob.run();
  });

  await boss.work(QUEUE_DRIVE_EXPORT, async () => {
    await driveExportJob.run();
  });

  // Sem passar batchSize/teamSize: o pg-boss so busca o proximo job depois
  // que o handler atual terminar - e assim que garantimos "1 video por vez".
  await boss.work(QUEUE_VIDEO_PROCESSING, async ([job]) => {
    logger.info(`Processando video-fonte #${job.data.sourceVideoId}...`);
    await processVideoJob.run(job.data.sourceVideoId);
    logger.info(`Processamento do video-fonte #${job.data.sourceVideoId} concluido.`);
  });
}

module.exports = { start };

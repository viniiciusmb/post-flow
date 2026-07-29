'use strict';

const channelCheckJob = require('./videoJobs/channelCheckJob');
const processVideoJob = require('./videoJobs/processVideoJob');
const logger = require('../lib/logger');

const QUEUE_CHANNEL_CHECK = 'youtube-channel-check';
const QUEUE_VIDEO_PROCESSING = 'video-processing';

async function start(boss) {
  await boss.createQueue(QUEUE_CHANNEL_CHECK);
  await boss.createQueue(QUEUE_VIDEO_PROCESSING);

  await boss.schedule(QUEUE_CHANNEL_CHECK, '*/20 * * * *');
  logger.info('Checagem de canais do YouTube agendada a cada 20 minutos.');

  await boss.work(QUEUE_CHANNEL_CHECK, async () => {
    logger.info('Checando canais do YouTube...');
    await channelCheckJob.run(boss);
    logger.info('Checagem de canais concluida.');
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

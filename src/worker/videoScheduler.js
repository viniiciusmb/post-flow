'use strict';

const channelCheckJob = require('./videoJobs/channelCheckJob');
const processVideoJob = require('./videoJobs/processVideoJob');
const videoErrorRetryJob = require('./jobs/videoErrorRetryJob');
const tiktokPostingJob = require('./jobs/tiktokPostingJob');
const postingCleanupJob = require('./jobs/postingCleanupJob');
const driveExportJob = require('./jobs/driveExportJob');
const tailscaleTestJob = require('./jobs/tailscaleTestJob');
const tunnelTestJob = require('./jobs/tunnelTestJob');
const logger = require('../lib/logger');

const QUEUE_CHANNEL_CHECK = 'youtube-channel-check';
const QUEUE_VIDEO_PROCESSING = 'video-processing';
const QUEUE_VIDEO_ERROR_RETRY = 'video-error-retry';
const QUEUE_TIKTOK_POSTING = 'tiktok-posting';
const QUEUE_POSTING_CLEANUP = 'posting-cleanup';
const QUEUE_DRIVE_EXPORT = 'drive-export';
const QUEUE_TAILSCALE_TEST = 'tailscale-test';
const QUEUE_TUNNEL_TEST_ONE = 'tunnel-test-one';
const QUEUE_TUNNEL_TEST_ALL = 'tunnel-test-all';

async function start(boss) {
  await boss.createQueue(QUEUE_CHANNEL_CHECK);
  await boss.createQueue(QUEUE_VIDEO_PROCESSING);
  await boss.createQueue(QUEUE_VIDEO_ERROR_RETRY);
  await boss.createQueue(QUEUE_TIKTOK_POSTING);
  await boss.createQueue(QUEUE_POSTING_CLEANUP);
  await boss.createQueue(QUEUE_DRIVE_EXPORT);
  await boss.createQueue(QUEUE_TAILSCALE_TEST);
  await boss.createQueue(QUEUE_TUNNEL_TEST_ONE);
  await boss.createQueue(QUEUE_TUNNEL_TEST_ALL);

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

  await boss.schedule(QUEUE_TUNNEL_TEST_ALL, '*/5 * * * *');
  logger.info('Teste de todos os tuneis SSH agendado a cada 5 minutos.');

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

  // Sem agendamento - so roda quando o admin clica "Testar conexao" na tela
  // Tailscale.
  await boss.work(QUEUE_TAILSCALE_TEST, async () => {
    await tailscaleTestJob.run();
  });

  // Sem agendamento - so roda quando o usuario clica "Testar conexao" na
  // tela do Tunel (1 tunel especifico, dono passado no job.data).
  await boss.work(QUEUE_TUNNEL_TEST_ONE, async ([job]) => {
    await tunnelTestJob.runOne(job.data.tunnelId);
  });

  await boss.work(QUEUE_TUNNEL_TEST_ALL, async () => {
    await tunnelTestJob.runAll();
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

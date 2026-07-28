'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const driveDiscoveryJob = require('./jobs/driveDiscoveryJob');
const logger = require('../lib/logger');

const QUEUE_DRIVE_DISCOVERY = 'drive-discovery';

async function start(boss) {
  await boss.createQueue(QUEUE_DRIVE_DISCOVERY);

  const intervalMinutes = await settingsRepository.getValue('drive_poll_interval_minutes', 5);
  const cron = `*/${intervalMinutes} * * * *`;
  await boss.schedule(QUEUE_DRIVE_DISCOVERY, cron);
  logger.info(`Checagem do Google Drive agendada a cada ${intervalMinutes} minuto(s).`);

  await boss.work(QUEUE_DRIVE_DISCOVERY, async () => {
    logger.info('Checando pastas do Drive...');
    await driveDiscoveryJob.run();
    logger.info('Checagem do Drive concluida.');
  });
}

module.exports = { start };

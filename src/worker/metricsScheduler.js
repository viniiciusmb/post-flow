'use strict';

const metricsRollupJob = require('./jobs/metricsRollupJob');
const logger = require('../lib/logger');

const QUEUE_METRICS_ROLLUP = 'metrics-rollup';

async function start(boss) {
  await boss.createQueue(QUEUE_METRICS_ROLLUP);
  await boss.schedule(QUEUE_METRICS_ROLLUP, '10 0 * * *'); // 00:10 todo dia
  logger.info('Fechamento diario de metricas agendado para 00:10.');

  await boss.work(QUEUE_METRICS_ROLLUP, async () => {
    logger.info('Calculando resumo diario de metricas...');
    await metricsRollupJob.run();
    logger.info('Resumo diario de metricas concluido.');
  });
}

module.exports = { start };

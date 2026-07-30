'use strict';

const metricsRollupJob = require('./jobs/metricsRollupJob');
const systemMetricsSampleJob = require('./jobs/systemMetricsSampleJob');
const logger = require('../lib/logger');

const QUEUE_METRICS_ROLLUP = 'metrics-rollup';
const QUEUE_SYSTEM_METRICS_SAMPLE = 'system-metrics-sample';

async function start(boss) {
  await boss.createQueue(QUEUE_METRICS_ROLLUP);
  await boss.schedule(QUEUE_METRICS_ROLLUP, '10 0 * * *'); // 00:10 todo dia
  logger.info('Fechamento diario de metricas agendado para 00:10.');

  await boss.work(QUEUE_METRICS_ROLLUP, async () => {
    logger.info('Calculando resumo diario de metricas...');
    await metricsRollupJob.run();
    logger.info('Resumo diario de metricas concluido.');
  });

  await boss.createQueue(QUEUE_SYSTEM_METRICS_SAMPLE);
  await boss.schedule(QUEUE_SYSTEM_METRICS_SAMPLE, '*/5 * * * *'); // a cada 5min
  logger.info('Amostragem de metricas da VPS agendada a cada 5 minutos.');

  await boss.work(QUEUE_SYSTEM_METRICS_SAMPLE, async () => {
    await systemMetricsSampleJob.run();
  });
}

module.exports = { start };

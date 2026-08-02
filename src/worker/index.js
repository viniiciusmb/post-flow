'use strict';

// Processo 2: tarefas em segundo plano (checar Drive, postar no TikTok).
// A fila (pg-boss) mantem o processo vivo sozinha - nao precisa de setInterval manual.
const config = require('../config');
const pool = require('../db/pool');
const logger = require('../lib/logger');
const queueService = require('../services/queueService');
const { startHeartbeat } = require('../lib/heartbeat');
const processGuard = require('../lib/processGuard');
const scheduler = require('./scheduler');
const metricsScheduler = require('./metricsScheduler');

processGuard.install('worker', { onShutdown: () => queueService.stopBoss() });

async function main() {
  await pool.query('SELECT 1');
  const boss = await queueService.getBoss();
  await scheduler.start(boss);
  await metricsScheduler.start(boss);
  startHeartbeat('worker');
  logger.info(`Worker iniciado (env=${config.env}).`);
}

main().catch((err) => {
  logger.error('Falha ao iniciar o worker:', err);
  process.exit(1);
});

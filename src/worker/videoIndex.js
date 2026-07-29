'use strict';

// Processo 3: pipeline de cortes automaticos do YouTube. Separado do worker
// de postagem (src/worker/index.js) de proposito - e uma carga de trabalho
// pesada (download, transcricao, ffmpeg) e nao deve competir por recursos
// nem travar a checagem do Drive/postagem se travar ou cair.
const config = require('../config');
const pool = require('../db/pool');
const logger = require('../lib/logger');
const queueService = require('../services/queueService');
const { startHeartbeat } = require('../lib/heartbeat');
const videoScheduler = require('./videoScheduler');

async function main() {
  await pool.query('SELECT 1');
  const boss = await queueService.getBoss();
  await videoScheduler.start(boss);
  startHeartbeat('video-worker');
  logger.info(`Worker de video iniciado (env=${config.env}).`);
}

main().catch((err) => {
  logger.error('Falha ao iniciar o worker de video:', err);
  process.exit(1);
});

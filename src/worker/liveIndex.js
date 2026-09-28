'use strict';

// Processo 4: cortes de lives da Twitch (fase de validacao, so admin).
// Container proprio (live-worker) com limite de CPU e memoria, pra uma live
// pesada nunca atrasar o fluxo do YouTube. Com o modulo desligado no painel
// (settings.lives_enabled = false, o padrao), este processo fica parado
// esperando - nao grava, nao transcreve, nao gasta nada.
const config = require('../config');
const pool = require('../db/pool');
const logger = require('../lib/logger');
const { startHeartbeat } = require('../lib/heartbeat');
const processGuard = require('../lib/processGuard');
const liveSupervisor = require('./liveSupervisor');

processGuard.install('live-worker', { onShutdown: () => liveSupervisor.parar() });

async function main() {
  await pool.query('SELECT 1');
  await liveSupervisor.iniciar();
  startHeartbeat('live-worker');
  logger.info(`Worker de lives iniciado (env=${config.env}).`);
}

main().catch((err) => {
  logger.error('Falha ao iniciar o worker de lives:', err);
  process.exit(1);
});

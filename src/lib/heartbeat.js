// Cada processo (web, worker, video-worker) chama startHeartbeat(nome) uma
// vez ao subir - grava um "estou vivo" no banco a cada 30s, usado pelo
// painel de metricas do admin pra mostrar status up/down de cada servico.
'use strict';

const metricsRepository = require('../repositories/metricsRepository');
const logger = require('./logger');

const INTERVAL_MS = 30_000;

function startHeartbeat(serviceName) {
  const beat = () => {
    metricsRepository.upsertHeartbeat(serviceName).catch((err) => {
      logger.error(`Falha ao gravar heartbeat de "${serviceName}":`, err.message);
    });
  };
  beat();
  const interval = setInterval(beat, INTERVAL_MS);
  interval.unref();
  return interval;
}

module.exports = { startHeartbeat };
